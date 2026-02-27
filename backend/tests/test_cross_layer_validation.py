"""
Tests for app.services.cross_layer_validation_service

Pure-function unit tests: no DB or async required.
Uses SimpleNamespace to simulate ORM models.

Coverage:
- _validate_reference_exists: reference found, missing, blank skip, target=layer_names
- _validate_compare_layers: pass/fail, threshold_ratio, non-numeric skip, ref missing
- _validate_equipment_compatibility: same_value pass/fail, within_range pass/fail, <2 skip
- _apply_operator: all 6 operators (<=, >=, <, >, ==, !=)
"""

from types import SimpleNamespace

import pytest

from app.services.cross_layer_validation_service import (
    _apply_operator,
    _validate_compare_layers,
    _validate_equipment_compatibility,
    _validate_reference_exists,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_rule(rule_config: dict) -> SimpleNamespace:
    """Mock ColumnValidation with rule_config."""
    return SimpleNamespace(rule_config=rule_config)


def make_project_layer(
    pl_id: int,
    layer_name: str,
    conditions: dict,
    step_seq: str | None = None,
) -> SimpleNamespace:
    """Mock ProjectLayer with denormalized layer_name and step_seq."""
    return SimpleNamespace(
        id=pl_id,
        layer_id=str(float(pl_id)),
        layer_name=layer_name,
        step_seq=step_seq,
        conditions=conditions,
    )


COL_BY_NAME = {
    "OVL_REF_LAYER": {"display_name": "OVL Ref Layer"},
    "SP_SPIN1_SPEED_rpm": {"display_name": "Spin1 Speed"},
    "SC_EXPOSE_ENERGY_mJ": {"display_name": "Expose Energy"},
    "PARAM_X": {"display_name": "Param X"},
}


# ===========================================================================
# _apply_operator
# ===========================================================================

class TestApplyOperator:
    """Test all 6 comparison operators."""

    @pytest.mark.parametrize("op,current,threshold,expected", [
        ("<=", 5.0, 10.0, True),
        ("<=", 10.0, 10.0, True),
        ("<=", 11.0, 10.0, False),
        (">=", 15.0, 10.0, True),
        (">=", 10.0, 10.0, True),
        (">=", 9.0, 10.0, False),
        ("<", 5.0, 10.0, True),
        ("<", 10.0, 10.0, False),
        (">", 15.0, 10.0, True),
        (">", 10.0, 10.0, False),
        ("==", 10.0, 10.0, True),
        ("==", 10.1, 10.0, False),
        ("!=", 5.0, 10.0, True),
        ("!=", 10.0, 10.0, False),
    ])
    def test_operator(self, op, current, threshold, expected):
        assert _apply_operator(current, op, threshold) is expected

    def test_unknown_operator_returns_true(self):
        assert _apply_operator(1.0, "???", 2.0) is True


# ===========================================================================
# _validate_reference_exists
# ===========================================================================

class TestValidateReferenceExists:

    def test_reference_found_by_step_seq(self):
        """Value matches a step_seq -> no error."""
        rule = make_rule({"source_column": "OVL_REF_LAYER"})
        pl = make_project_layer(1, "LAYER_A", {"OVL_REF_LAYER": "ts200000"})
        errors: list = []
        _validate_reference_exists(
            rule, pl, "LAYER_A",
            step_seqs={"ts100000", "ts200000"},
            layer_names={"LAYER_A", "LAYER_B"},
            col_by_name=COL_BY_NAME,
            errors=errors,
        )
        assert errors == []

    def test_reference_not_found(self):
        """Value does not exist in step_seqs -> error."""
        rule = make_rule({"source_column": "OVL_REF_LAYER"})
        pl = make_project_layer(1, "LAYER_A", {"OVL_REF_LAYER": "ts999999"})
        errors: list = []
        _validate_reference_exists(
            rule, pl, "LAYER_A",
            step_seqs={"ts100000", "ts200000"},
            layer_names={"LAYER_A", "LAYER_B"},
            col_by_name=COL_BY_NAME,
            errors=errors,
        )
        assert len(errors) == 1
        assert errors[0]["metadata"]["check_type"] == "reference_exists"
        assert "ts999999" in errors[0]["message"]

    def test_blank_value_skipped(self):
        """Empty string value -> skip validation."""
        rule = make_rule({"source_column": "OVL_REF_LAYER"})
        pl = make_project_layer(1, "LAYER_A", {"OVL_REF_LAYER": "  "})
        errors: list = []
        _validate_reference_exists(
            rule, pl, "LAYER_A",
            step_seqs=set(), layer_names=set(),
            col_by_name=COL_BY_NAME, errors=errors,
        )
        assert errors == []

    def test_none_value_skipped(self):
        """None value -> skip validation."""
        rule = make_rule({"source_column": "OVL_REF_LAYER"})
        pl = make_project_layer(1, "LAYER_A", {"OVL_REF_LAYER": None})
        errors: list = []
        _validate_reference_exists(
            rule, pl, "LAYER_A",
            step_seqs=set(), layer_names=set(),
            col_by_name=COL_BY_NAME, errors=errors,
        )
        assert errors == []

    def test_missing_column_value_skipped(self):
        """Column not present in conditions -> skip."""
        rule = make_rule({"source_column": "OVL_REF_LAYER"})
        pl = make_project_layer(1, "LAYER_A", {})
        errors: list = []
        _validate_reference_exists(
            rule, pl, "LAYER_A",
            step_seqs=set(), layer_names=set(),
            col_by_name=COL_BY_NAME, errors=errors,
        )
        assert errors == []

    def test_target_layer_names_mode(self):
        """target=layer_names -> lookup in layer_names set."""
        rule = make_rule({"source_column": "OVL_REF_LAYER", "target": "layer_names"})
        pl = make_project_layer(1, "LAYER_A", {"OVL_REF_LAYER": "LAYER_B"})
        errors: list = []
        _validate_reference_exists(
            rule, pl, "LAYER_A",
            step_seqs=set(),
            layer_names={"LAYER_A", "LAYER_B"},
            col_by_name=COL_BY_NAME, errors=errors,
        )
        assert errors == []

    def test_target_layer_names_not_found(self):
        """target=layer_names but value not in set -> error."""
        rule = make_rule({"source_column": "OVL_REF_LAYER", "target": "layer_names"})
        pl = make_project_layer(1, "LAYER_A", {"OVL_REF_LAYER": "LAYER_Z"})
        errors: list = []
        _validate_reference_exists(
            rule, pl, "LAYER_A",
            step_seqs=set(),
            layer_names={"LAYER_A", "LAYER_B"},
            col_by_name=COL_BY_NAME, errors=errors,
        )
        assert len(errors) == 1

    def test_no_source_column_config(self):
        """Missing source_column in config -> early return."""
        rule = make_rule({})
        pl = make_project_layer(1, "LAYER_A", {"OVL_REF_LAYER": "ts200000"})
        errors: list = []
        _validate_reference_exists(
            rule, pl, "LAYER_A",
            step_seqs={"ts200000"}, layer_names=set(),
            col_by_name=COL_BY_NAME, errors=errors,
        )
        assert errors == []


# ===========================================================================
# _validate_compare_layers
# ===========================================================================

class TestValidateCompareLayers:

    def _make_pls(self):
        """Create two project layers: LAYER_A references LAYER_B via step_seq."""
        pl_a = make_project_layer(
            1, "LAYER_A",
            {"OVL_REF_LAYER": "ts200000", "SP_SPIN1_SPEED_rpm": "100"},
            step_seq="ts100000",
        )
        pl_b = make_project_layer(
            2, "LAYER_B",
            {"SP_SPIN1_SPEED_rpm": "200"},
            step_seq="ts200000",
        )
        step_seq_to_pl = {"ts100000": pl_a, "ts200000": pl_b}
        layer_name_to_pl = {"LAYER_A": pl_a, "LAYER_B": pl_b}
        return pl_a, pl_b, step_seq_to_pl, layer_name_to_pl

    def test_comparison_pass(self):
        """100 <= 200 -> pass."""
        pl_a, pl_b, s2p, l2p = self._make_pls()
        rule = make_rule({
            "column": "SP_SPIN1_SPEED_rpm",
            "operator": "<=",
            "reference_layer_column": "OVL_REF_LAYER",
        })
        errors: list = []
        _validate_compare_layers(rule, pl_a, "LAYER_A", s2p, l2p, COL_BY_NAME, errors)
        assert errors == []

    def test_comparison_fail(self):
        """100 >= 200 -> fail (100 is NOT >= 200)."""
        pl_a, pl_b, s2p, l2p = self._make_pls()
        rule = make_rule({
            "column": "SP_SPIN1_SPEED_rpm",
            "operator": ">=",
            "reference_layer_column": "OVL_REF_LAYER",
        })
        errors: list = []
        _validate_compare_layers(rule, pl_a, "LAYER_A", s2p, l2p, COL_BY_NAME, errors)
        assert len(errors) == 1
        assert errors[0]["metadata"]["check_type"] == "compare_layers"

    def test_threshold_ratio(self):
        """100 <= 200*0.4(=80) -> fail (100 > 80)."""
        pl_a, pl_b, s2p, l2p = self._make_pls()
        rule = make_rule({
            "column": "SP_SPIN1_SPEED_rpm",
            "operator": "<=",
            "reference_layer_column": "OVL_REF_LAYER",
            "threshold_ratio": 0.4,
        })
        errors: list = []
        _validate_compare_layers(rule, pl_a, "LAYER_A", s2p, l2p, COL_BY_NAME, errors)
        assert len(errors) == 1

    def test_threshold_ratio_pass(self):
        """100 <= 200*0.6(=120) -> pass."""
        pl_a, pl_b, s2p, l2p = self._make_pls()
        rule = make_rule({
            "column": "SP_SPIN1_SPEED_rpm",
            "operator": "<=",
            "reference_layer_column": "OVL_REF_LAYER",
            "threshold_ratio": 0.6,
        })
        errors: list = []
        _validate_compare_layers(rule, pl_a, "LAYER_A", s2p, l2p, COL_BY_NAME, errors)
        assert errors == []

    def test_non_numeric_skip(self):
        """Non-numeric values -> silently skip."""
        pl_a = make_project_layer(
            1, "LAYER_A",
            {"OVL_REF_LAYER": "ts200000", "SP_SPIN1_SPEED_rpm": "abc"},
        )
        pl_b = make_project_layer(
            2, "LAYER_B", {"SP_SPIN1_SPEED_rpm": "200"}, step_seq="ts200000",
        )
        rule = make_rule({
            "column": "SP_SPIN1_SPEED_rpm",
            "operator": "<=",
            "reference_layer_column": "OVL_REF_LAYER",
        })
        errors: list = []
        _validate_compare_layers(
            rule, pl_a, "LAYER_A",
            {"ts200000": pl_b}, {"LAYER_B": pl_b},
            COL_BY_NAME, errors,
        )
        assert errors == []

    def test_ref_layer_not_found_skip(self):
        """Reference layer identifier doesn't match any PL -> skip."""
        pl_a = make_project_layer(
            1, "LAYER_A",
            {"OVL_REF_LAYER": "ts999999", "SP_SPIN1_SPEED_rpm": "100"},
        )
        rule = make_rule({
            "column": "SP_SPIN1_SPEED_rpm",
            "operator": "<=",
            "reference_layer_column": "OVL_REF_LAYER",
        })
        errors: list = []
        _validate_compare_layers(rule, pl_a, "LAYER_A", {}, {}, COL_BY_NAME, errors)
        assert errors == []

    def test_ref_column_blank_skip(self):
        """Blank reference column value -> skip."""
        pl_a = make_project_layer(1, "LAYER_A", {"OVL_REF_LAYER": "", "SP_SPIN1_SPEED_rpm": "100"})
        rule = make_rule({
            "column": "SP_SPIN1_SPEED_rpm",
            "operator": "<=",
            "reference_layer_column": "OVL_REF_LAYER",
        })
        errors: list = []
        _validate_compare_layers(rule, pl_a, "LAYER_A", {}, {}, COL_BY_NAME, errors)
        assert errors == []

    def test_missing_config_fields_skip(self):
        """Incomplete config (no column) -> early return."""
        rule = make_rule({"operator": "<=", "reference_layer_column": "OVL_REF_LAYER"})
        pl_a = make_project_layer(1, "LAYER_A", {})
        errors: list = []
        _validate_compare_layers(rule, pl_a, "LAYER_A", {}, {}, COL_BY_NAME, errors)
        assert errors == []

    def test_fallback_to_layer_name_lookup(self):
        """step_seq lookup miss, falls back to layer_name_to_pl."""
        pl_a = make_project_layer(
            1, "LAYER_A",
            {"OVL_REF_LAYER": "LAYER_B", "SP_SPIN1_SPEED_rpm": "100"},
        )
        pl_b = make_project_layer(
            2, "LAYER_B", {"SP_SPIN1_SPEED_rpm": "200"}, step_seq="ts200000",
        )
        rule = make_rule({
            "column": "SP_SPIN1_SPEED_rpm",
            "operator": "<=",
            "reference_layer_column": "OVL_REF_LAYER",
        })
        errors: list = []
        _validate_compare_layers(
            rule, pl_a, "LAYER_A",
            step_seq_to_pl={},
            layer_name_to_pl={"LAYER_B": pl_b},
            col_by_name=COL_BY_NAME,
            errors=errors,
        )
        assert errors == []


# ===========================================================================
# _validate_equipment_compatibility
# ===========================================================================

class TestValidateEquipmentCompatibility:

    def _make_group(self, values: list[tuple[str, float]]) -> dict:
        """Build equipment_groups with one group containing given (layer_name, value) pairs."""
        group_layers = []
        for i, (lname, val) in enumerate(values):
            pl = make_project_layer(i + 1, lname, {"PARAM_X": str(val)})
            group_layers.append((pl, lname))
        return {"EQ-001": group_layers}

    def test_same_value_pass(self):
        """All layers have identical value -> no error."""
        groups = self._make_group([("L1", 10.0), ("L2", 10.0), ("L3", 10.0)])
        rule = make_rule({"column": "PARAM_X", "compatibility": "same_value"})
        errors: list = []
        _validate_equipment_compatibility(rule, groups, COL_BY_NAME, errors)
        assert errors == []

    def test_same_value_fail(self):
        """Different values -> error."""
        groups = self._make_group([("L1", 10.0), ("L2", 20.0)])
        rule = make_rule({"column": "PARAM_X", "compatibility": "same_value"})
        errors: list = []
        _validate_equipment_compatibility(rule, groups, COL_BY_NAME, errors)
        assert len(errors) == 1
        assert "equipment_compatibility" in errors[0]["metadata"]["check_type"]

    def test_within_range_pass(self):
        """Values within 10% tolerance of mean -> no error.
        mean=10.0, 10% tolerance -> range +-1.0. All within range.
        """
        groups = self._make_group([("L1", 9.5), ("L2", 10.5)])
        rule = make_rule({
            "column": "PARAM_X",
            "compatibility": "within_range",
            "range_tolerance": 0.1,
        })
        errors: list = []
        _validate_equipment_compatibility(rule, groups, COL_BY_NAME, errors)
        assert errors == []

    def test_within_range_fail(self):
        """Value deviates more than tolerance -> error.
        mean=15.0, tolerance=0.1, L1=10 -> deviation = |10-15|/15 = 0.33 > 0.1
        """
        groups = self._make_group([("L1", 10.0), ("L2", 20.0)])
        rule = make_rule({
            "column": "PARAM_X",
            "compatibility": "within_range",
            "range_tolerance": 0.1,
        })
        errors: list = []
        _validate_equipment_compatibility(rule, groups, COL_BY_NAME, errors)
        assert len(errors) == 1

    def test_less_than_two_values_skip(self):
        """Only 1 layer with value -> skip comparison."""
        groups = self._make_group([("L1", 10.0)])
        rule = make_rule({"column": "PARAM_X", "compatibility": "same_value"})
        errors: list = []
        _validate_equipment_compatibility(rule, groups, COL_BY_NAME, errors)
        assert errors == []

    def test_non_numeric_values_skipped(self):
        """Non-numeric values are excluded; if <2 remain, skip."""
        pl1 = make_project_layer(1, "L1", {"PARAM_X": "abc"})
        pl2 = make_project_layer(2, "L2", {"PARAM_X": "10.0"})
        groups = {"EQ-001": [(pl1, "L1"), (pl2, "L2")]}
        rule = make_rule({"column": "PARAM_X", "compatibility": "same_value"})
        errors: list = []
        _validate_equipment_compatibility(rule, groups, COL_BY_NAME, errors)
        # Only 1 numeric value remains -> skip
        assert errors == []

    def test_missing_column_config_skip(self):
        """No column in config -> early return."""
        rule = make_rule({"compatibility": "same_value"})
        errors: list = []
        _validate_equipment_compatibility(rule, {}, COL_BY_NAME, errors)
        assert errors == []

    def test_all_zero_within_range_pass(self):
        """All zeros with within_range -> mean=0 -> skip."""
        groups = self._make_group([("L1", 0.0), ("L2", 0.0)])
        rule = make_rule({
            "column": "PARAM_X",
            "compatibility": "within_range",
            "range_tolerance": 0.1,
        })
        errors: list = []
        _validate_equipment_compatibility(rule, groups, COL_BY_NAME, errors)
        assert errors == []

    def test_multiple_equipment_groups(self):
        """Two equipment groups, one failing, one passing."""
        pl1 = make_project_layer(1, "L1", {"PARAM_X": "10"})
        pl2 = make_project_layer(2, "L2", {"PARAM_X": "10"})
        pl3 = make_project_layer(3, "L3", {"PARAM_X": "10"})
        pl4 = make_project_layer(4, "L4", {"PARAM_X": "99"})
        groups = {
            "EQ-001": [(pl1, "L1"), (pl2, "L2")],   # same -> pass
            "EQ-002": [(pl3, "L3"), (pl4, "L4")],   # different -> fail
        }
        rule = make_rule({"column": "PARAM_X", "compatibility": "same_value"})
        errors: list = []
        _validate_equipment_compatibility(rule, groups, COL_BY_NAME, errors)
        assert len(errors) == 1
        assert "EQ-002" in errors[0]["message"]
