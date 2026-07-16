from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.domain.errors import RuleViolationError
from app.features.history.cursor import (
    HistoryCaptureKey,
    HistoryCellHistoryCursor,
    HistoryDetailCursor,
    HistoryDetailScope,
    HistoryMemberFilterScope,
    HistoryTimelineCursor,
    HistoryTimelineScope,
    decode_history_cell_history_cursor,
    decode_history_detail_cursor,
    decode_history_detail_scope,
    decode_history_timeline_cursor,
    encode_history_cell_history_cursor,
    encode_history_detail_cursor,
    encode_history_detail_scope,
    encode_history_timeline_cursor,
    ensure_history_scope_matches,
)



def test_timeline_cursor_round_trips_with_normalized_scope_filters() -> None:
    scope = HistoryTimelineScope(
        project_id=7,
        member_filters=HistoryMemberFilterScope(
            layer_keys=(" layer-b ", "layer-a"),
            event_types=("UPDATED", "CREATED"),
            actors=("alice", "bob", "alice"),
            origins=("paste", "manual"),
            source_project_ids=(9, 3, 9),
            created_from="2026-07-01T00:00:00Z",
            created_to=datetime(2026, 7, 2, 0, 0, tzinfo=timezone.utc),
        ),
    )
    cursor = HistoryTimelineCursor(
        version=1,
        snapshot_max_event_id=123,
        before_group_max_id=120,
        scope=scope,
    )

    decoded = decode_history_timeline_cursor(encode_history_timeline_cursor(cursor))

    assert decoded == HistoryTimelineCursor(
        version=1,
        snapshot_max_event_id=123,
        before_group_max_id=120,
        scope=HistoryTimelineScope(
            project_id=7,
            member_filters=HistoryMemberFilterScope(
                layer_keys=("layer-a", "layer-b"),
                event_types=("CREATED", "UPDATED"),
                actors=("alice", "bob"),
                origins=("manual", "paste"),
                source_project_ids=(3, 9),
                created_from=datetime(2026, 7, 1, 0, 0, tzinfo=timezone.utc),
                created_to=datetime(2026, 7, 2, 0, 0, tzinfo=timezone.utc),
            ),
        ),
    )


@pytest.mark.parametrize(
    ("payload", "expected_code"),
    [
        ("not-a-cursor", "invalid_cursor"),
        ("eyJ2IjoxLCJzIjoxfQ", "invalid_cursor"),
    ],
)
def test_timeline_cursor_rejects_malformed_tokens(payload: str, expected_code: str) -> None:
    with pytest.raises(RuleViolationError) as exc_info:
        decode_history_timeline_cursor(payload)
    assert exc_info.value.code == expected_code


def test_detail_scope_round_trips_and_rejects_scope_mismatch() -> None:
    scope = HistoryDetailScope(
        project_id=9,
        batch_id="batch-123",
        member_filters=HistoryMemberFilterScope(
            layer_keys=("layer-1",),
            event_types=("UPDATED",),
            actors=("operator",),
            origins=("backbone",),
            source_project_ids=(100,),
        ),
    )
    decoded_scope = decode_history_detail_scope(encode_history_detail_scope(scope))
    assert decoded_scope == scope

    cursor = HistoryDetailCursor(
        version=1,
        scope=scope,
        order_kind="event_desc",
        last_event_id=88,
    )
    decoded_cursor = decode_history_detail_cursor(encode_history_detail_cursor(cursor))
    assert decoded_cursor == cursor

    other_scope = HistoryDetailScope(project_id=9, batch_id="batch-999")
    with pytest.raises(RuleViolationError) as exc_info:
        decode_history_detail_cursor(encode_history_detail_cursor(cursor), expected_scope=other_scope)
    assert exc_info.value.code == "invalid_scope"


@pytest.mark.parametrize(
    "cursor",
    [
        HistoryDetailCursor(
            version=1,
            scope=HistoryDetailScope(project_id=1, batch_id="batch-1"),
            order_kind="event_desc",
            last_event_id=10,
        ),
        HistoryDetailCursor(
            version=1,
            scope=HistoryDetailScope(project_id=1, batch_id="batch-1"),
            order_kind="capture_asc",
            last_capture_key=HistoryCaptureKey(
                target_layer_sort=0,
                target_layer_key="L1",
                source_condition_index=0,
                source_condition_id=3,
                parameter_sort=1,
                parameter_code="PARAM",
                event_id=10,
            ),
        ),
    ],
)
def test_detail_cursor_modes_round_trip(cursor: HistoryDetailCursor) -> None:
    assert decode_history_detail_cursor(encode_history_detail_cursor(cursor)) == cursor


@pytest.mark.parametrize(
    ("raw", "expected_code"),
    [
        ("not-a-scope", "invalid_scope"),
        ("eyJ2IjoxfQ", "invalid_scope"),
    ],
)
def test_detail_scope_rejects_malformed_tokens(raw: str, expected_code: str) -> None:
    with pytest.raises(RuleViolationError) as exc_info:
        decode_history_detail_scope(raw)
    assert exc_info.value.code == expected_code


@pytest.mark.parametrize(
    "expected_kwargs",
    [
        {"expected_project_id": 3},
        {"expected_condition_id": 4},
        {"expected_parameter_code": "PARAM"},
    ],
)
def test_cell_history_cursor_round_trips_and_scope_matches(expected_kwargs: dict[str, object]) -> None:
    cursor = HistoryCellHistoryCursor(
        version=1,
        project_id=3,
        condition_id=4,
        parameter_code="PARAM",
        last_event_id=25,
    )
    decoded = decode_history_cell_history_cursor(encode_history_cell_history_cursor(cursor), **expected_kwargs)
    assert decoded == cursor


@pytest.mark.parametrize(
    ("raw", "expected_code"),
    [
        ("not-a-cell-cursor", "invalid_cursor"),
        ("eyJ2IjoxLCJwIjoxfQ", "invalid_cursor"),
    ],
)
def test_cell_history_cursor_rejects_malformed_tokens(raw: str, expected_code: str) -> None:
    with pytest.raises(RuleViolationError) as exc_info:
        decode_history_cell_history_cursor(raw)
    assert exc_info.value.code == expected_code


def test_scope_mismatch_helper_raises_invalid_scope() -> None:
    with pytest.raises(RuleViolationError) as exc_info:
        ensure_history_scope_matches("a", "b")
    assert exc_info.value.code == "invalid_scope"


@pytest.mark.parametrize(
    "bad_cursor_kwargs",
    [
        {"version": 2, "snapshot_max_event_id": 10, "before_group_max_id": 8, "scope": HistoryTimelineScope(project_id=1)},
        {"version": 1, "snapshot_max_event_id": 10, "before_group_max_id": 8, "scope": "not-a-scope"},
    ],
)
def test_cursor_dataclasses_reject_bad_versions_and_types(bad_cursor_kwargs: dict[str, object]) -> None:
    with pytest.raises(RuleViolationError):
        HistoryTimelineCursor(**bad_cursor_kwargs)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "bad_scope_kwargs",
    [
        {"project_id": 1, "member_filters": HistoryMemberFilterScope(origins=("unsupported",))},
        {"project_id": 1, "member_filters": "not-a-filter"},
    ],
)
def test_scope_dataclasses_reject_invalid_values(bad_scope_kwargs: dict[str, object]) -> None:
    with pytest.raises(RuleViolationError):
        HistoryTimelineScope(**bad_scope_kwargs)  # type: ignore[arg-type]
