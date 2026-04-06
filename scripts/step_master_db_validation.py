#!/usr/bin/env python3
"""Step Master service DB validation utility.

Usage:
  python scripts/step_master_db_validation.py --db-url <SQLALCHEMY_URL> [--freshness-sla-minutes 120]
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

from sqlalchemy import create_engine, inspect, text


REQUIRED_TABLES = {
    "etl_run_log",
    "etl_run_line_status",
    "sync_watermark",
    "step_current",
    "step_event_audit",
}


def _to_utc_datetime(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)
    return None


def run_validation(db_url: str, freshness_sla_minutes: int) -> dict:
    engine = create_engine(db_url)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    missing_tables = sorted(REQUIRED_TABLES - tables)

    if missing_tables:
        now = datetime.now(timezone.utc)
        return {
            "ok": False,
            "checked_at": now.isoformat(),
            "freshness_sla_minutes": freshness_sla_minutes,
            "missing_tables": missing_tables,
            "checks": {
                "tables_present": False,
                "has_full_success_run": False,
                "has_incremental_watermark": False,
                "freshness_within_sla": False,
            },
            "latest_full_success": None,
            "watermark": None,
            "freshness_lag_minutes": None,
        }

    with engine.begin() as conn:
        latest_full = conn.execute(
            text(
                """
                SELECT run_id, finished_at
                FROM etl_run_log
                WHERE dag_id='full_to_current_hourly' AND status='success' AND finished_at IS NOT NULL
                ORDER BY finished_at DESC
                LIMIT 1
                """,
            )
        ).mappings().first()
        watermark = conn.execute(
            text(
                """
                SELECT pipeline_name, updated_at, last_event_ts
                FROM sync_watermark
                WHERE pipeline_name='step_incremental'
                LIMIT 1
                """,
            )
        ).mappings().first()

    now = datetime.now(timezone.utc)
    finished_at = _to_utc_datetime(None if latest_full is None else latest_full.get("finished_at"))
    freshness_lag_minutes = None if finished_at is None else int((now - finished_at).total_seconds() // 60)
    is_fresh = freshness_lag_minutes is not None and freshness_lag_minutes <= freshness_sla_minutes

    checks = {
        "tables_present": len(missing_tables) == 0,
        "has_full_success_run": latest_full is not None,
        "has_incremental_watermark": watermark is not None,
        "freshness_within_sla": is_fresh,
    }
    ok = all(checks.values())
    return {
        "ok": ok,
        "checked_at": now.isoformat(),
        "freshness_sla_minutes": freshness_sla_minutes,
        "missing_tables": missing_tables,
        "checks": checks,
        "latest_full_success": None if latest_full is None else dict(latest_full),
        "watermark": None if watermark is None else dict(watermark),
        "freshness_lag_minutes": freshness_lag_minutes,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-url", required=True)
    parser.add_argument("--freshness-sla-minutes", type=int, default=120)
    args = parser.parse_args()

    report = run_validation(args.db_url, args.freshness_sla_minutes)
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
