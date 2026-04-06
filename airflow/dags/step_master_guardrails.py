"""Shared guardrail helpers for step-master DAGs.

These helpers are intentionally Airflow-independent so they can be unit tested
without requiring an Airflow runtime in CI.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

DEFAULT_DELETE_RATIO_THRESHOLD = 0.01
DEFAULT_DELETE_COUNT_THRESHOLD = 40_000
DEFAULT_READY_MAX_AGE_MINUTES = 120
ALLOWED_DEL_YN_VALUES = {"Y", "N", None, ""}


def parse_iso_datetime(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_line_whitelist(raw: str) -> list[int]:
    lines: list[int] = []
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        lines.append(int(token))
    return sorted(set(lines))


def is_upstream_ready(
    source_max_last_update_date: datetime | None,
    now_utc: datetime,
    max_age_minutes: int,
) -> bool:
    if source_max_last_update_date is None:
        return False
    age_seconds = (now_utc - source_max_last_update_date).total_seconds()
    return age_seconds <= max_age_minutes * 60


def compute_delete_guardrail(
    current_rows: int,
    missing_rows: int,
    *,
    delete_ratio_threshold: float = DEFAULT_DELETE_RATIO_THRESHOLD,
    delete_count_threshold: int = DEFAULT_DELETE_COUNT_THRESHOLD,
) -> tuple[bool, float]:
    ratio = 0.0 if current_rows <= 0 else missing_rows / current_rows
    is_allowed = ratio <= delete_ratio_threshold and missing_rows <= delete_count_threshold
    return is_allowed, ratio


def determine_delete_block_reason(extracted_rows: int, guardrail_allowed: bool) -> str | None:
    if extracted_rows <= 0:
        return "EMPTY_STAGE"
    if not guardrail_allowed:
        return "DELETE_GUARDRAIL_BLOCKED"
    return None


def derive_line_status(validation_result: dict[str, Any]) -> str:
    if validation_result.get("null_key_count", 0) > 0:
        return "dq_failed"
    if validation_result.get("duplicate_key_count", 0) > 0:
        return "dq_failed"
    if validation_result.get("delete_block_reason"):
        return "validated_with_delete_block"
    return "validated"


def summarize_line_statuses(line_statuses: list[dict[str, Any]]) -> dict[str, int]:
    summary = {
        "total_lines": len(line_statuses),
        "validated_lines": 0,
        "dq_failed_lines": 0,
        "delete_blocked_lines": 0,
        "total_extracted_rows": 0,
        "total_merged_rows": 0,
        "total_deleted_rows": 0,
    }
    for line in line_statuses:
        status = line.get("status")
        summary["total_extracted_rows"] += int(line.get("extracted_rows", 0) or 0)
        summary["total_merged_rows"] += int(line.get("merged_rows", 0) or 0)
        summary["total_deleted_rows"] += int(line.get("deleted_rows", 0) or 0)
        if status == "validated":
            summary["validated_lines"] += 1
        elif status == "dq_failed":
            summary["dq_failed_lines"] += 1
        elif status == "validated_with_delete_block":
            summary["delete_blocked_lines"] += 1
    total_lines = summary["total_lines"]
    success_lines = summary["validated_lines"] + summary["delete_blocked_lines"]
    summary["success_lines"] = success_lines
    summary["failed_lines"] = summary["dq_failed_lines"]
    summary["success_ratio_pct"] = 0 if total_lines == 0 else int((success_lines / total_lines) * 100)
    return summary


def collect_candidate_cursor(rows: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    candidates: list[tuple[datetime, str, str]] = []
    for row in rows:
        event_ts = row.get("last_update_date")
        sys_key_vals = row.get("sys_key_vals")
        parsed_ts = parse_iso_datetime(event_ts)
        if parsed_ts is None or sys_key_vals is None:
            continue
        candidates.append((parsed_ts, str(sys_key_vals), str(event_ts)))
    if not candidates:
        return None, None
    _, sys_key, event_ts_raw = max(candidates, key=lambda item: (item[0], item[1]))
    return event_ts_raw, sys_key


def evaluate_incremental_dq(rows: list[dict[str, Any]]) -> dict[str, int]:
    null_key_count = 0
    invalid_del_yn_count = 0
    duplicate_event_count = 0
    seen_events: set[tuple[Any, ...]] = set()
    for row in rows:
        key_tuple = (row.get("line_id"), row.get("process_id"), row.get("step_seq"))
        if any(key is None for key in key_tuple):
            null_key_count += 1
        del_yn = row.get("del_yn")
        if del_yn not in ALLOWED_DEL_YN_VALUES:
            invalid_del_yn_count += 1
        event_identity = (
            row.get("last_update_date"),
            row.get("sys_key_vals"),
            row.get("line_id"),
            row.get("process_id"),
            row.get("step_seq"),
        )
        if event_identity in seen_events:
            duplicate_event_count += 1
        else:
            seen_events.add(event_identity)
    return {
        "null_key_count": null_key_count,
        "invalid_del_yn_count": invalid_del_yn_count,
        "duplicate_event_count": duplicate_event_count,
    }


def is_strictly_newer_cursor(
    event_ts: str | None,
    sys_key_vals: str | None,
    last_event_ts: str | None,
    last_sys_key_vals: str | None,
) -> bool:
    if event_ts is None or sys_key_vals is None:
        return False

    event_dt = parse_iso_datetime(event_ts)
    if event_dt is None:
        return False
    if last_event_ts is None:
        return True

    last_event_dt = parse_iso_datetime(last_event_ts)
    if last_event_dt is None:
        return True

    return (event_dt, sys_key_vals) > (last_event_dt, last_sys_key_vals or "")
