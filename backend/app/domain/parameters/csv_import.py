"""Pure parameter CSV parsing and managed ChoiceSet import planning."""

import csv
import io
import re
from collections.abc import Collection, Mapping
from dataclasses import dataclass, field
from typing import Literal

from app.domain.errors import DomainError, ImmutableFieldError, RuleViolationError
from app.domain.parameters.rules import (
    normalize_number_bounds,
    validate_choice_set_binding,
    validate_code,
)
from app.domain.parameters.types import ValueType

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
    "option": "options",
    "choice_set": "choice_set_code",
    "choiceset": "choice_set_code",
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
    "choice_set_code",
    "description",
    "sort_order",
}


@dataclass(frozen=True, slots=True)
class ImportPayload:
    code: str
    display_name: str
    value_type: ValueType
    category: str | None
    unit: str | None
    min_value: str | None
    max_value: str | None
    choice_set_code: str | None
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
    code = "csv_import"


def parse_rows(text: str) -> list[dict[str, str]]:
    stripped = text.strip()
    if not stripped:
        raise CsvImportError("CSV 내용이 비어 있다")
    reader = csv.reader(io.StringIO(stripped))
    try:
        raw_header = next(reader)
    except StopIteration as exc:  # pragma: no cover
        raise CsvImportError("헤더 행이 없다") from exc

    headers = [normalize_header(cell) for cell in raw_header]
    if "options" in headers or any(header.endswith("_options") for header in headers):
        raise CsvImportError(
            "options 컬럼은 더 이상 지원하지 않는다; choice_set_code를 사용하라"
        )
    if "code" not in headers:
        raise CsvImportError("필수 컬럼 code가 없다")

    rows: list[dict[str, str]] = []
    for raw in reader:
        if not any(cell.strip() for cell in raw):
            continue
        rows.append(
            {
                headers[index]: raw[index].strip()
                for index in range(min(len(headers), len(raw)))
                if headers[index] in _STANDARD_FIELDS
            }
        )
    return rows


def build_import_plan(
    rows: list[dict[str, str]],
    *,
    existing_parameters: Mapping[str, Mapping[str, str | None]],
    active_choice_set_codes: Collection[str],
) -> ImportPlan:
    """Classify rows against immutable parameter and active-registry context."""
    seen: set[str] = set()
    active_sets = set(active_choice_set_codes)
    plan_rows: list[PlanRow] = []
    for index, row in enumerate(rows, start=2):
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

        existing = existing_parameters.get(code)
        try:
            payload = _to_payload(code, row, existing, active_sets)
        except DomainError as exc:
            plan_rows.append(PlanRow(index, code, "error", exc.message))
            continue

        action: Literal["create", "update"] = "update" if existing is not None else "create"
        plan_rows.append(PlanRow(index, code, action, None, payload))
    return ImportPlan(tuple(plan_rows))


def _to_payload(
    code: str,
    row: dict[str, str],
    existing: Mapping[str, str | None] | None,
    active_choice_set_codes: set[str],
) -> ImportPayload:
    existing_type = None if existing is None else existing.get("value_type")
    value_type = _resolve_value_type(row.get("value_type"), existing_type)
    if existing_type is not None and value_type.value != existing_type:
        raise ImmutableFieldError(
            f"value_type 불변: {existing_type} -> {value_type.value} 변경 불가"
        )

    incoming_set_code = row.get("choice_set_code", "").strip() or None
    current_set_code = None if existing is None else existing.get("choice_set_code")
    if existing is not None and value_type is ValueType.CHOICE:
        if incoming_set_code is not None and incoming_set_code != current_set_code:
            raise ImmutableFieldError(
                f"choice_set_code 불변: {current_set_code} -> {incoming_set_code} 변경 불가"
            )
        choice_set_code = current_set_code
    else:
        choice_set_code = incoming_set_code

    validate_choice_set_binding(value_type, choice_set_code)
    if (
        existing is None
        and choice_set_code is not None
        and choice_set_code not in active_choice_set_codes
    ):
        raise RuleViolationError(
            f"활성 ChoiceSet이 아니다: {choice_set_code}",
            code="invalid_active_choice_set",
        )

    min_value, max_value = normalize_number_bounds(
        row.get("min_value"), row.get("max_value")
    )
    return ImportPayload(
        code=code,
        display_name=row.get("display_name", "").strip() or code,
        value_type=value_type,
        category=_resolve_category(row.get("category")),
        unit=row.get("unit", "").strip() or None,
        min_value=min_value,
        max_value=max_value,
        choice_set_code=choice_set_code,
        description=row.get("description", "").strip() or None,
        sort_order=_to_int(row.get("sort_order"), "sort_order"),
    )


def _resolve_value_type(raw: str | None, existing_type: str | None) -> ValueType:
    text = (raw or "").strip().lower()
    if not text:
        return ValueType(existing_type) if existing_type else ValueType.TEXT
    try:
        return ValueType(text)
    except ValueError as exc:
        raise _rule(f"허용되지 않는 value_type: {raw}") from exc


def _resolve_category(raw: str | None) -> str | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        return validate_code(text.lower())
    except DomainError as exc:
        raise _rule(f"category 코드 형식 오류: {raw}") from exc


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
