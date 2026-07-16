from __future__ import annotations

# pyright: reportMissingImports=false

from datetime import UTC, datetime
from typing import cast

import pytest

from app.domain.errors import RuleViolationError
from app.features.history.cursor import (
    HistoryCaptureKey,
    HistoryCellHistoryCursor,
    HistoryDetailCursor,
    HistoryDetailScope,
    HistoryMemberFilterScope,
    HistoryOrigin,
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
            actors=("alice", "bob"),
            origins=("paste", "manual"),
            source_project_ids=(9, 3),
            created_from="2026-07-01T00:00:00Z",
            created_to=datetime(2026, 7, 2, 0, 0, tzinfo=UTC),
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
                event_types=("backbone_copy", "project_create"),
                actors=("alice", "bob"),
                origins=("manual", "paste"),
                source_project_ids=(3, 9),
                created_from=datetime(2026, 7, 1, 0, 0, tzinfo=UTC),
                created_to=datetime(2026, 7, 2, 0, 0, tzinfo=UTC),
            ),
        ),
    )


def test_member_filter_scope_rejects_duplicate_values() -> None:
    with pytest.raises(RuleViolationError) as exc_info:
        HistoryMemberFilterScope(layer_keys=("layer-a", "layer-a"))
    assert exc_info.value.code == "invalid_scope"


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
            event_types=("project_create",),
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
        decode_history_detail_cursor(
            encode_history_detail_cursor(cursor), expected_scope=other_scope
        )
    assert exc_info.value.code == "invalid_scope"


def test_detail_cursor_rejects_scope_fingerprint_tampering() -> None:
    cursor = HistoryDetailCursor(
        version=1,
        scope=HistoryDetailScope(project_id=9, batch_id="batch-123"),
        order_kind="event_desc",
        last_event_id=88,
    )
    payload = _decode_payload(encode_history_detail_cursor(cursor))
    payload["scope"]["batch_id"] = "batch-999"
    tampered = _encode_payload(payload)

    with pytest.raises(RuleViolationError) as exc_info:
        decode_history_detail_cursor(tampered)
    assert exc_info.value.code == "invalid_cursor"


def test_detail_cursor_rejects_nested_malformed_scope() -> None:
    cursor = HistoryDetailCursor(
        version=1,
        scope=HistoryDetailScope(project_id=9, batch_id="batch-123"),
        order_kind="event_desc",
        last_event_id=88,
    )
    payload = _decode_payload(encode_history_detail_cursor(cursor))
    payload["scope"] = "broken"
    payload["scope_fingerprint"] = _fingerprint_payload("broken")

    with pytest.raises(RuleViolationError) as exc_info:
        decode_history_detail_cursor(_encode_payload(payload))
    assert exc_info.value.code == "invalid_cursor"


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


def test_cell_history_cursor_round_trips_with_project_scope() -> None:
    cursor = HistoryCellHistoryCursor(
        version=1,
        project_id=3,
        condition_id=4,
        parameter_code="PARAM",
        last_event_id=25,
    )
    decoded = decode_history_cell_history_cursor(
        encode_history_cell_history_cursor(cursor), expected_project_id=3
    )
    assert decoded == cursor


def test_cell_history_cursor_round_trips_with_condition_scope() -> None:
    cursor = HistoryCellHistoryCursor(
        version=1,
        project_id=3,
        condition_id=4,
        parameter_code="PARAM",
        last_event_id=25,
    )
    decoded = decode_history_cell_history_cursor(
        encode_history_cell_history_cursor(cursor), expected_condition_id=4
    )
    assert decoded == cursor


def test_cell_history_cursor_round_trips_with_parameter_scope() -> None:
    cursor = HistoryCellHistoryCursor(
        version=1,
        project_id=3,
        condition_id=4,
        parameter_code="PARAM",
        last_event_id=25,
    )
    decoded = decode_history_cell_history_cursor(
        encode_history_cell_history_cursor(cursor), expected_parameter_code="PARAM"
    )
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
        {
            "version": 2,
            "snapshot_max_event_id": 10,
            "before_group_max_id": 8,
            "scope": cast(object, HistoryTimelineScope(project_id=1)),
        },
        {
            "version": 1,
            "snapshot_max_event_id": 10,
            "before_group_max_id": 8,
            "scope": "not-a-scope",
        },
    ],
)
def test_cursor_dataclasses_reject_bad_versions_and_types(
    bad_cursor_kwargs: dict[str, object],
) -> None:
    with pytest.raises(RuleViolationError):
        HistoryTimelineCursor(
            version=2,
            snapshot_max_event_id=10,
            before_group_max_id=8,
            scope=HistoryTimelineScope(project_id=1),
        )
    with pytest.raises(RuleViolationError):
        HistoryTimelineCursor(
            version=1,
            snapshot_max_event_id=10,
            before_group_max_id=8,
            scope="not-a-scope",  # type: ignore[arg-type]
        )


def test_scope_dataclasses_reject_invalid_values() -> None:
    with pytest.raises(RuleViolationError):
        HistoryTimelineScope(project_id=1, member_filters={"origins": ("unsupported",)})  # type: ignore[arg-type]
    with pytest.raises(RuleViolationError):
        HistoryTimelineScope(project_id=1, member_filters="not-a-filter")  # type: ignore[arg-type]


def test_member_filter_scope_rejects_unsupported_origin_values() -> None:
    with pytest.raises(RuleViolationError) as exc_info:
        HistoryMemberFilterScope(
            origins=cast(tuple[HistoryOrigin, ...], ("unsupported",))
        )
    assert exc_info.value.code == "invalid_scope"
