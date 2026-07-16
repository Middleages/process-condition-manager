"""Deterministic history projection tests for Phase 4 task 4."""

from __future__ import annotations

import json
from dataclasses import FrozenInstanceError, asdict
from datetime import UTC, datetime
from typing import Any

import pytest

from app.core.errors import ConflictError
from app.domain.backbone import (
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
    serialize_backbone_snapshot,
)
from app.features.history.projection import (
    BackboneCaptureProjection,
    HistoryAvailability,
    HistoryCellDetailProjection,
    HistoryCellHistoryProjection,
    HistoryEntryRole,
    HistoryEventRow,
    HistoryJumpState,
    HistoryTimelineProjection,
    project_backbone_capture,
    project_cell_detail,
    project_cell_history,
    project_jump_state,
    project_timeline_summary,
)


def _dt(offset: int) -> datetime:
    return datetime(2026, 7, 16, 8, 0, offset, tzinfo=UTC)


def _row(
    event_id: int,
    event_type: str,
    *,
    schema_version: int = 2,
    history_role: HistoryEntryRole = HistoryEntryRole.CURRENT,
    deleted: bool = False,
    **overrides: Any,
) -> HistoryEventRow:
    base: dict[str, Any] = dict(
        event_id=event_id,
        event_type=event_type,
        actor=f"actor-{event_id}",
        created_at=_dt(event_id % 60),
        batch_id=f"batch-{event_id}",
        origin="manual",
        layer_key=f"L{event_id % 4}",
        layer_sort_order=event_id % 4,
        condition_id=100 + event_id,
        condition_index=event_id % 7,
        source_condition_id=200 + event_id,
        source_condition_index=event_id % 5,
        parameter_code=f"param_{event_id}",
        parameter_sort_order=event_id % 6,
        old_value=f"old-{event_id}",
        new_value=f"new-{event_id}",
        source_project_id=300 + event_id,
        source_layer_key=f"SRC-{event_id}",
        schema_version=schema_version,
        history_role=history_role,
        deleted=deleted,
        detail={"raw": {"should": "not leak"}, "extra": event_id},
        capture={"raw": {"should": "not leak"}, "extra": event_id},
    )
    base.update(overrides)
    return HistoryEventRow(**base)


def _capture_snapshot() -> dict[str, Any]:
    snapshot = BackboneSnapshot(
        capture_batch_id="0123456789abcdef0123456789abcdef",
        captured_at=_dt(1),
        source=BackboneSnapshotSource(
            project_id=301,
            sheet_layer_id=401,
            layer_key="SRC-L1",
            step_seq="STEP-1",
            layer_id="LID-1",
        ),
        columns=(
            BackboneSnapshotColumn(
                parameter_code="beta",
                value_type="text",
                display_name="Beta",
                category_code=None,
                sort_order=1,
                active_at_capture=True,
            ),
            BackboneSnapshotColumn(
                parameter_code="alpha",
                value_type="text",
                display_name="Alpha",
                category_code=None,
                sort_order=0,
                active_at_capture=True,
            ),
        ),
        conditions=(
            BackboneSnapshotCondition(
                source_condition_id=7,
                label="C7",
                condition_index=2,
                is_por=False,
                cells=(
                    BackboneSnapshotCell(parameter_code="alpha", value="a7"),
                    BackboneSnapshotCell(parameter_code="beta", value="b7"),
                ),
            ),
            BackboneSnapshotCondition(
                source_condition_id=3,
                label="C3",
                condition_index=1,
                is_por=True,
                cells=(BackboneSnapshotCell(parameter_code="alpha", value="a3"),),
            ),
        ),
    )
    return serialize_backbone_snapshot(snapshot)


def _capture_detail() -> list[dict[str, Any]]:
    return [
        {
            "target_condition_id": 502,
            "source_condition_id": 7,
            "label": "C7",
            "condition_index": 2,
            "is_por": False,
            "cell_count": 2,
        },
        {
            "target_condition_id": 501,
            "source_condition_id": 3,
            "label": "C3",
            "condition_index": 1,
            "is_por": True,
            "cell_count": 1,
        },
    ]


def test_history_event_row_is_frozen_and_wraps_mappings() -> None:
    detail = {"nested": {"value": 1}}
    capture = {"nested": {"value": 2}}
    row = HistoryEventRow(event_id=1, event_type="cell_update", detail=detail, capture=capture)

    detail["nested"] = {"value": 99}
    capture["nested"] = {"value": 88}

    assert row.detail["nested"]["value"] == 1
    assert row.capture["nested"]["value"] == 2

    with pytest.raises(TypeError):
        row.detail["nested"] = {"value": 3}  # type: ignore[index]

    with pytest.raises(FrozenInstanceError):
        row.event_id = 2  # type: ignore[misc]


def test_timeline_summary_orders_newest_first_and_sanitizes_payload() -> None:
    rows = [
        _row(2, "cell_update", schema_version=2, condition_id=202, parameter_code="target"),
        _row(4, "backbone_copy", schema_version=1, condition_id=204, parameter_code="keep"),
        _row(3, "audit_note", schema_version=2, condition_id=None, parameter_code=None),
    ]

    projection = project_timeline_summary(rows)

    assert isinstance(projection, HistoryTimelineProjection)
    assert projection.metadata.total_items == 3
    assert projection.metadata.cell_items == 1
    assert projection.metadata.capture_items == 1
    assert projection.metadata.legacy_items == 1
    assert projection.detail_applicability == HistoryAvailability.AVAILABLE
    assert projection.legacy_coverage == HistoryAvailability.LEGACY_UNAVAILABLE
    assert [item.event_id for item in projection.items] == [4, 3, 2]
    assert [item.jump_state for item in projection.items] == [
        HistoryJumpState.PRESENT,
        HistoryJumpState.DELETED,
        HistoryJumpState.PRESENT,
    ]
    assert projection.items[0].detail_applicability == HistoryAvailability.LEGACY_UNAVAILABLE
    assert projection.items[1].detail_applicability == HistoryAvailability.NO_APPLICABLE
    assert projection.items[2].legacy_coverage == HistoryAvailability.AVAILABLE
    assert "raw" not in json.dumps(asdict(projection), ensure_ascii=False)


@pytest.mark.parametrize("event_type", ["condition_add", "condition_remove", "por_change"])
def test_timeline_summary_preserves_non_expandable_event_types(event_type: str) -> None:
    projection = project_timeline_summary([_row(1, event_type, schema_version=2)])

    assert [item.event_type for item in projection.items] == [event_type]
    assert projection.metadata.cell_items == 0
    assert projection.metadata.capture_items == 0
    assert projection.items[0].detail_applicability == HistoryAvailability.NO_APPLICABLE
    assert projection.items[0].legacy_coverage == HistoryAvailability.NO_APPLICABLE


def test_cell_detail_projects_descending_ids_and_legacy_unavailable() -> None:
    rows = [
        _row(11, "cell_update", schema_version=1, deleted=True),
        _row(9, "cell_update", schema_version=1),
        _row(10, "cell_update", schema_version=1),
    ]

    projection = project_cell_detail(rows)

    assert isinstance(projection, HistoryCellDetailProjection)
    assert projection.availability == HistoryAvailability.LEGACY_UNAVAILABLE
    assert [item.event_id for item in projection.items] == [11, 10, 9]
    assert projection.items[0].jump_state == HistoryJumpState.DELETED
    assert projection.items[-1].jump_state == HistoryJumpState.PRESENT
    assert projection.items[0].old_value == "old-11"
    assert projection.items[0].new_value == "new-11"
    assert "should not leak" not in json.dumps(asdict(projection), ensure_ascii=False)


def test_backbone_capture_flattens_real_v2_payload_and_sorts_by_structure() -> None:
    rows = [
        _row(
            20,
            "backbone_copy",
            schema_version=2,
            layer_sort_order=1,
            layer_key="T-L1",
            capture=_capture_snapshot(),
            detail=_capture_detail(),
        ),
        _row(
            10,
            "backbone_copy",
            schema_version=2,
            layer_sort_order=1,
            layer_key="T-L1",
            capture=_capture_snapshot(),
            detail=_capture_detail(),
        ),
        _row(
            5,
            "backbone_layer_replace",
            schema_version=2,
            layer_sort_order=0,
            layer_key="T-L0",
            capture=_capture_snapshot(),
            detail=_capture_detail(),
            deleted=True,
        ),
    ]

    projection = project_backbone_capture(rows)

    assert isinstance(projection, BackboneCaptureProjection)
    assert projection.availability == HistoryAvailability.AVAILABLE
    assert [
        (
            item.target_layer_sort,
            item.layer_key,
            item.target_condition_id,
            item.source_condition_index,
            item.source_condition_id,
            item.parameter_sort,
            item.parameter_code,
            item.value,
            item.jump_state,
            item.event_id,
        )
        for item in projection.items
    ] == [
        (0, "T-L0", 501, 1, 3, 0, "alpha", "a3", HistoryJumpState.DELETED, 5),
        (0, "T-L0", 502, 2, 7, 0, "alpha", "a7", HistoryJumpState.DELETED, 5),
        (0, "T-L0", 502, 2, 7, 1, "beta", "b7", HistoryJumpState.DELETED, 5),
        (1, "T-L1", 501, 1, 3, 0, "alpha", "a3", HistoryJumpState.PRESENT, 10),
        (1, "T-L1", 501, 1, 3, 0, "alpha", "a3", HistoryJumpState.PRESENT, 20),
        (1, "T-L1", 502, 2, 7, 0, "alpha", "a7", HistoryJumpState.PRESENT, 10),
        (1, "T-L1", 502, 2, 7, 0, "alpha", "a7", HistoryJumpState.PRESENT, 20),
        (1, "T-L1", 502, 2, 7, 1, "beta", "b7", HistoryJumpState.PRESENT, 10),
        (1, "T-L1", 502, 2, 7, 1, "beta", "b7", HistoryJumpState.PRESENT, 20),
    ]
    assert "raw" not in json.dumps(asdict(projection), ensure_ascii=False)


def test_backbone_capture_v1_or_missing_detail_is_legacy_unavailable() -> None:
    v1_projection = project_backbone_capture(
        [
            _row(
                1,
                "backbone_copy",
                schema_version=1,
                layer_sort_order=0,
                layer_key="T-L0",
                capture=_capture_snapshot(),
                detail=_capture_detail(),
            )
        ]
    )
    missing_detail_projection = project_backbone_capture(
        [
            _row(
                2,
                "backbone_copy",
                schema_version=2,
                layer_sort_order=0,
                layer_key="T-L0",
                capture=_capture_snapshot(),
                detail=[],
            )
        ]
    )

    assert v1_projection.availability == HistoryAvailability.LEGACY_UNAVAILABLE
    assert v1_projection.items == ()
    assert missing_detail_projection.availability == HistoryAvailability.LEGACY_UNAVAILABLE
    assert missing_detail_projection.items == ()


def test_backbone_capture_corrupt_snapshot_is_legacy_unavailable() -> None:
    projection = project_backbone_capture(
        [
            _row(
                3,
                "backbone_copy",
                schema_version=2,
                layer_sort_order=0,
                layer_key="T-L0",
                capture={"schema_version": 1},
                detail=_capture_detail(),
            )
        ]
    )

    assert projection.availability == HistoryAvailability.LEGACY_UNAVAILABLE
    assert projection.items == ()


def test_backbone_capture_rejects_mixed_cell_and_capture_rows() -> None:
    with pytest.raises(ConflictError) as raised:
        project_backbone_capture(
            [
                _row(
                    1,
                    "cell_update",
                    condition_id=1,
                    parameter_code="alpha",
                ),
                _row(
                    2,
                    "backbone_copy",
                    layer_sort_order=0,
                    layer_key="L0",
                    source_condition_index=0,
                    source_condition_id=1,
                    parameter_sort_order=0,
                    parameter_code="alpha",
                ),
            ]
        )

    assert raised.value.code == "invalid_event_batch"


def test_backbone_capture_without_applicable_rows_is_noop() -> None:
    projection = project_backbone_capture([])
    assert projection.availability == HistoryAvailability.NO_APPLICABLE
    assert projection.items == ()


def test_cell_history_projects_newest_first_with_baseline_and_initial() -> None:
    rows = [
        _row(30, "cell_update", history_role=HistoryEntryRole.CURRENT),
        _row(10, "cell_update", history_role=HistoryEntryRole.CURRENT, deleted=True),
        _row(20, "cell_update", history_role=HistoryEntryRole.CURRENT),
        _row(5, "cell_update", history_role=HistoryEntryRole.BASELINE),
        _row(1, "cell_update", history_role=HistoryEntryRole.INITIAL),
    ]

    projection = project_cell_history(rows)

    assert isinstance(projection, HistoryCellHistoryProjection)
    assert [entry.event_id for entry in projection.entries] == [30, 20, 10]
    assert projection.entries[0].jump_state == HistoryJumpState.PRESENT
    assert projection.entries[-1].jump_state == HistoryJumpState.DELETED
    assert projection.baseline_entry is not None
    assert projection.baseline_entry.role == HistoryEntryRole.BASELINE
    assert projection.baseline_entry.event_id == 5
    assert projection.initial_entry is not None
    assert projection.initial_entry.role == HistoryEntryRole.INITIAL
    assert projection.initial_entry.event_id == 1
    assert projection.initial_state == HistoryAvailability.AVAILABLE


def test_cell_history_without_initial_marks_state_unavailable() -> None:
    projection = project_cell_history(
        [
            _row(4, "cell_update", history_role=HistoryEntryRole.CURRENT),
            _row(3, "cell_update", history_role=HistoryEntryRole.BASELINE),
        ]
    )

    assert projection.initial_entry is None
    assert projection.initial_state == HistoryAvailability.NO_APPLICABLE
    assert projection.initial_state_unavailable is True


def test_cell_history_explicit_legacy_initial_state_uses_legacy_unavailable() -> None:
    projection = project_cell_history(
        [
            _row(4, "cell_update", history_role=HistoryEntryRole.CURRENT),
            _row(3, "cell_update", history_role=HistoryEntryRole.BASELINE),
        ],
        initial_state_unavailable=True,
    )

    assert projection.initial_entry is None
    assert projection.initial_state == HistoryAvailability.LEGACY_UNAVAILABLE
    assert projection.initial_state_unavailable is True


@pytest.mark.parametrize(
    ("row", "expected_state"),
    [
        (_row(1, "cell_update"), HistoryJumpState.PRESENT),
        (_row(2, "cell_update", deleted=True), HistoryJumpState.DELETED),
        (None, HistoryJumpState.DELETED),
    ],
)
def test_project_jump_state(row: HistoryEventRow | None, expected_state: HistoryJumpState) -> None:
    jump = project_jump_state(row)
    assert jump.state == expected_state
    assert jump.present is (expected_state is HistoryJumpState.PRESENT)


def test_projection_serialization_stays_under_256_kib() -> None:
    rows = [
        _row(
            idx,
            "backbone_copy",
            schema_version=2,
            layer_sort_order=idx % 7,
            layer_key=f"T-L{idx % 7}",
            capture=_capture_snapshot(),
            detail=_capture_detail(),
        )
        for idx in range(1, 129)
    ]

    projection = project_backbone_capture(rows)
    encoded = json.dumps(asdict(projection), ensure_ascii=False, separators=(",", ":"))

    assert len(encoded.encode("utf-8")) < 256 * 1024
    assert "should not leak" not in encoded
