"""Pure CSV preview planner shared by ChoiceSet preview and atomic apply."""

import csv
import io
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from app.domain.choices.rules import normalize_choice_option
from app.domain.errors import RuleViolationError

ChoiceImportAction = Literal["create", "update", "error"]
_HEADER = ["code", "label", "sort_order", "is_active"]
_INTEGER_PATTERN = re.compile(r"^-?[0-9]+$")


@dataclass(frozen=True, slots=True)
class ChoiceImportPayload:
    code: str
    label: str
    sort_order: int
    is_active: bool


@dataclass(frozen=True, slots=True)
class ChoiceImportRow:
    line: int
    code: str
    action: ChoiceImportAction
    message: str | None = None
    payload: ChoiceImportPayload | None = None


@dataclass(frozen=True, slots=True)
class ChoiceImportPlan:
    rows: list[ChoiceImportRow]

    @property
    def created_count(self) -> int:
        return sum(row.action == "create" for row in self.rows)

    @property
    def updated_count(self) -> int:
        return sum(row.action == "update" for row in self.rows)

    @property
    def error_count(self) -> int:
        return sum(row.action == "error" for row in self.rows)


def build_choice_import_plan(
    csv_text: str,
    *,
    existing: Mapping[str, Mapping[str, object]],
) -> ChoiceImportPlan:
    """Parse every data row, classifying valid codes without mutating persistence."""
    try:
        reader = csv.reader(io.StringIO(csv_text, newline=""), strict=True)
        header = next(reader, None)
        if header != _HEADER:
            raise RuleViolationError(
                "CSV 헤더는 code,label,sort_order,is_active 순서여야 한다",
                code="invalid_choice_csv",
            )

        rows: list[ChoiceImportRow] = []
        seen: set[str] = set()
        for values in reader:
            rows.append(_build_row(reader.line_num, values, existing, seen))
        return ChoiceImportPlan(rows=rows)
    except csv.Error as exc:
        raise RuleViolationError(
            f"CSV를 해석할 수 없다: {exc}", code="invalid_choice_csv"
        ) from None


def _build_row(
    line: int,
    values: list[str],
    existing: Mapping[str, Mapping[str, object]],
    seen: set[str],
) -> ChoiceImportRow:
    raw_code = values[0].strip() if values else ""
    errors: list[str] = []
    payload: ChoiceImportPayload | None = None
    code = raw_code

    if len(values) != len(_HEADER):
        errors.append("CSV 열 개수가 4개여야 한다")
    else:
        try:
            code, label = normalize_choice_option(values[0], values[1])
        except RuleViolationError as exc:
            errors.append(exc.message)
            label = values[1].strip()

        sort_text = values[2].strip()
        if _INTEGER_PATTERN.fullmatch(sort_text) is None:
            errors.append("sort_order는 정수여야 한다")
            sort_order = 0
        else:
            sort_order = int(sort_text)

        active_text = values[3].strip().lower()
        if active_text not in {"true", "false"}:
            errors.append("is_active는 true 또는 false여야 한다")
            is_active = False
        else:
            is_active = active_text == "true"

        if code in seen:
            errors.append("하나의 CSV에 같은 code를 중복할 수 없다")
        seen.add(code)
        if not errors:
            payload = ChoiceImportPayload(
                code=code,
                label=label,
                sort_order=sort_order,
                is_active=is_active,
            )

    if errors:
        return ChoiceImportRow(
            line=line,
            code=code,
            action="error",
            message="; ".join(errors),
        )
    assert payload is not None
    return ChoiceImportRow(
        line=line,
        code=payload.code,
        action="update" if payload.code in existing else "create",
        payload=payload,
    )
