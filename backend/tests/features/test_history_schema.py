from __future__ import annotations

from datetime import datetime, timezone

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



def test_timeline_schema_whitelists_public_fields_and_limits() -> None:
    model = HistoryTimelineItemOut(
        kind="batch",
        started_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
        occurred_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
        summary="Grouped change events",
        detail_status="available",
        detail_scope="opaque",
        items=[] if False else None,  # type: ignore[arg-type]
    )
