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
    HistoryDomainCoordinateOut,
    HistoryJumpTargetOut,
    HistoryStateEntryOut,
    HistoryTimelineItemOut,
    HistoryTimelineOut,
    HistoryTimelineQueryIn,
)
from app.models.project import ChangeEventType


def _dt() -> datetime:
    return datetime(2026, 7, 1, 12, 0, tzinfo=UTC)


def test_history_query_limits_are_validated() -> None:
    query = HistoryTimelineQueryIn.model_validate(
        {
            "created_from": "2026-07-01T00:00:00-07:00",
            "created_to": "2026-07-02T00:00:00-07:00",
            "layer_key": "L1",
            "event_type": ["project_create", "backbone_copy"],
            "actor": "alice",
            "origin": "manual",
            "source_project_id": 99,
        }
    )
    assert query.created_from == datetime(2026, 7, 1, 7, 0, tzinfo=UTC)
    assert query.created_to == datetime(2026, 7, 2, 7, 0, tzinfo=UTC)
    assert query.event_type == [
        ChangeEventType.PROJECT_CREATE,
        ChangeEventType.BACKBONE_COPY,
    ]
    assert query.origin == "manual"
    assert query.limit == 50
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
    with pytest.raises(ValidationError):
        HistoryTimelineQueryIn.model_validate(
            {
                "created_from": "2026-07-02T00:00:00Z",
                "created_to": "2026-07-02T00:00:00Z",
            }
        )
    with pytest.raises(ValidationError):
        HistoryTimelineQueryIn.model_validate(
            {
                "created_from": "2026-07-03T00:00:00Z",
                "created_to": "2026-07-02T00:00:00Z",
            }
        )
    with pytest.raises(ValidationError):
        HistoryTimelineQueryIn.model_validate({"origin": ["manual", "paste"]})


def test_timeline_schema_whitelists_public_fields_and_rejects_raw_payload() -> None:
    item = HistoryTimelineItemOut(
        kind="batch",
        cursor_id=41,
        started_at=_dt(),
        occurred_at=_dt(),
        summary="Grouped change events",
        detail_status="available",
        detail_scope="opaque-scope",
        event_types=[ChangeEventType.PROJECT_CREATE],
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
        old_code="  OLD  ",
        new_code="",
        copied_value="  BASELINE  ",
        choice_label="Label",
        actor="operator",
        origin="backbone",
        created_at=_dt(),
        layer_key="L1",
        domain_coordinate=HistoryDomainCoordinateOut(
            layer_key="L1", condition_id=3, parameter_code="P1"
        ),
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
    assert detail.model_dump()["items"][0]["copied_value"] == "  BASELINE  "
    assert detail.model_dump()["items"][0]["old_code"] == "  OLD  "
    assert detail.model_dump()["items"][0]["new_code"] == ""
    assert detail.model_dump()["items"][0]["domain_coordinate"] == {
        "layer_key": "L1",
        "condition_id": 3,
        "parameter_code": "P1",
        "cell_ref": None,
    }
    assert "baseline_value" not in HistoryDetailItemOut.model_fields
    assert "order_kind" not in HistoryDetailItemOut.model_fields
    assert "domain_coordinate" not in HistoryDetailCaptureTupleOut.model_fields
    assert "copied_baseline_value" not in HistoryDetailCaptureTupleOut.model_fields

    cell_item = HistoryCellHistoryItemOut(
        event_id=21,
        old_code="  OLD  ",
        new_code="",
        choice_label="Label",
        actor="operator",
        origin="manual",
        created_at=_dt(),
        layer_key="L2",
        jump_status="available",
    )
    cell_history = HistoryCellHistoryOut(
        items=[cell_item],
        baseline_entry=HistoryStateEntryOut(code="", label="Base label"),
        initial_entry=HistoryStateEntryOut(code="  INIT  ", label="Initial label"),
        next_cursor=None,
    )
    assert cell_history.model_dump()["baseline_entry"] == {
        "code": "",
        "label": "Base label",
    }
    assert cell_history.model_dump()["initial_entry"] == {
        "code": "  INIT  ",
        "label": "Initial label",
    }
    assert cell_history.model_dump()["initial_state_unavailable"] is False
    assert "baseline_entry" not in HistoryCellHistoryItemOut.model_fields
    assert "initial_entry" not in HistoryCellHistoryItemOut.model_fields

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
