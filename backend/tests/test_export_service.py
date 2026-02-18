"""
Tests for app.services.export_service.ExportService

Coverage:
- sanitize_filename utility function
- _build_type_a_data: headers, rows, required null warning
- _build_type_b_data: equipment override, no-equipment fallback
- _build_type_c_data: unit mappings, missing units
- _write_excel: produces valid xlsx bytes with bold headers
- REQ-001~003, REQ-010~013, REQ-020~024, REQ-030~033, REQ-083
"""

import io
import logging
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from openpyxl import load_workbook

from app.services.export_service import ExportService, sanitize_filename


# ---------------------------------------------------------------------------
# Helpers: lightweight mock objects that simulate ORM instances
# ---------------------------------------------------------------------------


def make_layer(layer_name: str) -> SimpleNamespace:
    """Create a mock Layer with a layer_name attribute."""
    return SimpleNamespace(layer_name=layer_name)


def make_col_def(column_name: str) -> SimpleNamespace:
    """Create a mock ColumnDefinition with a column_name attribute."""
    return SimpleNamespace(column_name=column_name)


def make_mapping(
    target_column_name: str,
    column_name: str,
    sort_order: int = 0,
    is_required: bool = False,
) -> SimpleNamespace:
    """Create a mock ExportColumnMapping."""
    return SimpleNamespace(
        target_column_name=target_column_name,
        column_definition=make_col_def(column_name),
        sort_order=sort_order,
        is_required=is_required,
    )


def make_project_layer(
    layer_name: str,
    conditions: dict,
    pl_id: int = 1,
    sort_order: int = 0,
) -> SimpleNamespace:
    """Create a mock ProjectLayer with a nested layer."""
    return SimpleNamespace(
        id=pl_id,
        layer=make_layer(layer_name),
        conditions=conditions,
        sort_order=sort_order,
    )


def make_equipment_assignment(
    project_layer_id: int,
    equipment_id: str,
    equipment_params: dict,
    sort_order: int = 0,
) -> SimpleNamespace:
    """Create a mock EquipmentAssignment."""
    return SimpleNamespace(
        project_layer_id=project_layer_id,
        equipment_id=equipment_id,
        equipment_params=equipment_params,
        sort_order=sort_order,
    )


# ---------------------------------------------------------------------------
# sanitize_filename
# ---------------------------------------------------------------------------


class TestSanitizeFilename:
    def test_plain_name_unchanged(self):
        assert sanitize_filename("ProductA") == "ProductA"

    def test_spaces_replaced(self):
        assert sanitize_filename("Product Name") == "Product_Name"

    def test_slash_replaced(self):
        assert sanitize_filename("Product/Name") == "Product_Name"

    def test_special_chars_replaced(self):
        result = sanitize_filename("P@r#o$d%u^c&t*()")
        assert all(c.isalnum() or c in ("_", "-", ".") for c in result)

    def test_hyphen_preserved(self):
        assert sanitize_filename("Product-A") == "Product-A"

    def test_dot_preserved(self):
        assert sanitize_filename("file.xlsx") == "file.xlsx"

    def test_unicode_characters_passthrough(self):
        # Python \w matches Unicode word characters (including Korean) so they pass through.
        # The function only replaces whitespace and punctuation like spaces, slashes, @, etc.
        result = sanitize_filename("제품명")
        # Korean characters are word characters in Python 3 regex and are preserved
        assert result == "제품명"

    def test_empty_string(self):
        assert sanitize_filename("") == ""


# ---------------------------------------------------------------------------
# _write_excel
# ---------------------------------------------------------------------------


class TestWriteExcel:
    def setup_method(self):
        self.service = ExportService()

    def test_returns_bytes(self):
        headers = ["A", "B"]
        rows = [{"A": 1, "B": 2}]
        result = self.service._write_excel(headers, rows)
        assert isinstance(result, bytes)
        assert len(result) > 0

    def test_valid_xlsx_format(self):
        headers = ["COL1", "COL2"]
        rows = [{"COL1": "val1", "COL2": "val2"}]
        result = self.service._write_excel(headers, rows)
        wb = load_workbook(io.BytesIO(result))
        ws = wb.active
        assert ws.cell(row=1, column=1).value == "COL1"
        assert ws.cell(row=1, column=2).value == "COL2"

    def test_headers_are_bold(self):
        headers = ["HEADER1", "HEADER2"]
        rows = []
        result = self.service._write_excel(headers, rows)
        wb = load_workbook(io.BytesIO(result))
        ws = wb.active
        assert ws.cell(row=1, column=1).font.bold is True
        assert ws.cell(row=1, column=2).font.bold is True

    def test_data_rows_written_correctly(self):
        headers = ["LAYER_ID", "VALUE"]
        rows = [
            {"LAYER_ID": "LAYER_A", "VALUE": 100},
            {"LAYER_ID": "LAYER_B", "VALUE": 200},
        ]
        result = self.service._write_excel(headers, rows)
        wb = load_workbook(io.BytesIO(result))
        ws = wb.active
        assert ws.cell(row=2, column=1).value == "LAYER_A"
        assert ws.cell(row=2, column=2).value == 100
        assert ws.cell(row=3, column=1).value == "LAYER_B"
        assert ws.cell(row=3, column=2).value == 200

    def test_empty_rows(self):
        headers = ["A", "B", "C"]
        rows = []
        result = self.service._write_excel(headers, rows)
        wb = load_workbook(io.BytesIO(result))
        ws = wb.active
        # Only header row should exist
        assert ws.cell(row=2, column=1).value is None

    def test_missing_key_defaults_to_empty(self):
        headers = ["A", "B"]
        rows = [{"A": "only_a"}]  # "B" key missing
        result = self.service._write_excel(headers, rows)
        wb = load_workbook(io.BytesIO(result))
        ws = wb.active
        # openpyxl returns None for empty string cells; both indicate "no value"
        cell_value = ws.cell(row=2, column=2).value
        assert cell_value in ("", None)

    def test_column_width_adjusted(self):
        headers = ["SHORT", "A_VERY_LONG_COLUMN_HEADER_NAME"]
        rows = [{"SHORT": "x", "A_VERY_LONG_COLUMN_HEADER_NAME": "y"}]
        result = self.service._write_excel(headers, rows)
        wb = load_workbook(io.BytesIO(result))
        ws = wb.active
        # Longer header should produce wider column
        col1_width = ws.column_dimensions["A"].width
        col2_width = ws.column_dimensions["B"].width
        assert col2_width > col1_width


# ---------------------------------------------------------------------------
# _build_type_a_data
# ---------------------------------------------------------------------------


class TestBuildTypeAData:
    def setup_method(self):
        self.service = ExportService()

    def _make_layers_and_mappings(self):
        layers = [
            make_project_layer("LAYER_A", {"spin_speed": 2000, "energy": 35.0}, pl_id=1),
            make_project_layer("LAYER_B", {"spin_speed": 2500}, pl_id=2),
        ]
        mappings = [
            make_mapping("SPIN_SPEED", "spin_speed", sort_order=1, is_required=True),
            make_mapping("EXPOSE_ENERGY", "energy", sort_order=2, is_required=True),
        ]
        return layers, mappings

    def test_headers_include_fixed_and_mapped_columns(self):
        layers, mappings = self._make_layers_and_mappings()
        headers, _ = self.service._build_type_a_data("PROD-A", layers, mappings)
        assert headers[0] == "LAYER_ID"
        assert headers[1] == "PRODUCT_ID"
        assert "SPIN_SPEED" in headers
        assert "EXPOSE_ENERGY" in headers

    def test_row_count_equals_layer_count(self):
        layers, mappings = self._make_layers_and_mappings()
        _, rows = self.service._build_type_a_data("PROD-A", layers, mappings)
        assert len(rows) == 2

    def test_layer_name_and_product_name_in_row(self):
        layers, mappings = self._make_layers_and_mappings()
        _, rows = self.service._build_type_a_data("PROD-A", layers, mappings)
        assert rows[0]["LAYER_ID"] == "LAYER_A"
        assert rows[0]["PRODUCT_ID"] == "PROD-A"

    def test_condition_value_mapped_to_target_column(self):
        layers, mappings = self._make_layers_and_mappings()
        _, rows = self.service._build_type_a_data("PROD-A", layers, mappings)
        assert rows[0]["SPIN_SPEED"] == 2000
        assert rows[0]["EXPOSE_ENERGY"] == 35.0

    def test_missing_condition_returns_empty_string(self):
        layers, mappings = self._make_layers_and_mappings()
        _, rows = self.service._build_type_a_data("PROD-A", layers, mappings)
        # LAYER_B has no "energy" key
        assert rows[1]["EXPOSE_ENERGY"] == ""

    def test_required_null_logs_warning(self, caplog):
        layers = [
            make_project_layer("LAYER_A", {}, pl_id=1),  # all conditions missing
        ]
        mappings = [
            make_mapping("SPIN_SPEED", "spin_speed", is_required=True),
        ]
        with caplog.at_level(logging.WARNING, logger="app.services.export_service"):
            self.service._build_type_a_data("PROD-A", layers, mappings)
        assert any("spin_speed" in record.message for record in caplog.records)

    def test_optional_null_does_not_log_warning(self, caplog):
        layers = [
            make_project_layer("LAYER_A", {}, pl_id=1),
        ]
        mappings = [
            make_mapping("OPTIONAL_COL", "optional_col", is_required=False),
        ]
        with caplog.at_level(logging.WARNING, logger="app.services.export_service"):
            self.service._build_type_a_data("PROD-A", layers, mappings)
        assert len(caplog.records) == 0

    def test_empty_conditions_dict(self):
        layers = [make_project_layer("LAYER_A", {}, pl_id=1)]
        mappings = [make_mapping("SPEED", "spin_speed", is_required=False)]
        headers, rows = self.service._build_type_a_data("PROD-A", layers, mappings)
        assert rows[0]["SPEED"] == ""

    def test_none_conditions_treated_as_empty(self):
        layers = [make_project_layer("LAYER_A", None, pl_id=1)]
        mappings = [make_mapping("SPEED", "spin_speed")]
        _, rows = self.service._build_type_a_data("PROD-A", layers, mappings)
        assert rows[0]["SPEED"] == ""


# ---------------------------------------------------------------------------
# _build_type_b_data
# ---------------------------------------------------------------------------


class TestBuildTypeBData:
    def setup_method(self):
        self.service = ExportService()

    def test_headers_include_equip_id(self):
        layers = [make_project_layer("LAYER_A", {"speed": 2000}, pl_id=1)]
        mappings = [make_mapping("SPEED", "speed")]
        equipment = {}
        headers, _ = self.service._build_type_b_data("PROD-A", layers, mappings, equipment)
        assert "EQUIP_ID" in headers
        assert headers.index("EQUIP_ID") == 2  # Third column after LAYER_ID, PRODUCT_ID

    def test_no_equipment_produces_single_row_with_empty_equip_id(self):
        layers = [make_project_layer("LAYER_A", {"speed": 1500}, pl_id=1)]
        mappings = [make_mapping("SPEED", "speed")]
        equipment = {}
        _, rows = self.service._build_type_b_data("PROD-A", layers, mappings, equipment)
        assert len(rows) == 1
        assert rows[0]["EQUIP_ID"] == ""

    def test_two_equipment_produces_two_rows(self):
        layers = [make_project_layer("LAYER_A", {"speed": 2000}, pl_id=1)]
        mappings = [make_mapping("SPEED", "speed")]
        equipment = {
            1: [
                make_equipment_assignment(1, "EQ-01", {}, sort_order=0),
                make_equipment_assignment(1, "EQ-02", {}, sort_order=1),
            ]
        }
        _, rows = self.service._build_type_b_data("PROD-A", layers, mappings, equipment)
        assert len(rows) == 2
        assert rows[0]["EQUIP_ID"] == "EQ-01"
        assert rows[1]["EQUIP_ID"] == "EQ-02"

    def test_equipment_param_overrides_base_condition(self):
        layers = [make_project_layer("LAYER_A", {"speed": 2000}, pl_id=1)]
        mappings = [make_mapping("SPEED", "speed")]
        equipment = {
            1: [
                make_equipment_assignment(1, "EQ-01", {"speed": 3000}, sort_order=0),
            ]
        }
        _, rows = self.service._build_type_b_data("PROD-A", layers, mappings, equipment)
        assert rows[0]["SPEED"] == 3000  # override applied

    def test_equipment_param_only_overrides_specified_keys(self):
        layers = [make_project_layer("LAYER_A", {"speed": 2000, "energy": 35.0}, pl_id=1)]
        mappings = [
            make_mapping("SPEED", "speed"),
            make_mapping("ENERGY", "energy"),
        ]
        equipment = {
            1: [
                make_equipment_assignment(1, "EQ-01", {"speed": 2500}, sort_order=0),
            ]
        }
        _, rows = self.service._build_type_b_data("PROD-A", layers, mappings, equipment)
        assert rows[0]["SPEED"] == 2500   # overridden
        assert rows[0]["ENERGY"] == 35.0  # from base conditions

    def test_base_condition_used_when_no_equipment_override(self):
        layers = [make_project_layer("LAYER_A", {"speed": 1800}, pl_id=1)]
        mappings = [make_mapping("SPEED", "speed")]
        equipment = {
            1: [
                make_equipment_assignment(1, "EQ-01", {}, sort_order=0),  # no overrides
            ]
        }
        _, rows = self.service._build_type_b_data("PROD-A", layers, mappings, equipment)
        assert rows[0]["SPEED"] == 1800  # base condition used

    def test_multiple_layers_with_mixed_equipment(self):
        layers = [
            make_project_layer("LAYER_A", {"speed": 2000}, pl_id=1),
            make_project_layer("LAYER_B", {"speed": 2500}, pl_id=2),
        ]
        mappings = [make_mapping("SPEED", "speed")]
        equipment = {
            1: [make_equipment_assignment(1, "EQ-01", {}, sort_order=0)],
            # pl_id=2 has no equipment
        }
        _, rows = self.service._build_type_b_data("PROD-A", layers, mappings, equipment)
        # LAYER_A: 1 equipment row; LAYER_B: 1 no-equipment row
        assert len(rows) == 2
        assert rows[0]["LAYER_ID"] == "LAYER_A"
        assert rows[0]["EQUIP_ID"] == "EQ-01"
        assert rows[1]["LAYER_ID"] == "LAYER_B"
        assert rows[1]["EQUIP_ID"] == ""

    def test_none_conditions_handled(self):
        layers = [make_project_layer("LAYER_A", None, pl_id=1)]
        mappings = [make_mapping("SPEED", "speed")]
        equipment = {}
        _, rows = self.service._build_type_b_data("PROD-A", layers, mappings, equipment)
        assert rows[0]["SPEED"] == ""


# ---------------------------------------------------------------------------
# _build_type_c_data
# ---------------------------------------------------------------------------


class TestBuildTypeCData:
    def setup_method(self):
        self.service = ExportService()

    def test_headers_are_fixed_five_columns(self):
        headers, _ = self.service._build_type_c_data("PROD-A", [], [], {})
        assert headers == ["LAYER_ID", "PRODUCT_ID", "PARAM_KEY", "PARAM_VALUE", "UNIT"]

    def test_row_count_is_layers_times_mappings(self):
        layers = [
            make_project_layer("LAYER_A", {"speed": 2000, "energy": 35.0}, pl_id=1),
            make_project_layer("LAYER_B", {"speed": 2500, "energy": 42.0}, pl_id=2),
        ]
        mappings = [
            make_mapping("SPEED", "speed"),
            make_mapping("ENERGY", "energy"),
        ]
        _, rows = self.service._build_type_c_data("PROD-A", layers, mappings, {})
        assert len(rows) == 4  # 2 layers x 2 mappings

    def test_param_key_is_target_column_name(self):
        layers = [make_project_layer("LAYER_A", {"speed": 2000}, pl_id=1)]
        mappings = [make_mapping("SPIN_SPEED_RPM", "speed")]
        _, rows = self.service._build_type_c_data("PROD-A", layers, mappings, {})
        assert rows[0]["PARAM_KEY"] == "SPIN_SPEED_RPM"

    def test_param_value_from_conditions(self):
        layers = [make_project_layer("LAYER_A", {"speed": 2000}, pl_id=1)]
        mappings = [make_mapping("SPEED", "speed")]
        _, rows = self.service._build_type_c_data("PROD-A", layers, mappings, {})
        assert rows[0]["PARAM_VALUE"] == 2000

    def test_unit_from_unit_mappings(self):
        layers = [make_project_layer("LAYER_A", {"speed": 2000}, pl_id=1)]
        mappings = [make_mapping("SPEED", "speed")]
        unit_mappings = {"speed": "rpm"}
        _, rows = self.service._build_type_c_data("PROD-A", layers, mappings, unit_mappings)
        assert rows[0]["UNIT"] == "rpm"

    def test_missing_unit_defaults_to_empty_string(self):
        layers = [make_project_layer("LAYER_A", {"speed": 2000}, pl_id=1)]
        mappings = [make_mapping("SPEED", "speed")]
        unit_mappings = {}  # no unit for "speed"
        _, rows = self.service._build_type_c_data("PROD-A", layers, mappings, unit_mappings)
        assert rows[0]["UNIT"] == ""

    def test_missing_condition_value_defaults_to_empty_string(self):
        layers = [make_project_layer("LAYER_A", {}, pl_id=1)]  # no conditions
        mappings = [make_mapping("SPEED", "speed")]
        _, rows = self.service._build_type_c_data("PROD-A", layers, mappings, {})
        assert rows[0]["PARAM_VALUE"] == ""

    def test_layer_id_and_product_id_repeated_per_param(self):
        layers = [make_project_layer("LAYER_A", {"speed": 1000, "energy": 20.0}, pl_id=1)]
        mappings = [
            make_mapping("SPEED", "speed"),
            make_mapping("ENERGY", "energy"),
        ]
        _, rows = self.service._build_type_c_data("MY-PROD", layers, mappings, {})
        assert rows[0]["LAYER_ID"] == "LAYER_A"
        assert rows[0]["PRODUCT_ID"] == "MY-PROD"
        assert rows[1]["LAYER_ID"] == "LAYER_A"
        assert rows[1]["PRODUCT_ID"] == "MY-PROD"

    def test_none_conditions_handled(self):
        layers = [make_project_layer("LAYER_A", None, pl_id=1)]
        mappings = [make_mapping("SPEED", "speed")]
        _, rows = self.service._build_type_c_data("PROD-A", layers, mappings, {})
        assert rows[0]["PARAM_VALUE"] == ""


# ---------------------------------------------------------------------------
# _generate_type_a, _generate_type_b, _generate_type_c (integration with _write_excel)
# ---------------------------------------------------------------------------


class TestGenerateTypes:
    """Verify that each _generate_type_X method produces valid xlsx bytes."""

    def setup_method(self):
        self.service = ExportService()

    def test_generate_type_a_produces_xlsx(self):
        layers = [make_project_layer("LAYER_A", {"speed": 2000}, pl_id=1)]
        mappings = [make_mapping("SPEED", "speed")]
        result = self.service._generate_type_a("PROD-A", layers, mappings)
        wb = load_workbook(io.BytesIO(result))
        ws = wb.active
        assert ws.cell(row=1, column=1).value == "LAYER_ID"
        assert ws.cell(row=2, column=1).value == "LAYER_A"

    def test_generate_type_b_produces_xlsx(self):
        layers = [make_project_layer("LAYER_A", {"speed": 2000}, pl_id=1)]
        mappings = [make_mapping("SPEED", "speed")]
        equipment = {1: [make_equipment_assignment(1, "EQ-01", {})]}
        result = self.service._generate_type_b("PROD-A", layers, mappings, equipment)
        wb = load_workbook(io.BytesIO(result))
        ws = wb.active
        # Check EQUIP_ID header is present
        header_row = [ws.cell(row=1, column=i).value for i in range(1, 5)]
        assert "EQUIP_ID" in header_row

    def test_generate_type_c_produces_xlsx(self):
        layers = [make_project_layer("LAYER_A", {"speed": 2000}, pl_id=1)]
        mappings = [make_mapping("SPEED", "speed")]
        result = self.service._generate_type_c("PROD-A", layers, mappings, {"speed": "rpm"})
        wb = load_workbook(io.BytesIO(result))
        ws = wb.active
        header_row = [ws.cell(row=1, column=i).value for i in range(1, 6)]
        assert "PARAM_KEY" in header_row
        assert "PARAM_VALUE" in header_row
        assert "UNIT" in header_row
        # Verify unit appears in data
        data_row = [ws.cell(row=2, column=i).value for i in range(1, 6)]
        assert "rpm" in data_row
