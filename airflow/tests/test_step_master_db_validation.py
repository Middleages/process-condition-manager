from __future__ import annotations

from pathlib import Path
import sys

from sqlalchemy import create_engine, text

sys.path.append(str(Path(__file__).resolve().parents[2] / "scripts"))

from step_master_db_validation import run_validation


def _create_min_schema(db_url: str) -> None:
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE etl_run_log (id INTEGER PRIMARY KEY AUTOINCREMENT, dag_id TEXT, run_id TEXT, status TEXT, finished_at TEXT)"))
        conn.execute(text("CREATE TABLE etl_run_line_status (id INTEGER PRIMARY KEY AUTOINCREMENT, run_log_id INTEGER, line_id INTEGER, status TEXT)"))
        conn.execute(text("CREATE TABLE sync_watermark (id INTEGER PRIMARY KEY AUTOINCREMENT, pipeline_name TEXT, updated_at TEXT, last_event_ts TEXT)"))
        conn.execute(text("CREATE TABLE step_current (id INTEGER PRIMARY KEY AUTOINCREMENT, line_id INTEGER)"))
        conn.execute(text("CREATE TABLE step_event_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, line_id INTEGER)"))


def test_run_validation_ok(tmp_path: Path) -> None:
    db_url = f"sqlite:///{tmp_path}/ok.db"
    _create_min_schema(db_url)
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO etl_run_log (dag_id, run_id, status, finished_at)
                VALUES ('full_to_current_hourly', 'r1', 'success', datetime('now'))
                """,
            )
        )
        conn.execute(
            text(
                """
                INSERT INTO sync_watermark (pipeline_name, updated_at, last_event_ts)
                VALUES ('step_incremental', datetime('now'), datetime('now'))
                """,
            )
        )

    report = run_validation(db_url, freshness_sla_minutes=120)
    assert report["ok"] is True
    assert report["checks"]["tables_present"] is True


def test_run_validation_missing_watermark(tmp_path: Path) -> None:
    db_url = f"sqlite:///{tmp_path}/bad.db"
    _create_min_schema(db_url)
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO etl_run_log (dag_id, run_id, status, finished_at)
                VALUES ('full_to_current_hourly', 'r1', 'success', datetime('now'))
                """,
            )
        )

    report = run_validation(db_url, freshness_sla_minutes=120)
    assert report["ok"] is False
    assert report["checks"]["has_incremental_watermark"] is False


def test_run_validation_missing_tables_returns_report(tmp_path: Path) -> None:
    db_url = f"sqlite:///{tmp_path}/empty.db"
    report = run_validation(db_url, freshness_sla_minutes=120)
    assert report["ok"] is False
    assert report["checks"]["tables_present"] is False
    assert len(report["missing_tables"]) > 0
