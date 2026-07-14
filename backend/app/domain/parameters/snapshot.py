"""Deterministic serialization for frozen parameter-registry inputs."""

from collections.abc import Iterable, Mapping
from typing import Any

from app.domain.choices.constants import FIXED_PROFILE_CHOICE_SET_CODES
from app.domain.errors import RuleViolationError

SNAPSHOT_VERSION = 2


def snapshot(
    *,
    categories: Iterable[Mapping[str, Any]],
    parameters: Iterable[Mapping[str, Any]],
    choice_sets: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Serialize active registry rows and their required managed choices."""
    active_categories = sorted(
        (row for row in categories if row.get("is_active", True)),
        key=lambda row: (int(row.get("sort_order", 0)), str(row["code"])),
    )
    active_parameters = sorted(
        (row for row in parameters if row.get("is_active", True)),
        key=lambda row: (int(row.get("sort_order", 0)), str(row["code"])),
    )
    required_set_codes = set(FIXED_PROFILE_CHOICE_SET_CODES)
    required_set_codes.update(
        str(row["choice_set_code"])
        for row in active_parameters
        if _value_type(row["value_type"]) == "choice"
    )
    set_by_code = {str(row["code"]): row for row in choice_sets}
    missing = sorted(required_set_codes - set(set_by_code))
    if missing:
        raise RuleViolationError(
            f"snapshot ChoiceSet이 없다: {', '.join(missing)}",
            code="snapshot_choice_set_missing",
        )

    return {
        "version": SNAPSHOT_VERSION,
        "categories": [_category_out(row) for row in active_categories],
        "parameters": [_parameter_out(row) for row in active_parameters],
        "choice_sets": [
            _choice_set_out(set_by_code[code]) for code in sorted(required_set_codes)
        ],
    }


def _category_out(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "code": row["code"],
        "display_name": row["display_name"],
        "sort_order": int(row.get("sort_order", 0)),
    }


def _parameter_out(row: Mapping[str, Any]) -> dict[str, Any]:
    value_type = _value_type(row["value_type"])
    output = {
        "code": row["code"],
        "display_name": row["display_name"],
        "value_type": value_type,
        "category_code": row.get("category_code"),
        "unit": row.get("unit"),
        "min_value": row.get("min_value"),
        "max_value": row.get("max_value"),
        "sort_order": int(row.get("sort_order", 0)),
    }
    if value_type == "choice":
        output["choice_set_code"] = str(row["choice_set_code"])
    return output


def _choice_set_out(row: Mapping[str, Any]) -> dict[str, Any]:
    options = sorted(
        row.get("options", []),
        key=lambda option: (int(option.get("sort_order", 0)), str(option["code"])),
    )
    return {
        "code": row["code"],
        "display_name": row["display_name"],
        "version": int(row["version"]),
        "options": [_choice_option_out(option) for option in options],
    }


def _choice_option_out(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "code": row["code"],
        "label": row["label"],
        "sort_order": int(row.get("sort_order", 0)),
        "is_active": bool(row.get("is_active", True)),
    }


def _value_type(value: Any) -> str:
    return str(getattr(value, "value", value))
