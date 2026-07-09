"""CSV 붙여넣기 임포트 순수 로직 (프레임워크·DB 무의존).

붙여넣은 CSV 텍스트를 파싱하고, 레지스트리 현재 상태와 대조해 각 행을
create/update/error로 분류한 임포트 계획(ImportPlan)을 만든다. DB 반영은
서비스가 계획(payload)을 그대로 적용한다 — 이 모듈은 IO를 하지 않는다.
"""

import csv
import io
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

from app.domain.errors import DomainError
from app.domain.parameters.rules import (
    validate_choice_options,
    validate_code,
    validate_number_bounds,
)
from app.domain.parameters.types import ValueType

# 표준 필드명 <- 헤더 별칭. 헤더는 줄바꿈 제거 + 소문자 + 공백/하이픈을 밑줄로 정규화한다.
_ALIASES: dict[str, str] = {
    "name": "display_name",
    "display": "display_name",
    "parameter": "code",
    "param_code": "code",
    "type": "value_type",
    "valuetype": "value_type",
    "category_code": "category",
    "cat": "category",
    "min": "min_value",
    "max": "max_value",
    "choices": "options",
    "choice_options": "options",
    "option": "options",
    "desc": "description",
    "order": "sort_order",
    "sort": "sort_order",
}

_STANDARD_FIELDS = {
    "code",
    "display_name",
    "value_type",
    "category",
    "unit",
    "min_value",
    "max_value",
    "options",
    "description",
    "sort_order",
}


@dataclass(frozen=True, slots=True)
class ImportPayload:
    """검증을 통과한 행의 정규화 결과 (서비스가 그대로 UPSERT)."""

    code: str
    display_name: str
    value_type: ValueType
    category: str | None
    unit: str | None
    min_value: float | None
    max_value: float | None
    options: tuple[str, ...]
    description: str | None
    sort_order: int


@dataclass(frozen=True, slots=True)
class PlanRow:
    line: int
    code: str
    action: Literal["create", "update", "error"]
    message: str | None = None
    payload: ImportPayload | None = None


@dataclass(frozen=True, slots=True)
class ImportPlan:
    rows: tuple[PlanRow, ...] = field(default_factory=tuple)

    @property
    def created_count(self) -> int:
        return sum(1 for row in self.rows if row.action == "create")

    @property
    def updated_count(self) -> int:
        return sum(1 for row in self.rows if row.action == "update")

    @property
    def error_count(self) -> int:
        return sum(1 for row in self.rows if row.action == "error")

    @property
    def payloads(self) -> list[ImportPayload]:
        return [row.payload for row in self.rows if row.payload is not None]


def normalize_header(raw: str) -> str:
    cleaned = raw.replace("\n", " ").replace("\r", " ").strip().lower()
    cleaned = re.sub(r"[\s\-]+", "_", cleaned)
    return _ALIASES.get(cleaned, cleaned)


class CsvImportError(DomainError):
    """CSV 구조 자체가 잘못됨 (헤더 없음 등)."""

    code = "csv_import"


def parse_rows(text: str) -> list[dict[str, str]]:
    """CSV 텍스트를 표준 필드명 dict 목록으로 파싱한다. code 컬럼은 필수다."""
    stripped = text.strip()
    if not stripped:
        raise CsvImportError("CSV 내용이 비어 있다")
    reader = csv.reader(io.StringIO(stripped))
    try:
        raw_header = next(reader)
    except StopIteration as exc:  # pragma: no cover - 위에서 빈 값 차단
        raise CsvImportError("헤더 행이 없다") from exc

    headers = [normalize_header(cell) for cell in raw_header]
    if "code" not in headers:
        raise CsvImportError("필수 컬럼 code가 없다")

    rows: list[dict[str, str]] = []
    for raw in reader:
        if not any(cell.strip() for cell in raw):
            continue  # 빈 줄 무시
        row = {
            headers[i]: raw[i].strip()
            for i in range(min(len(headers), len(raw)))
            if headers[i] in _STANDARD_FIELDS
        }
        rows.append(row)
    return rows


def build_import_plan(
    rows: list[dict[str, str]], existing_value_types: Mapping[str, str]
) -> ImportPlan:
    """행 목록을 레지스트리 현재 상태와 대조해 create/update/error로 분류한다."""
    seen: set[str] = set()
    plan_rows: list[PlanRow] = []
    for index, row in enumerate(rows, start=2):  # 헤더가 1행
        raw_code = row.get("code", "")
        try:
            code = validate_code(raw_code)
        except DomainError as exc:
            plan_rows.append(PlanRow(index, raw_code, "error", exc.message))
            continue

        if code in seen:
            plan_rows.append(PlanRow(index, code, "error", "CSV 내 중복 code"))
            continue
        seen.add(code)

        existing_type = existing_value_types.get(code)
        try:
            payload = _to_payload(code, row, existing_type)
        except DomainError as exc:
            plan_rows.append(PlanRow(index, code, "error", exc.message))
            continue

        action: Literal["create", "update"] = (
            "update" if existing_type is not None else "create"
        )
        plan_rows.append(PlanRow(index, code, action, None, payload))
    return ImportPlan(tuple(plan_rows))


def _to_payload(
    code: str, row: dict[str, str], existing_type: str | None
) -> ImportPayload:
    value_type = _resolve_value_type(row.get("value_type"), existing_type)
    # 기존 파라미터의 value_type은 불변이다.
    if existing_type is not None and value_type.value != existing_type:
        raise _rule(f"value_type 불변: {existing_type} -> {value_type.value} 변경 불가")

    options = _split_options(row.get("options", ""))
    validate_choice_options(value_type, options)
    min_value = _to_float(row.get("min_value"), "min_value")
    max_value = _to_float(row.get("max_value"), "max_value")
    validate_number_bounds(min_value, max_value)
    sort_order = _to_int(row.get("sort_order"), "sort_order")

    display_name = row.get("display_name", "").strip() or code
    return ImportPayload(
        code=code,
        display_name=display_name,
        value_type=value_type,
        category=_resolve_category(row.get("category")),
        unit=(row.get("unit", "").strip() or None),
        min_value=min_value,
        max_value=max_value,
        options=options,
        description=(row.get("description", "").strip() or None),
        sort_order=sort_order,
    )


def _resolve_value_type(raw: str | None, existing_type: str | None) -> ValueType:
    text = (raw or "").strip().lower()
    if not text:
        # CSV에 없으면 기존 값을 유지하고, 신규는 text 기본.
        return ValueType(existing_type) if existing_type else ValueType.TEXT
    try:
        return ValueType(text)
    except ValueError as exc:
        raise _rule(f"허용되지 않는 value_type: {raw}") from exc


def _resolve_category(raw: str | None) -> str | None:
    """카테고리 코드 정규화(소문자) + 형식 검증. 없으면 None."""
    text = (raw or "").strip()
    if not text:
        return None
    try:
        return validate_code(text.lower())
    except DomainError as exc:
        raise _rule(f"category 코드 형식 오류: {raw}") from exc


def _split_options(raw: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in raw.split(",") if part.strip())


def _to_float(raw: str | None, field_name: str) -> float | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError as exc:
        raise _rule(f"{field_name}는 숫자여야 한다: {raw}") from exc


def _to_int(raw: str | None, field_name: str) -> int:
    text = (raw or "").strip()
    if not text:
        return 0
    try:
        return int(text)
    except ValueError as exc:
        raise _rule(f"{field_name}는 정수여야 한다: {raw}") from exc


def _rule(message: str) -> DomainError:
    return DomainError(message, code="rule_violation")
