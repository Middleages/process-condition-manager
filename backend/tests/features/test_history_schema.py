from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.features.history.schema import (
    HistoryCellHistoryItemOut,
    HistoryCellHistoryOut,
    HistoryCellHistoryQueryIn,
    HistoryCoverageOut,
    HistoryDetailCaptureTupleOut,
    HistoryDetailItemOut,
    HistoryDetailOut,
    HistoryDetailQueryIn,
    HistoryJumpTargetOut,
    HistoryStateEntryOut,
    HistoryTimelineItemOut,
    HistoryTimelineOut,
    HistoryTimelineQueryIn,
)


def _dt() -> datetime:
    return datetime(2026, 7, 1, 12, 0, tzinfo=UTC)


def test_history_query_limits_are_validated() -> None:
    assert HistoryTimelineQueryIn().limit == 50
    assert HistoryDetailQueryIn(scope="opaque").limit == 100
    assert HistoryCellHistoryQueryIn(condition_id=1, parameter_code="P").limit == 50

    with pytest.raises(ValidationError):
        HistoryTimelineQueryIn(limit=0)
    with pytest.raises(ValidationError):
        HistoryTimelineQueryIn(limit=101)
    with pytest.raises(ValidationError):
        HistoryDetailQueryIn(scope="opaque", limit=201)
    with pytest.raises(ValidationError):
        HistoryCellHistoryQueryIn(condition_id=1, parameter_code="P", limit=101)


def test_timeline_schema_whitelists_public_fields_and_rejects_raw_payload() -> None:
    item = HistoryTimelineItemOut(
        kind="batch",
        cursor_id=41,
        started_at=_dt(),
        occurred_at=_dt(),
        summary="Grouped change events",
        detail_status="available",
        detail_scope="opaque-scope",
        event_types=["CREATED"],
        actors=["alice"],
        origins=["manual"],
        layer_keys=["L1"],
        batch_id="batch-1",
        matched_event_count=2,
        total_event_count=5,
        jump_target=HistoryJumpTargetOut(layer_key="L1", jump_status="available"),
    )
    timeline = HistoryTimelineOut(items=[item], coverage=HistoryCoverageOut(), next_cursor="next")

    dumped = timeline.model_dump()
    assert dumped["coverage"] == {
        "legacy_unresolved_layer_count": 0,
        "legacy_detail_unavailable_count": 0,
    }
    assert "raw_payload" not in HistoryTimelineItemOut.model_fields
    assert "full_capture" not in HistoryTimelineItemOut.model_fields
    assert "raw_payload" not in dumped["items"][0]
    assert "full_capture" not in dumped["items"][0]

    with pytest.raises(ValidationError):
        HistoryTimelineItemOut.model_validate(
            {
                "kind": "event",
                "cursor_id": 1,
                "started_at": _dt(),
                "occurred_at": _dt(),
                "summary": "Event",
                "detail_status": "not_applicable",
                "detail_scope": None,
                "raw_payload": {"secret": True},
            }
        )


def test_detail_and_cell_schema_support_baseline_initial_and_jump_states() -> None:
    detail_item = HistoryDetailItemOut(
        event_id=11,
        order_kind="capture_asc",
        old_code="OLD",
        new_code="NEW",
        choice_label="Label",
        actor="operator",
        origin="backbone",
        created_at=_dt(),
        layer_key="L1",
        jump_target=HistoryJumpTargetOut(layer_key="L1", jump_status="deleted"),
        capture_tuple=HistoryDetailCaptureTupleOut(
            target_layer_sort=0,
            target_layer_key="L1",
            source_condition_index=1,
            source_condition_id=3,
            parameter_sort=2,
            parameter_code="P1",
            event_id=11,
        ),
    )
    detail = HistoryDetailOut(
        order_kind="capture_asc", detail_status="available", items=[detail_item]
    )
    assert detail.model_dump()["items"][0]["metadata_status"] == "complete"

    cell_item = HistoryCellHistoryItemOut(
        event_id=21,
        old_code="OLD",
        new_code="NEW",
        choice_label="Label",
        actor="operator",
        origin="manual",
        created_at=_dt(),
        layer_key="L2",
        jump_status="available",
        baseline_entry=HistoryStateEntryOut(code="BASE", label="Base label"),
        initial_entry=HistoryStateEntryOut(code="INIT", label="Initial label"),
    )
    cell_history = HistoryCellHistoryOut(items=[cell_item], next_cursor=None)
    assert cell_history.model_dump()["items"][0]["baseline_entry"] == {
        "code": "BASE",
        "label": "Base label",
    }
    assert cell_history.model_dump()["items"][0]["initial_state_unavailable"] is False

    with pytest.raises(ValidationError):
        HistoryCellHistoryItemOut.model_validate(
            {
                "event_id": 1,
                "old_code": "OLD",
                "new_code": "NEW",
                "choice_label": "Label",
                "actor": "operator",
                "origin": "manual",
                "created_at": _dt(),
                "layer_key": "L2",
                "jump_status": "available",
                "raw_payload": {"secret": True},
            }
        )
