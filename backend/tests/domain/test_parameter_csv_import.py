"""Final managed-registry contract for parameter CSV imports."""

from collections.abc import Mapping

import pytest

from app.domain.parameters import build_import_plan, parse_rows
from app.domain.parameters.csv_import import CsvImportError, normalize_header

CSV_HEADER = (
    "code,display_name,value_type,category,unit,min_value,max_value,"
    "choice_set_code,description,sort_order"
)


def _build(
    csv_text: str,
    *,
    existing: Mapping[str, Mapping[str, str | None]] | None = None,
    active_sets: set[str] | None = None,
):
    return build_import_plan(
        parse_rows(csv_text),
        existing_parameters=existing or {},
        active_choice_set_codes=active_sets or set(),
    )


def test_normalize_header_strips_newlines_and_maps_alias() -> None:
    assert normalize_header("Display\nName") == "display_name"
    assert normalize_header(" TYPE ") == "value_type"
    assert normalize_header("Min") == "min_value"


def test_parse_rows_requires_code_column() -> None:
    with pytest.raises(CsvImportError):
        parse_rows("display_name,type\nSpin Speed,number")


@pytest.mark.parametrize("legacy_header", ["options", "choices", "choice options", "option"])
def test_legacy_options_header_is_rejected_with_registry_instruction(
    legacy_header: str,
) -> None:
    with pytest.raises(CsvImportError) as raised:
        parse_rows(f"code,value_type,{legacy_header}\nmode,choice,A")
    assert "choice_set_code" in raised.value.message


def test_plan_classifies_create_update_and_errors() -> None:
    csv_text = (
        f"{CSV_HEADER}\n"
        "spin_speed,Spin Speed,number,sp,,0,5000,,,0\n"
        "pr_type,PR Type,text,sp,,,,,,0\n"
        "spin_speed,dup,number,,,0,1,,,0\n"
        "9bad,Bad Code,text,,,,,,,0\n"
    )
    plan = _build(
        csv_text,
        existing={"pr_type": {"value_type": "text", "choice_set_code": None}},
    )

    by_code = {(row.code, row.action) for row in plan.rows}
    assert ("spin_speed", "create") in by_code
    assert ("pr_type", "update") in by_code
    assert plan.created_count == 1
    assert plan.updated_count == 1
    assert plan.error_count == 2


def test_plan_flags_value_type_change_on_update() -> None:
    plan = _build(
        f"{CSV_HEADER}\nspin_speed,Spin Speed,text,,,,,,,0\n",
        existing={"spin_speed": {"value_type": "number", "choice_set_code": None}},
    )
    assert plan.error_count == 1
    assert "value_type" in (plan.rows[0].message or "")


def test_new_choice_requires_an_active_choice_set() -> None:
    missing = _build(f"{CSV_HEADER}\nmode,Mode,choice,,,,,,,0\n")
    unknown = _build(
        f"{CSV_HEADER}\nmode,Mode,choice,,,,,equipment_mode,,0\n"
    )
    active = _build(
        f"{CSV_HEADER}\nmode,Mode,choice,,,,,equipment_mode,,0\n",
        active_sets={"equipment_mode"},
    )

    assert missing.error_count == 1
    assert unknown.error_count == 1
    assert active.error_count == 0
    assert active.payloads[0].choice_set_code == "equipment_mode"


def test_existing_choice_may_omit_or_repeat_but_not_change_set() -> None:
    existing = {
        "mode": {"value_type": "choice", "choice_set_code": "equipment_mode"}
    }
    omitted = _build(
        f"{CSV_HEADER}\nmode,Updated,choice,,,,,,,0\n",
        existing=existing,
        active_sets={"equipment_mode"},
    )
    repeated = _build(
        f"{CSV_HEADER}\nmode,Updated,choice,,,,,equipment_mode,,0\n",
        existing=existing,
        active_sets={"equipment_mode"},
    )
    changed = _build(
        f"{CSV_HEADER}\nmode,Updated,choice,,,,,other_mode,,0\n",
        existing=existing,
        active_sets={"equipment_mode", "other_mode"},
    )

    assert omitted.error_count == 0
    assert omitted.payloads[0].choice_set_code == "equipment_mode"
    assert repeated.error_count == 0
    assert changed.error_count == 1
    assert "불변" in (changed.rows[0].message or "")


def test_non_choice_row_rejects_choice_set() -> None:
    plan = _build(
        f"{CSV_HEADER}\npitch,Pitch,number,,,,,equipment_mode,,0\n",
        active_sets={"equipment_mode"},
    )
    assert plan.error_count == 1


def test_decimal_bounds_are_canonical_strings() -> None:
    plan = _build(
        f"{CSV_HEADER}\npitch,Pitch,number,,,001.5000,10.000,,,0\n"
    )
    assert plan.error_count == 0
    assert plan.payloads[0].min_value == "1.5"
    assert plan.payloads[0].max_value == "10"


def test_min_greater_than_max_is_a_row_error() -> None:
    plan = _build(f"{CSV_HEADER}\npitch,Pitch,number,,,10,1,,,0\n")
    assert plan.error_count == 1
