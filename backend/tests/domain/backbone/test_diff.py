from __future__ import annotations

import pytest

from app.domain.backbone.diff import (
    DIFF_BASIS_INVALID,
    BackboneDiffCurrentCell,
    BackboneDiffCurrentCondition,
    BackboneDiffCurrentParameter,
    BackboneDiffLayerInput,
    backbone_diff_basis_hash,
    backbone_diff_layer_basis_hash,
    compare_backbone,
    compare_backbone_layer,
)
from app.domain.backbone.snapshot import (
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
    UNRESOLVED_PARAMETER_METADATA,
)
from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType


def _baseline_snapshot() -> BackboneSnapshot:
    return BackboneSnapshot(
        capture_batch_id="0123456789abcdef0123456789abcdef",
        captured_at="2026-07-16T04:17:58.715000Z",
        source=BackboneSnapshotSource(
            project_id=42,
            sheet_layer_id=7,
            layer_key="L1::PROC_ALPHA::010::ACT",
            step_seq="010",
            layer_id="ACT",
        ),
        columns=(
            BackboneSnapshotColumn("baseline_only", ValueType.TEXT, "Baseline only", None, 0, True),
            BackboneSnapshotColumn("shared_blank", ValueType.TEXT, "Blank", None, 1, True),
            BackboneSnapshotColumn("shared_number_equal", ValueType.NUMBER, "Number equal", None, 2, True),
            BackboneSnapshotColumn("shared_number_changed", ValueType.NUMBER, "Number changed", None, 3, True),
            BackboneSnapshotColumn("shared_text_equal", ValueType.TEXT, "Text equal", None, 4, True),
            BackboneSnapshotColumn("shared_text_changed", ValueType.TEXT, "Text changed", None, 5, True),
            BackboneSnapshotColumn("shared_choice_equal", ValueType.CHOICE, "Choice equal", None, 6, True),
            BackboneSnapshotColumn("shared_choice_changed", ValueType.CHOICE, "Choice changed", None, 7, True),
            BackboneSnapshotColumn("shared_cleared", ValueType.TEXT, "Cleared", None, 8, True),
            BackboneSnapshotColumn("shared_added", ValueType.TEXT, "Added", None, 9, True),
        ),
        conditions=(
            BackboneSnapshotCondition(
                source_condition_id=10,
                label="Line A",
                condition_index=0,
                is_por=True,
                cells=(
                    BackboneSnapshotCell("baseline_only", "legacy"),
                    BackboneSnapshotCell("shared_number_equal", "1.00"),
                    BackboneSnapshotCell("shared_number_changed", "2.0"),
                    BackboneSnapshotCell("shared_text_equal", "same"),
                    BackboneSnapshotCell("shared_text_changed", "old"),
                    BackboneSnapshotCell("shared_choice_equal", "CHOICE_A"),
                    BackboneSnapshotCell("shared_choice_changed", "CHOICE_X"),
                    BackboneSnapshotCell("shared_cleared", "to-clear"),
                ),
            ),
            BackboneSnapshotCondition(
                source_condition_id=20,
                label="Line B",
                condition_index=1,
                is_por=False,
                cells=(),
            ),
        ),
    )


def _layer_input(
    *,
    baseline_snapshot: BackboneSnapshot | None,
    current_conditions: tuple[BackboneDiffCurrentCondition, ...],
    include_orphan: bool = False,
) -> BackboneDiffLayerInput:
    parameters = [
        BackboneDiffCurrentParameter("shared_blank", ValueType.TEXT, "Blank", None, 1, True),
        BackboneDiffCurrentParameter("shared_number_equal", ValueType.NUMBER, "Number equal", None, 2, True),
        BackboneDiffCurrentParameter("shared_number_changed", ValueType.NUMBER, "Number changed", None, 3, True),
        BackboneDiffCurrentParameter("shared_text_equal", ValueType.TEXT, "Text equal", None, 4, True),
        BackboneDiffCurrentParameter("shared_text_changed", ValueType.TEXT, "Text changed", None, 5, True),
        BackboneDiffCurrentParameter("shared_choice_equal", ValueType.CHOICE, "Choice equal", None, 6, True),
        BackboneDiffCurrentParameter("shared_choice_changed", ValueType.CHOICE, "Choice changed", None, 7, True),
        BackboneDiffCurrentParameter("shared_cleared", ValueType.TEXT, "Cleared", None, 8, True),
        BackboneDiffCurrentParameter("shared_added", ValueType.TEXT, "Added", None, 9, True),
        BackboneDiffCurrentParameter("current_only", ValueType.TEXT, "Current only", None, 10, True),
        BackboneDiffCurrentParameter("baseline_only", ValueType.TEXT, "Baseline only", None, 11, False),
    ]
    if include_orphan:
        parameters.append(
            BackboneDiffCurrentParameter("orphan_inactive", ValueType.TEXT, "Orphan", None, 99, False)
        )

    return BackboneDiffLayerInput(
        layer_key="L1::PROC_ALPHA::010::ACT",
        layer_sort_order=1,
        baseline_snapshot=baseline_snapshot,
        current_conditions=current_conditions,
        current_parameters=tuple(parameters),
    )


def _matched_current_condition() -> BackboneDiffCurrentCondition:
    return BackboneDiffCurrentCondition(
        id=101,
        source_condition_id=10,
        label="Line A v2",
        condition_index=0,
        is_por=False,
        cells=(
            BackboneDiffCurrentCell("shared_number_equal", "1.0"),
            BackboneDiffCurrentCell("shared_number_changed", "3.5"),
            BackboneDiffCurrentCell("shared_text_equal", "same"),
            BackboneDiffCurrentCell("shared_text_changed", "new"),
            BackboneDiffCurrentCell("shared_choice_equal", "CHOICE_A"),
            BackboneDiffCurrentCell("shared_choice_changed", "CHOICE_Y"),
            BackboneDiffCurrentCell("shared_cleared", None),
            BackboneDiffCurrentCell("shared_added", "created"),
            BackboneDiffCurrentCell("shared_blank", None),
            BackboneDiffCurrentCell("current_only", "fresh"),
        ),
    )


def _duplicate_current_condition() -> BackboneDiffCurrentCondition:
    return BackboneDiffCurrentCondition(
        id=102,
        source_condition_id=10,
        label="Line A duplicate",
        condition_index=2,
        is_por=True,
        cells=(
            BackboneDiffCurrentCell("shared_number_equal", "1.00"),
            BackboneDiffCurrentCell("shared_text_equal", "same"),
            BackboneDiffCurrentCell("current_only", "fresh"),
        ),
    )


def _added_current_condition() -> BackboneDiffCurrentCondition:
    return BackboneDiffCurrentCondition(
        id=201,
        source_condition_id=99,
        label="Line C",
        condition_index=3,
        is_por=False,
        cells=(BackboneDiffCurrentCell("current_only", "fresh"),),
    )


def test_compare_backbone_layer_classifies_and_orders_all_core_cases() -> None:
    layer = _layer_input(
        baseline_snapshot=_baseline_snapshot(),
        current_conditions=(
            _matched_current_condition(),
            _duplicate_current_condition(),
        ),
    )

    result = compare_backbone_layer(layer)

    assert result.baseline_unavailable is False
    assert result.ambiguous_lineage_count == 1
    assert [row.row_status for row in result.rows] == ["matched", "removed", "added"]

    matched_row = result.rows[0]
    assert [change.field_name for change in matched_row.metadata_changes] == [
        "label",
        "is_por",
    ]

    cell_by_code = {change.parameter_code: change for change in matched_row.cell_changes}
    assert cell_by_code["baseline_only"].classification == "removed"
    assert cell_by_code["baseline_only"].reason == "column_removed"
    assert cell_by_code["shared_blank"].classification == "unchanged"
    assert cell_by_code["shared_blank"].reason == "null_equal"
    assert cell_by_code["shared_number_equal"].classification == "unchanged"
    assert cell_by_code["shared_number_equal"].current_value == "1"
    assert cell_by_code["shared_number_changed"].classification == "changed"
    assert cell_by_code["shared_text_equal"].classification == "unchanged"
    assert cell_by_code["shared_text_changed"].classification == "changed"
    assert cell_by_code["shared_choice_equal"].classification == "unchanged"
    assert cell_by_code["shared_choice_changed"].classification == "changed"
    assert cell_by_code["shared_cleared"].classification == "cleared"
    assert cell_by_code["shared_added"].classification == "added"
    assert cell_by_code["current_only"].classification == "added"
    assert cell_by_code["current_only"].reason == "column_added"

    matched_preview = [
        item
        for item in result.preview_items
        if item.row_status == "matched" and item.identity == 101
    ]
    assert [item.item_kind for item in matched_preview[:2]] == ["row_metadata", "row_metadata"]
    assert [item.field_name for item in matched_preview[:2]] == ["label", "is_por"]
    assert [item.parameter_code for item in matched_preview[2:]] == [
        "baseline_only",
        "shared_blank",
        "shared_number_equal",
        "shared_number_changed",
        "shared_text_equal",
        "shared_text_changed",
        "shared_choice_equal",
        "shared_choice_changed",
        "shared_cleared",
        "shared_added",
        "current_only",
    ]


def test_compare_backbone_layer_is_stable_under_input_shuffling_and_ignores_orphan_inactive_parameters() -> None:
    current_conditions = (
        _duplicate_current_condition(),
        _matched_current_condition(),
    )
    shuffled = _layer_input(
        baseline_snapshot=_baseline_snapshot(),
        current_conditions=current_conditions,
        include_orphan=False,
    )
    shuffled_with_orphan = _layer_input(
        baseline_snapshot=_baseline_snapshot(),
        current_conditions=tuple(reversed(current_conditions)),
        include_orphan=True,
    )

    result_a = compare_backbone_layer(shuffled)
    result_b = compare_backbone_layer(shuffled_with_orphan)

    assert result_a.basis_hash == result_b.basis_hash
    assert result_a.preview_items == result_b.preview_items
    assert backbone_diff_layer_basis_hash(shuffled) == backbone_diff_layer_basis_hash(shuffled_with_orphan)


def test_compare_backbone_layer_fails_closed_on_type_mismatch_and_missing_descriptor() -> None:
    baseline = _baseline_snapshot()

    mismatch_layer = BackboneDiffLayerInput(
        layer_key="L1::PROC_ALPHA::010::ACT",
        layer_sort_order=1,
        baseline_snapshot=baseline,
        current_conditions=(
            BackboneDiffCurrentCondition(
                id=101,
                source_condition_id=10,
                label="Line A",
                condition_index=0,
                is_por=True,
                cells=(BackboneDiffCurrentCell("shared_number_equal", "1.0"),),
            ),
        ),
        current_parameters=(
            BackboneDiffCurrentParameter("shared_number_equal", ValueType.TEXT, "Number equal", None, 2, True),
        ),
    )
    with pytest.raises(RuleViolationError) as exc_info:
        compare_backbone_layer(mismatch_layer)
    assert exc_info.value.code == DIFF_BASIS_INVALID

    missing_descriptor_layer = BackboneDiffLayerInput(
        layer_key="L1::PROC_ALPHA::010::ACT",
        layer_sort_order=1,
        baseline_snapshot=baseline,
        current_conditions=(
            BackboneDiffCurrentCondition(
                id=201,
                source_condition_id=99,
                label="Line C",
                condition_index=3,
                is_por=False,
                cells=(BackboneDiffCurrentCell("missing_code", "fresh"),),
            ),
        ),
        current_parameters=(
            BackboneDiffCurrentParameter("current_only", ValueType.TEXT, "Current only", None, 10, True),
        ),
    )
    with pytest.raises(RuleViolationError) as exc_info:
        compare_backbone_layer(missing_descriptor_layer)
    assert exc_info.value.code == UNRESOLVED_PARAMETER_METADATA


def test_compare_backbone_layer_baseline_unavailable_has_no_diff_items() -> None:
    layer = _layer_input(
        baseline_snapshot=None,
        current_conditions=(
            _matched_current_condition(),
            _added_current_condition(),
        ),
        include_orphan=True,
    )

    result = compare_backbone_layer(layer)

    assert result.baseline_unavailable is True
    assert result.rows == ()
    assert result.item_count == 0
    assert result.matched_row_count == 0
    assert result.added_row_count == 0
    assert result.removed_row_count == 0


def test_compare_backbone_orders_layers_and_root_hash_is_stable() -> None:
    layer_a = _layer_input(
        baseline_snapshot=_baseline_snapshot(),
        current_conditions=(
            _matched_current_condition(),
            _duplicate_current_condition(),
        ),
    )
    layer_b = BackboneDiffLayerInput(
        layer_key="L2::PROC_BETA::020::ACT",
        layer_sort_order=0,
        baseline_snapshot=None,
        current_conditions=(
            _added_current_condition(),
        ),
        current_parameters=(
            BackboneDiffCurrentParameter("current_only", ValueType.TEXT, "Current only", None, 10, True),
        ),
    )

    result_a = compare_backbone([layer_a, layer_b])
    result_b = compare_backbone([layer_b, layer_a])

    assert result_a.basis_hash == result_b.basis_hash
    assert [layer.layer_key for layer in result_a.layer_results] == [
        "L2::PROC_BETA::020::ACT",
        "L1::PROC_ALPHA::010::ACT",
    ]
    assert all(item.layer_key == "L1::PROC_ALPHA::010::ACT" for item in result_a.preview_items)
