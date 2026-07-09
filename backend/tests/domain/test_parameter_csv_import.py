"""CSV 임포트 순수 로직 테스트."""

import pytest

from app.domain.parameters import build_import_plan, parse_rows
from app.domain.parameters.csv_import import CsvImportError, normalize_header


def test_normalize_header_strips_newlines_and_maps_alias() -> None:
    assert normalize_header("Display\nName") == "display_name"
    assert normalize_header(" TYPE ") == "value_type"
    assert normalize_header("Min") == "min_value"


def test_parse_rows_requires_code_column() -> None:
    with pytest.raises(CsvImportError):
        parse_rows("display_name,type\nSpin Speed,number")


def test_plan_classifies_create_update_and_errors() -> None:
    csv_text = (
        "code,display_name,type,min,max,category\n"
        "spin_speed,Spin Speed,number,0,5000,sp\n"  # 신규
        "pr_type,PR Type,text,,,sp\n"  # 기존 갱신
        "spin_speed,dup,number,,,\n"  # CSV 내 중복 → error
        "9bad,Bad Code,text,,,\n"  # code 형식 오류 → error
    )
    plan = build_import_plan(parse_rows(csv_text), {"pr_type": "text"})

    by_code = {(row.code, row.action) for row in plan.rows}
    assert ("spin_speed", "create") in by_code
    assert ("pr_type", "update") in by_code
    assert plan.created_count == 1
    assert plan.updated_count == 1
    assert plan.error_count == 2


def test_plan_flags_value_type_change_on_update() -> None:
    plan = build_import_plan(
        parse_rows("code,type\nspin_speed,text\n"), {"spin_speed": "number"}
    )
    assert plan.error_count == 1
    assert "value_type" in (plan.rows[0].message or "")


def test_plan_flags_choice_without_options() -> None:
    plan = build_import_plan(parse_rows("code,type\npr_type,choice\n"), {})
    assert plan.error_count == 1


def test_plan_parses_choice_options() -> None:
    plan = build_import_plan(
        parse_rows('code,type,options\npr_type,choice,"A,B,C"\n'), {}
    )
    assert plan.error_count == 0
    assert plan.payloads[0].options == ("A", "B", "C")
