"""CSV 붙여넣기 기반 파라미터 import 파서."""

import csv
from dataclasses import dataclass
from io import StringIO

from app.domain.parameters.types import ValueType
from app.features.parameters.schema import OptionIn, ParameterCreate

_HEADER_ALIASES = {
    "code": "code",
    "displayname": "display_name",
    "display_name": "display_name",
    "name": "display_name",
    "valuetype": "value_type",
    "value_type": "value_type",
    "type": "value_type",
    "category": "category",
    "unit": "unit",
    "min": "min_value",
    "minvalue": "min_value",
    "min_value": "min_value",
    "max": "max_value",
    "maxvalue": "max_value",
    "max_value": "max_value",
    "choices": "choices",
    "options": "choices",
    "description": "description",
    "sortorder": "sort_order",
    "sort_order": "sort_order",
}


@dataclass(frozen=True, slots=True)
class ParsedParameterRow:
    row_number: int
    parameter: ParameterCreate
    category_code: str | None


@dataclass(frozen=True, slots=True)
class ImportParseResult:
    rows: list[ParsedParameterRow]
    errors: list[str]


def parse_parameter_csv(csv_text: str) -> ImportParseResult:
    """붙여넣은 CSV를 표준 ParameterCreate 목록으로 변환한다."""
    if not csv_text.strip():
        return ImportParseResult([], ["CSV 내용이 비어 있다."])

    reader = csv.DictReader(StringIO(csv_text))
    if reader.fieldnames is None:
        return ImportParseResult([], ["CSV 헤더를 찾을 수 없다."])

    normalized = [_normalize_header(header) for header in reader.fieldnames]
    field_map = {
        original: _HEADER_ALIASES.get(header)
        for original, header in zip(reader.fieldnames, normalized, strict=True)
    }
    if "code" not in field_map.values():
        return ImportParseResult([], ["필수 컬럼 code가 없다."])

    rows: list[ParsedParameterRow] = []
    errors: list[str] = []
    seen_codes: set[str] = set()
    for row_number, raw in enumerate(reader, start=2):
        normalized_row = {
            target: _clean_cell(value)
            for source, value in raw.items()
            if (target := field_map.get(source)) is not None
        }
        code = normalized_row.get("code", "").strip()
        if not code:
            errors.append(f"{row_number}행: code가 비어 있다.")
            continue
        if code in seen_codes:
            errors.append(f"{row_number}행: 중복 code {code}")
            continue
        seen_codes.add(code)

        try:
            value_type = ValueType(normalized_row.get("value_type") or ValueType.TEXT.value)
            min_value = _to_float(normalized_row.get("min_value"))
            max_value = _to_float(normalized_row.get("max_value"))
            sort_order = _to_int(normalized_row.get("sort_order"))
            options = [
                OptionIn(value=choice, display_name=choice, sort_order=index)
                for index, choice in enumerate(_split_choices(normalized_row.get("choices")))
            ]
            rows.append(
                ParsedParameterRow(
                    row_number=row_number,
                    category_code=normalized_row.get("category") or None,
                    parameter=ParameterCreate(
                        code=code,
                        display_name=normalized_row.get("display_name") or code,
                        value_type=value_type,
                        description=normalized_row.get("description") or None,
                        unit=normalized_row.get("unit") or None,
                        min_value=min_value,
                        max_value=max_value,
                        sort_order=sort_order,
                        options=options,
                    ),
                )
            )
        except ValueError as exc:
            errors.append(f"{row_number}행: {exc}")

    return ImportParseResult(rows, errors)


def _normalize_header(header: str) -> str:
    return "".join(header.split()).replace("-", "_").lower()


def _clean_cell(value: str | None) -> str:
    return " ".join((value or "").split()).strip()


def _to_float(value: str | None) -> float | None:
    if not value:
        return None
    return float(value)


def _to_int(value: str | None) -> int:
    if not value:
        return 0
    return int(value)


def _split_choices(value: str | None) -> list[str]:
    if not value:
        return []
    return [choice.strip() for choice in value.split(",") if choice.strip()]
