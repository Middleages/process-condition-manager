from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1] / "dags"))

from step_master_guardrails import (
    collect_candidate_cursor,
    compute_delete_guardrail,
    derive_line_status,
    determine_delete_block_reason,
    evaluate_incremental_dq,
    is_strictly_newer_cursor,
    is_upstream_ready,
    parse_iso_datetime,
    parse_line_whitelist,
    summarize_line_statuses,
)


def test_parse_line_whitelist_dedup_and_sort() -> None:
    assert parse_line_whitelist("3, 1,3,2") == [1, 2, 3]


def test_parse_iso_datetime_supports_z_and_naive() -> None:
    assert parse_iso_datetime("2026-04-01T00:00:00Z") == datetime(2026, 4, 1, 0, 0, tzinfo=timezone.utc)
    assert parse_iso_datetime("2026-04-01T00:00:00") == datetime(2026, 4, 1, 0, 0, tzinfo=timezone.utc)


def test_parse_iso_datetime_returns_none_for_invalid() -> None:
    assert parse_iso_datetime("not-a-datetime") is None


def test_is_upstream_ready_false_when_missing() -> None:
    assert not is_upstream_ready(None, datetime(2026, 4, 1, 0, 0, tzinfo=timezone.utc), 30)


def test_is_upstream_ready_within_age_limit() -> None:
    now_utc = datetime(2026, 4, 1, 1, 0, tzinfo=timezone.utc)
    source = datetime(2026, 4, 1, 0, 10, tzinfo=timezone.utc)
    assert is_upstream_ready(source, now_utc, 60)


def test_compute_delete_guardrail_thresholds() -> None:
    allowed, ratio = compute_delete_guardrail(3_600_000, 20_000, delete_ratio_threshold=0.01, delete_count_threshold=40_000)
    assert allowed
    assert ratio < 0.01

    blocked, blocked_ratio = compute_delete_guardrail(3_600_000, 50_000, delete_ratio_threshold=0.01, delete_count_threshold=40_000)
    assert not blocked
    assert blocked_ratio > 0.01


def test_is_strictly_newer_cursor_handles_ties() -> None:
    assert is_strictly_newer_cursor("2026-04-01T10:00:00Z", "B", "2026-04-01T10:00:00Z", "A")
    assert not is_strictly_newer_cursor("2026-04-01T10:00:00Z", "A", "2026-04-01T10:00:00Z", "A")
    assert not is_strictly_newer_cursor("2026-04-01T09:59:59Z", "Z", "2026-04-01T10:00:00Z", "A")


def test_is_strictly_newer_cursor_handles_invalid_or_null_cursor() -> None:
    assert not is_strictly_newer_cursor("bad", "A", "2026-04-01T10:00:00Z", "A")
    assert not is_strictly_newer_cursor("2026-04-01T10:00:00Z", None, "2026-04-01T10:00:00Z", "A")


def test_determine_delete_block_reason() -> None:
    assert determine_delete_block_reason(0, True) == "EMPTY_STAGE"
    assert determine_delete_block_reason(10, False) == "DELETE_GUARDRAIL_BLOCKED"
    assert determine_delete_block_reason(10, True) is None


def test_derive_line_status() -> None:
    assert derive_line_status({"null_key_count": 1}) == "dq_failed"
    assert derive_line_status({"duplicate_key_count": 1}) == "dq_failed"
    assert derive_line_status({"delete_block_reason": "EMPTY_STAGE"}) == "validated_with_delete_block"
    assert derive_line_status({}) == "validated"


def test_summarize_line_statuses() -> None:
    summary = summarize_line_statuses(
        [
            {"status": "validated"},
            {"status": "dq_failed", "extracted_rows": 1},
            {"status": "validated_with_delete_block", "merged_rows": 2},
            {"status": "validated", "deleted_rows": 3},
        ],
    )
    assert summary == {
        "total_lines": 4,
        "validated_lines": 2,
        "dq_failed_lines": 1,
        "delete_blocked_lines": 1,
        "total_extracted_rows": 1,
        "total_merged_rows": 2,
        "total_deleted_rows": 3,
        "success_lines": 3,
        "failed_lines": 1,
        "success_ratio_pct": 75,
    }


def test_collect_candidate_cursor() -> None:
    rows = [
        {"last_update_date": "2026-04-01T10:00:00Z", "sys_key_vals": "A"},
        {"last_update_date": "2026-04-01T10:00:00Z", "sys_key_vals": "B"},
        {"last_update_date": "2026-04-01T10:01:00Z", "sys_key_vals": "A"},
    ]
    assert collect_candidate_cursor(rows) == ("2026-04-01T10:01:00Z", "A")


def test_evaluate_incremental_dq() -> None:
    rows = [
        {
            "line_id": 1,
            "process_id": "P1",
            "step_seq": 1,
            "last_update_date": "2026-04-01T10:00:00Z",
            "sys_key_vals": "K1",
            "del_yn": "N",
        },
        {
            "line_id": None,
            "process_id": "P1",
            "step_seq": 1,
            "last_update_date": "2026-04-01T10:00:00Z",
            "sys_key_vals": "K2",
            "del_yn": "INVALID",
        },
        {
            "line_id": 1,
            "process_id": "P1",
            "step_seq": 1,
            "last_update_date": "2026-04-01T10:00:00Z",
            "sys_key_vals": "K1",
            "del_yn": "N",
        },
    ]
    assert evaluate_incremental_dq(rows) == {
        "null_key_count": 1,
        "invalid_del_yn_count": 1,
        "duplicate_event_count": 1,
    }
