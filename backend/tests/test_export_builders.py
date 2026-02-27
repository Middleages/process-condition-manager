"""
Tests for app.services.export_builders

Pure-function unit tests: no DB or async required.
Uses SimpleNamespace to simulate ORM models.

Coverage:
- sanitize_filename: special char replacement, normal strings
- build_type_a_data: headers, rows, required null handling, empty mappings
- build_type_b_data: EQP 컬럼 기반 설비 분할, no-equipment fallback, equip_vary_mapping 적용
- build_type_c_data: key-value transpose, multi-layer columns, unit mappings
"""

from types import SimpleNamespace

import pytest

from app.services.export_builders import (
    build_type_a_data,
    build_type_b_data,
    build_type_c_data,
    sanitize_filename,
    write_excel,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_col_def(column_name: str) -> SimpleNamespace:
    return SimpleNamespace(column_name=column_name)


def make_mapping(
    target: str, source: str,
    sort_order: int = 0, is_required: bool = False,
) -> SimpleNamespace:
    return SimpleNamespace(
        target_column_name=target,
        column_definition=make_col_def(source),
        sort_order=sort_order,
        is_required=is_required,
        source_type="condition",
        data_source_id=None,
        source_column_name=None,
    )


def make_pl(
    layer_name: str, conditions: dict,
    pl_id: int = 1, sort_order: int = 0,
    layer_id: str = "1.0", step_seq: int = 1,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=pl_id, layer_name=layer_name, layer_id=layer_id,
        step_seq=step_seq, conditions=conditions, sort_order=sort_order,
    )


# ===========================================================================
# sanitize_filename
# ===========================================================================

class TestSanitizeFilename:

    def test_special_characters_replaced(self):
        assert sanitize_filename("foo/bar:baz") == "foo_bar_baz"

    def test_spaces_replaced(self):
        assert sanitize_filename("my file name") == "my_file_name"

    def test_normal_string_unchanged(self):
        assert sanitize_filename("valid-name_v1.xlsx") == "valid-name_v1.xlsx"

    def test_empty_string(self):
        assert sanitize_filename("") == ""

    def test_korean_replaced(self):
        # Korean chars are non-word chars in ASCII regex -> replaced
        result = sanitize_filename("테스트")
        assert "/" not in result


# ===========================================================================
# build_type_a_data
# ===========================================================================

class TestBuildTypeAData:

    def test_basic_headers_and_rows(self):
        layers = [make_pl("L1", {"COL_A": "10", "COL_B": "20"})]
        mappings = [
            make_mapping("TARGET_A", "COL_A"),
            make_mapping("TARGET_B", "COL_B"),
        ]
        headers, rows = build_type_a_data("PROD-1", layers, mappings)
        assert headers == ["LAYER_ID", "PRODUCT_ID", "TARGET_A", "TARGET_B"]
        assert len(rows) == 1
        assert rows[0]["LAYER_ID"] == "L1"
        assert rows[0]["PRODUCT_ID"] == "PROD-1"
        assert rows[0]["TARGET_A"] == "10"
        assert rows[0]["TARGET_B"] == "20"

    def test_required_null_becomes_empty_string(self):
        """Required column with None value -> empty string in output."""
        layers = [make_pl("L1", {})]
        mappings = [make_mapping("TARGET_A", "COL_A", is_required=True)]
        headers, rows = build_type_a_data("PROD-1", layers, mappings)
        assert rows[0]["TARGET_A"] == ""

    def test_empty_mappings(self):
        """No mappings -> only LAYER_ID and PRODUCT_ID columns."""
        layers = [make_pl("L1", {"COL_A": "10"})]
        headers, rows = build_type_a_data("PROD-1", layers, [])
        assert headers == ["LAYER_ID", "PRODUCT_ID"]
        assert len(rows) == 1

    def test_multiple_layers(self):
        layers = [
            make_pl("L1", {"COL_A": "10"}, pl_id=1),
            make_pl("L2", {"COL_A": "20"}, pl_id=2),
        ]
        mappings = [make_mapping("TARGET_A", "COL_A")]
        headers, rows = build_type_a_data("PROD-1", layers, mappings)
        assert len(rows) == 2
        assert rows[0]["TARGET_A"] == "10"
        assert rows[1]["TARGET_A"] == "20"

    def test_none_conditions_treated_as_empty(self):
        """ProjectLayer with conditions=None -> treated as {}."""
        layers = [SimpleNamespace(
            id=1, layer_name="L1", layer_id="1.0", step_seq=1,
            conditions=None, sort_order=0,
        )]
        mappings = [make_mapping("TARGET_A", "COL_A")]
        headers, rows = build_type_a_data("PROD-1", layers, mappings)
        assert rows[0]["TARGET_A"] == ""


# ===========================================================================
# build_type_b_data (EQP 컬럼 기반 설비 분할)
# ===========================================================================

class TestBuildTypeBData:

    def test_eqp_columns_split_into_rows(self):
        """EQP_01, EQP_02가 있으면 레이어당 2개 행 생성."""
        pl = make_pl("L1", {"COL_A": "base", "EQP_01": "EQ-001", "EQP_02": "EQ-002"}, pl_id=10)
        mappings = [make_mapping("TARGET_A", "COL_A")]
        headers, rows = build_type_b_data("PROD-1", [pl], mappings)
        assert len(rows) == 2
        assert rows[0]["EQUIP_ID"] == "EQ-001"
        assert rows[1]["EQUIP_ID"] == "EQ-002"
        assert "EQUIP_ID" in headers

    def test_no_eqp_columns_fallback(self):
        """EQP 컬럼이 없으면 빈 EQUIP_ID로 단일 행 생성."""
        pl = make_pl("L1", {"COL_A": "val"}, pl_id=10)
        mappings = [make_mapping("TARGET_A", "COL_A")]
        headers, rows = build_type_b_data("PROD-1", [pl], mappings)
        assert len(rows) == 1
        assert rows[0]["EQUIP_ID"] == ""
        assert rows[0]["TARGET_A"] == "val"

    def test_equip_vary_mapping_reads_per_equipment_suffix(self):
        """equip_vary_mapping이 있으면 EQP_{NN}{suffix} 컬럼에서 설비별 값 읽음."""
        conditions = {
            "COL_A": "shared",
            "SC_EXPOSE_ENERGY_mJ": "38.0",
            "EQP_01": "EQ-001",
            "EQP_01_ET": "38.2",
            "EQP_02": "EQ-002",
            "EQP_02_ET": "37.7",
        }
        pl = make_pl("L1", conditions, pl_id=10)
        mappings = [
            make_mapping("TARGET_ENERGY", "SC_EXPOSE_ENERGY_mJ"),
            make_mapping("TARGET_A", "COL_A"),
        ]
        system_config = {"equip_vary_mapping": {"SC_EXPOSE_ENERGY_mJ": "_ET"}}
        headers, rows = build_type_b_data("PROD-1", [pl], mappings, system_config)
        assert len(rows) == 2
        # 설비별로 다른 값: EQP_{NN}_ET에서 읽음
        assert rows[0]["TARGET_ENERGY"] == "38.2"
        assert rows[1]["TARGET_ENERGY"] == "37.7"
        # 공통 값: 기본 conditions에서 읽음
        assert rows[0]["TARGET_A"] == "shared"
        assert rows[1]["TARGET_A"] == "shared"

    def test_empty_eqp_slot_skipped(self):
        """EQP_01이 비어있고 EQP_02만 있으면 EQP_02 행만 생성 (R7.4 준수)."""
        conditions = {"COL_A": "val", "EQP_01": "", "EQP_02": "EQ-002"}
        pl = make_pl("L1", conditions, pl_id=10)
        mappings = [make_mapping("TARGET_A", "COL_A")]
        headers, rows = build_type_b_data("PROD-1", [pl], mappings)
        assert len(rows) == 1
        assert rows[0]["EQUIP_ID"] == "EQ-002"

    def test_mixed_eqp_and_no_eqp_layers(self):
        """EQP 있는 레이어와 없는 레이어 혼합: 각각 올바른 행 수 생성."""
        pl1 = make_pl("L1", {"COL_A": "10", "EQP_01": "EQ-001"}, pl_id=1)
        pl2 = make_pl("L2", {"COL_A": "20"}, pl_id=2)
        mappings = [make_mapping("TARGET_A", "COL_A")]
        headers, rows = build_type_b_data("PROD-1", [pl1, pl2], mappings)
        assert len(rows) == 2
        assert rows[0]["EQUIP_ID"] == "EQ-001"
        assert rows[1]["EQUIP_ID"] == ""


# ===========================================================================
# build_type_c_data
# ===========================================================================

class TestBuildTypeCData:

    def test_key_value_transpose(self):
        """Each mapping becomes a separate row per layer."""
        layers = [make_pl("L1", {"COL_A": "10", "COL_B": "20"})]
        mappings = [
            make_mapping("TARGET_A", "COL_A"),
            make_mapping("TARGET_B", "COL_B"),
        ]
        headers, rows = build_type_c_data("PROD-1", layers, mappings, {})
        assert headers == ["LAYER_ID", "PRODUCT_ID", "PARAM_KEY", "PARAM_VALUE", "UNIT"]
        assert len(rows) == 2
        assert rows[0]["PARAM_KEY"] == "TARGET_A"
        assert rows[0]["PARAM_VALUE"] == "10"
        assert rows[1]["PARAM_KEY"] == "TARGET_B"
        assert rows[1]["PARAM_VALUE"] == "20"

    def test_unit_mappings(self):
        """Unit mappings are applied by column_name."""
        layers = [make_pl("L1", {"COL_A": "10"})]
        mappings = [make_mapping("TARGET_A", "COL_A")]
        unit_map = {"COL_A": "rpm"}
        headers, rows = build_type_c_data("PROD-1", layers, mappings, unit_map)
        assert rows[0]["UNIT"] == "rpm"

    def test_missing_unit_defaults_empty(self):
        """Column without unit mapping -> empty string."""
        layers = [make_pl("L1", {"COL_A": "10"})]
        mappings = [make_mapping("TARGET_A", "COL_A")]
        headers, rows = build_type_c_data("PROD-1", layers, mappings, {})
        assert rows[0]["UNIT"] == ""

    def test_multi_layer_expansion(self):
        """2 layers * 2 mappings = 4 rows."""
        layers = [
            make_pl("L1", {"COL_A": "10"}, pl_id=1),
            make_pl("L2", {"COL_A": "20"}, pl_id=2),
        ]
        mappings = [make_mapping("TARGET_A", "COL_A")]
        headers, rows = build_type_c_data("PROD-1", layers, mappings, {})
        assert len(rows) == 2
        assert rows[0]["LAYER_ID"] == "L1"
        assert rows[1]["LAYER_ID"] == "L2"


# ===========================================================================
# write_excel (integration: produces valid .xlsx)
# ===========================================================================

class TestWriteExcel:

    def test_produces_valid_xlsx_bytes(self):
        from openpyxl import load_workbook
        import io

        headers = ["A", "B"]
        rows = [{"A": "1", "B": "2"}, {"A": "3", "B": "4"}]
        data = write_excel(headers, rows)
        assert isinstance(data, bytes)
        assert len(data) > 0

        wb = load_workbook(io.BytesIO(data))
        ws = wb.active
        assert ws.cell(1, 1).value == "A"
        assert ws.cell(1, 1).font.bold is True
        assert ws.cell(2, 1).value == "1"
        assert ws.cell(3, 2).value == "4"
