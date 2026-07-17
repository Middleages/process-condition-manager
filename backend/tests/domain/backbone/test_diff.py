from __future__ import annotations

from dataclasses import replace
from typing import Callable

import pytest

from app.domain.backbone.diff import (
    DIFF_BASIS_INVALID,
    BackboneDiffCurrentCell,
    BackboneDiffCurrentCondition,
    BackboneDiffCurrentLayerSource,
    BackboneDiffCurrentParameter,
    BackboneDiffLayerInput,
    backbone_diff_layer_basis_hash,
    compare_backbone,
    compare_backbone_layer,
)
from app.domain.backbone.snapshot import (
    UNRESOLVED_PARAMETER_METADATA,
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
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
            BackboneSnapshotColumn(
                "shared_number_equal", ValueType.NUMBER, "Number equal", None, 2, True
            ),
            BackboneSnapshotColumn(
                "shared_number_changed", ValueType.NUMBER, "Number changed", None, 3, True
            ),
            BackboneSnapshotColumn(
                "shared_text_equal", ValueType.TEXT, "Text equal", None, 4, True
            ),
            BackboneSnapshotColumn(
                "shared_text_changed", ValueType.TEXT, "Text changed", None, 5, True
            ),
            BackboneSnapshotColumn(
                "shared_choice_equal", ValueType.CHOICE, "Choice equal", None, 6, True
            ),
            BackboneSnapshotColumn(
                "shared_choice_changed", ValueType.CHOICE, "Choice changed", None, 7, True
            ),
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


def _current_source(
    *,
    project_id: int = 42,
    sheet_layer_id: int = 7,
    layer_key: str = "L1::PROC_ALPHA::010::ACT",
    step_seq: str = "010",
    layer_id: str = "ACT",
) -> BackboneSnapshotSource:
    return BackboneSnapshotSource(
        project_id=project_id,
        sheet_layer_id=sheet_layer_id,
        layer_key=layer_key,
        step_seq=step_seq,
        layer_id=layer_id,
    )


def _layer_input(
    *,
    baseline_snapshot: BackboneSnapshot | None,
    current_conditions: tuple[BackboneDiffCurrentCondition, ...],
    current_source: BackboneSnapshotSource | None = None,
    include_orphan: bool = False,
) -> BackboneDiffLayerInput:
    parameters = [
        BackboneDiffCurrentParameter("shared_blank", ValueType.TEXT, "Blank", None, 1, True),
        BackboneDiffCurrentParameter(
            "shared_number_equal", ValueType.NUMBER, "Number equal", None, 2, True
        ),
        BackboneDiffCurrentParameter(
            "shared_number_changed", ValueType.NUMBER, "Number changed", None, 3, True
        ),
        BackboneDiffCurrentParameter(
            "shared_text_equal", ValueType.TEXT, "Text equal", None, 4, True
        ),
        BackboneDiffCurrentParameter(
            "shared_text_changed", ValueType.TEXT, "Text changed", None, 5, True
        ),
        BackboneDiffCurrentParameter(
            "shared_choice_equal", ValueType.CHOICE, "Choice equal", None, 6, True
        ),
        BackboneDiffCurrentParameter(
            "shared_choice_changed", ValueType.CHOICE, "Choice changed", None, 7, True
        ),
        BackboneDiffCurrentParameter("shared_cleared", ValueType.TEXT, "Cleared", None, 8, True),
        BackboneDiffCurrentParameter("shared_added", ValueType.TEXT, "Added", None, 9, True),
        BackboneDiffCurrentParameter(
            "current_only", ValueType.TEXT, "Current only", None, 10, True
        ),
        BackboneDiffCurrentParameter(
            "baseline_only", ValueType.TEXT, "Baseline only", None, 11, False
        ),
    ]
    if include_orphan:
        parameters.append(
            BackboneDiffCurrentParameter(
                "orphan_inactive", ValueType.TEXT, "Orphan", None, 99, False
            )
        )

    if current_source is None:
        current_source = (
            baseline_snapshot.source
            if baseline_snapshot is not None
            else _current_source()
        )

    return BackboneDiffLayerInput(
        layer_key="L1::PROC_ALPHA::010::ACT",
        layer_sort_order=1,
        current_source=current_source,
        baseline_snapshot=baseline_snapshot,
        current_conditions=current_conditions,
        current_parameters=tuple(parameters),
    )


def _matched_current_condition() -> BackboneDiffCurrentCondition:
    return BackboneDiffCurrentCondition(
        id=101,
        source_condition_id=10,
        label="Line A v2",
        condition_index=2,
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


def _matched_layer_input(
    *,
    baseline_snapshot: BackboneSnapshot | None = None,
    current_conditions: tuple[BackboneDiffCurrentCondition, ...] | None = None,
    include_orphan: bool = False,
) -> BackboneDiffLayerInput:
    if baseline_snapshot is None:
        baseline_snapshot = _baseline_snapshot()
    if current_conditions is None:
        current_conditions = (
            _matched_current_condition(),
            _duplicate_current_condition(),
        )
    return _layer_input(
        baseline_snapshot=baseline_snapshot,
        current_conditions=current_conditions,
        include_orphan=include_orphan,
    )


def test_compare_backbone_layer_classifies_and_orders_all_core_cases() -> None:
    result = compare_backbone_layer(_matched_layer_input())

    assert result.baseline_unavailable is False
    assert result.ambiguous_lineage_count == 1
    assert [row.row_status for row in result.rows] == ["removed", "matched", "added"]

    matched_row = result.rows[0]
    assert [change.field_name for change in matched_row.metadata_changes] == [
        "label",
        "condition_index",
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
    assert [item.field_name for item in matched_preview[:2]] == ["is_por", "label"]
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


def test_compare_backbone_layer_is_stable_and_ignores_orphan_params() -> None:
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
    assert backbone_diff_layer_basis_hash(shuffled) == backbone_diff_layer_basis_hash(
        shuffled_with_orphan
    )


def test_compare_backbone_layer_null_source_condition_is_added() -> None:
    layer = _layer_input(
        baseline_snapshot=_baseline_snapshot(),
        current_conditions=(
            BackboneDiffCurrentCondition(
                id=301,
                source_condition_id=None,
                label="Orphan",
                condition_index=4,
                is_por=False,
                cells=(BackboneDiffCurrentCell("current_only", "fresh"),),
            ),
        ),
    )

    result = compare_backbone_layer(layer)

    assert [row.row_status for row in result.rows] == ["removed", "removed", "added"]
    assert result.added_row_count == 1
    assert result.rows[-1].current_id == 301
    assert result.rows[-1].baseline_source_condition_id is None


@pytest.mark.parametrize(
    (
        "parameter_code",
        "expected_classification",
        "expected_reason",
        "expected_baseline_value",
        "expected_current_value",
    ),
    [
        ("baseline_only", "removed", "column_removed", "legacy", None),
        ("shared_blank", "unchanged", "null_equal", None, None),
        ("shared_number_equal", "unchanged", "value_equal", "1", "1"),
        ("shared_number_changed", "changed", "value_changed", "2", "3.5"),
        ("shared_text_equal", "unchanged", "value_equal", "same", "same"),
        ("shared_text_changed", "changed", "value_changed", "old", "new"),
        ("shared_choice_equal", "unchanged", "value_equal", "CHOICE_A", "CHOICE_A"),
        ("shared_choice_changed", "changed", "value_changed", "CHOICE_X", "CHOICE_Y"),
        ("shared_cleared", "cleared", "value_cleared", "to-clear", None),
        ("shared_added", "added", "value_added", None, "created"),
        ("current_only", "added", "column_added", None, "fresh"),
    ],
)
def test_compare_backbone_layer_cell_matrix(
    parameter_code: str,
    expected_classification: str,
    expected_reason: str,
    expected_baseline_value: str | None,
    expected_current_value: str | None,
) -> None:
    result = compare_backbone_layer(_matched_layer_input())
    cell = {change.parameter_code: change for change in result.rows[0].cell_changes}[parameter_code]

    assert cell.classification == expected_classification
    assert cell.reason == expected_reason
    assert cell.baseline_value == expected_baseline_value
    assert cell.current_value == expected_current_value


def _mismatch_layer() -> BackboneDiffLayerInput:
    return BackboneDiffLayerInput(
        layer_key="L1::PROC_ALPHA::010::ACT",
        layer_sort_order=1,
        current_source=_current_source(),
        baseline_snapshot=_baseline_snapshot(),
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
            BackboneDiffCurrentParameter(
                "shared_number_equal", ValueType.TEXT, "Number equal", None, 2, True
            ),
        ),
    )


def _invalid_decimal_layer() -> BackboneDiffLayerInput:
    return BackboneDiffLayerInput(
        layer_key="L1::PROC_ALPHA::010::ACT",
        layer_sort_order=1,
        current_source=_current_source(),
        baseline_snapshot=_baseline_snapshot(),
        current_conditions=(
            BackboneDiffCurrentCondition(
                id=101,
                source_condition_id=10,
                label="Line A",
                condition_index=0,
                is_por=True,
                cells=(BackboneDiffCurrentCell("shared_number_equal", "not-a-number"),),
            ),
        ),
        current_parameters=(
            BackboneDiffCurrentParameter(
                "shared_number_equal", ValueType.NUMBER, "Number equal", None, 2, True
            ),
        ),
    )


def _missing_descriptor_layer() -> BackboneDiffLayerInput:
    return BackboneDiffLayerInput(
        layer_key="L1::PROC_ALPHA::010::ACT",
        layer_sort_order=1,
        current_source=_current_source(),
        baseline_snapshot=_baseline_snapshot(),
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
            BackboneDiffCurrentParameter(
                "current_only", ValueType.TEXT, "Current only", None, 10, True
            ),
        ),
    )


@pytest.mark.parametrize(
    ("layer_factory", "expected_code"),
    [
        (_mismatch_layer, DIFF_BASIS_INVALID),
        (_invalid_decimal_layer, DIFF_BASIS_INVALID),
        (_missing_descriptor_layer, UNRESOLVED_PARAMETER_METADATA),
    ],
)
def test_compare_backbone_layer_fails_closed(
    layer_factory: Callable[[], BackboneDiffLayerInput], expected_code: str
) -> None:
    with pytest.raises(RuleViolationError) as exc_info:
        compare_backbone_layer(layer_factory())
    assert exc_info.value.code == expected_code


def _mutated_layer_parameter_display_name(layer: BackboneDiffLayerInput) -> BackboneDiffLayerInput:
    parameters = list(layer.current_parameters)
    parameters[0] = replace(parameters[0], display_name="Blank v2")
    return replace(layer, current_parameters=tuple(parameters))


def _mutated_layer_parameter_sort_order(layer: BackboneDiffLayerInput) -> BackboneDiffLayerInput:
    parameters = list(layer.current_parameters)
    parameters[0] = replace(parameters[0], sort_order=99)
    return replace(layer, current_parameters=tuple(parameters))


def _mutated_layer_parameter_active(layer: BackboneDiffLayerInput) -> BackboneDiffLayerInput:
    parameters = list(layer.current_parameters)
    parameters[0] = replace(parameters[0], active=False)
    return replace(layer, current_parameters=tuple(parameters))


def _mutated_layer_baseline_label(layer: BackboneDiffLayerInput) -> BackboneDiffLayerInput:
    baseline = layer.baseline_snapshot
    assert baseline is not None
    conditions = list(baseline.conditions)
    conditions[0] = replace(conditions[0], label="Line A v2")
    return replace(layer, baseline_snapshot=replace(baseline, conditions=tuple(conditions)))


def _mutated_current_source_project_id(layer: BackboneDiffLayerInput) -> BackboneDiffLayerInput:
    return replace(layer, current_source=replace(layer.current_source, project_id=99))


def _mutated_current_source_sheet_layer_id(layer: BackboneDiffLayerInput) -> BackboneDiffLayerInput:
    return replace(layer, current_source=replace(layer.current_source, sheet_layer_id=88))


def _mutated_current_source_layer_key(layer: BackboneDiffLayerInput) -> BackboneDiffLayerInput:
    return replace(
        layer,
        current_source=replace(layer.current_source, layer_key="L1::PROC_ALPHA::010::ALT"),
    )


def _mutated_current_source_step_seq(layer: BackboneDiffLayerInput) -> BackboneDiffLayerInput:
    return replace(layer, current_source=replace(layer.current_source, step_seq="999"))


def _mutated_current_source_layer_id(layer: BackboneDiffLayerInput) -> BackboneDiffLayerInput:
    return replace(layer, current_source=replace(layer.current_source, layer_id="ALT"))


@pytest.mark.parametrize(
    "mutator",
    [
        _mutated_layer_parameter_display_name,
        _mutated_layer_parameter_sort_order,
        _mutated_layer_parameter_active,
        _mutated_layer_baseline_label,
        _mutated_current_source_project_id,
        _mutated_current_source_sheet_layer_id,
        _mutated_current_source_layer_key,
        _mutated_current_source_step_seq,
        _mutated_current_source_layer_id,
    ],
)
def test_backbone_diff_layer_basis_hash_changes_with_authority(
    mutator: Callable[[BackboneDiffLayerInput], BackboneDiffLayerInput],
) -> None:
    base = _matched_layer_input()
    mutated = mutator(base)

    assert backbone_diff_layer_basis_hash(base) != backbone_diff_layer_basis_hash(mutated)


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
        current_source=_current_source(
            project_id=42,
            sheet_layer_id=8,
            layer_key="L2::PROC_BETA::020::ACT",
            step_seq="020",
            layer_id="ACT",
        ),
        baseline_snapshot=None,
        current_conditions=(_added_current_condition(),),
        current_parameters=(
            BackboneDiffCurrentParameter(
                "current_only", ValueType.TEXT, "Current only", None, 10, True
            ),
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
