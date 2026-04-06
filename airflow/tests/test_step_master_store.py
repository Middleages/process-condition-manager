from __future__ import annotations

from pathlib import Path
import sys

from sqlalchemy import create_engine, text

sys.path.append(str(Path(__file__).resolve().parents[1] / "dags"))

import pytest

from step_master_store import (
    build_reconciliation_report,
    compute_service_health_snapshot,
    build_full_source_table_name,
    compute_full_stage_metrics,
    delete_missing_step_current_from_stage,
    ensure_run_log,
    fetch_full_source_max_last_update,
    fetch_incremental_rows_since,
    fetch_incremental_rows_between,
    fetch_source_rows,
    finalize_run_log,
    insert_stage_rows,
    load_watermark,
    merge_step_current_from_stage,
    prepare_stage_table,
    save_watermark,
    upsert_line_statuses,
)


def _create_schema(db_url: str) -> None:
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE etl_run_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    dag_id TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    airflow_dag_run_id TEXT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT NULL,
                    extracted_rows INTEGER NOT NULL DEFAULT 0,
                    merged_rows INTEGER NOT NULL DEFAULT 0,
                    deleted_rows INTEGER NOT NULL DEFAULT 0,
                    failed_lines INTEGER NOT NULL DEFAULT 0,
                    duration_seconds REAL NULL,
                    error_summary TEXT NULL,
                    created_at TEXT NULL,
                    UNIQUE(dag_id, run_id)
                )
                """,
            ),
        )
        conn.execute(
            text(
                """
                CREATE TABLE etl_run_line_status (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_log_id INTEGER NOT NULL,
                    line_id INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    extracted_rows INTEGER NOT NULL DEFAULT 0,
                    merged_rows INTEGER NOT NULL DEFAULT 0,
                    deleted_rows INTEGER NOT NULL DEFAULT 0,
                    dq_violation_count INTEGER NOT NULL DEFAULT 0,
                    error_reason TEXT NULL,
                    created_at TEXT NULL,
                    updated_at TEXT NULL,
                    UNIQUE(run_log_id, line_id)
                )
                """,
            ),
        )
        conn.execute(
            text(
                """
                CREATE TABLE step_current (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    line_id INTEGER NOT NULL,
                    process_id TEXT NOT NULL,
                    step_seq TEXT NOT NULL,
                    step_name TEXT NULL,
                    layer_id TEXT NULL,
                    descript TEXT NULL,
                    sys_key_vals TEXT NULL,
                    source_updated_at TEXT NULL,
                    raw_payload TEXT NULL,
                    created_at TEXT NULL,
                    updated_at TEXT NULL,
                    UNIQUE(line_id, process_id, step_seq)
                )
                """,
            ),
        )
        conn.execute(
            text(
                """
                CREATE TABLE sync_watermark (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pipeline_name TEXT NOT NULL UNIQUE,
                    last_event_ts TEXT NULL,
                    last_sys_key_vals TEXT NULL,
                    updated_at TEXT NULL
                )
                """,
            ),
        )


def test_run_log_and_line_status_persistence(tmp_path: Path) -> None:
    db_url = f"sqlite:///{tmp_path}/store.db"
    _create_schema(db_url)

    run_log_id = ensure_run_log(
        db_url=db_url,
        dag_id="full_to_current_hourly",
        run_id="manual__2026-04-02T00:00:00+00:00",
        airflow_dag_run_id="manual__2026-04-02T00:00:00+00:00",
        status="running",
    )
    assert run_log_id > 0

    upsert_line_statuses(
        db_url=db_url,
        run_log_id=run_log_id,
        line_statuses=[
            {
                "line_id": 1,
                "status": "validated",
                "extracted_rows": 123,
                "merged_rows": 120,
                "deleted_rows": 3,
                "null_key_count": 0,
                "duplicate_key_count": 0,
                "status_reason": None,
            },
            {
                "line_id": 2,
                "status": "dq_failed",
                "extracted_rows": 50,
                "merged_rows": 0,
                "deleted_rows": 0,
                "null_key_count": 1,
                "duplicate_key_count": 0,
                "status_reason": "NULL_KEY",
            },
        ],
    )

    finalize_run_log(
        db_url=db_url,
        run_log_id=run_log_id,
        run_summary={
            "failed_lines": 1,
            "total_extracted_rows": 173,
            "total_merged_rows": 120,
            "total_deleted_rows": 3,
        },
        status="failed",
        error_summary="Some lines failed DQ",
    )

    engine = create_engine(db_url)
    with engine.begin() as conn:
        run_log = conn.execute(
            text("SELECT status, failed_lines, extracted_rows, merged_rows, deleted_rows FROM etl_run_log WHERE id = :id"),
            {"id": run_log_id},
        ).mappings().one()
        assert run_log["status"] == "failed"
        assert run_log["failed_lines"] == 1
        assert run_log["extracted_rows"] == 173
        assert run_log["merged_rows"] == 120
        assert run_log["deleted_rows"] == 3

        line_rows = conn.execute(
            text("SELECT line_id, status, dq_violation_count, merged_rows, deleted_rows FROM etl_run_line_status ORDER BY line_id"),
        ).mappings().all()
        assert len(line_rows) == 2
        assert line_rows[1]["dq_violation_count"] == 1
        assert line_rows[0]["merged_rows"] == 120
        assert line_rows[0]["deleted_rows"] == 3


def test_watermark_load_and_save(tmp_path: Path) -> None:
    db_url = f"sqlite:///{tmp_path}/store_wm.db"
    _create_schema(db_url)

    assert load_watermark(db_url=db_url, pipeline_name="step_incremental") == {
        "last_event_ts": None,
        "last_sys_key_vals": None,
    }

    save_watermark(
        db_url=db_url,
        pipeline_name="step_incremental",
        last_event_ts="2026-04-02T10:00:00+00:00",
        last_sys_key_vals="K1",
    )
    assert load_watermark(db_url=db_url, pipeline_name="step_incremental") == {
        "last_event_ts": "2026-04-02T10:00:00+00:00",
        "last_sys_key_vals": "K1",
    }


def test_stage_table_identifier_validation() -> None:
    with pytest.raises(ValueError):
        merge_step_current_from_stage(db_url="sqlite:///ignored.db", stage_table="bad;drop", line_id=1)
    with pytest.raises(ValueError):
        delete_missing_step_current_from_stage(db_url="sqlite:///ignored.db", stage_table="bad table", line_id=1)


def test_stage_prepare_insert_metrics_and_merge_delete(tmp_path: Path) -> None:
    db_url = f"sqlite:///{tmp_path}/stage.db"
    _create_schema(db_url)

    stage_table = "step_stage_1"
    prepare_stage_table(db_url=db_url, stage_table=stage_table)
    insert_stage_rows(
        db_url=db_url,
        stage_table=stage_table,
        rows=[
            {"process_id": "P1", "step_seq": "1", "step_name": "S1", "layer_id": "L1", "descript": "", "sys_key_vals": "K1", "last_update_date": "2026-04-02T10:00:00+00:00", "del_yn": "N"},
            {"process_id": "P2", "step_seq": "2", "step_name": "S2", "layer_id": "L2", "descript": "", "sys_key_vals": "K2", "last_update_date": "2026-04-02T10:00:00+00:00", "del_yn": "N"},
        ],
    )

    # seed current with one extra row so delete path can remove it
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO step_current (line_id, process_id, step_seq, step_name, layer_id, descript, sys_key_vals, source_updated_at, raw_payload)
                VALUES
                (1, 'P1', '1', 'old', 'L1', '', 'K1', '2026-04-01', '{}'),
                (1, 'P3', '3', 'old', 'L3', '', 'K3', '2026-04-01', '{}')
                """,
            ),
        )

    metrics = compute_full_stage_metrics(db_url=db_url, stage_table=stage_table, line_id=1)
    assert metrics["current_rows"] == 2
    assert metrics["missing_rows"] == 1

    merged_rows = merge_step_current_from_stage(db_url=db_url, stage_table=stage_table, line_id=1)
    assert merged_rows >= 2

    deleted_rows = delete_missing_step_current_from_stage(db_url=db_url, stage_table=stage_table, line_id=1)
    assert deleted_rows == 1


def test_fetch_source_rows_and_table_name(tmp_path: Path) -> None:
    db_url = f"sqlite:///{tmp_path}/source.db"
    engine = create_engine(db_url)
    table_name = build_full_source_table_name(10)
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                CREATE TABLE {table_name} (
                    process_id TEXT,
                    step_seq TEXT,
                    step_name TEXT,
                    layer_id TEXT,
                    descript TEXT,
                    sys_key_vals TEXT,
                    last_update_date TEXT,
                    del_yn TEXT
                )
                """,
            ),
        )
        conn.execute(text(f"INSERT INTO {table_name} VALUES ('P1','1','S1','L1','','K1','2026-04-02T10:00:00+00:00','N')"))

    rows = fetch_source_rows(source_db_url=db_url, source_table=table_name)
    assert len(rows) == 1
    assert rows[0]["process_id"] == "P1"


def test_fetch_full_source_max_last_update(tmp_path: Path) -> None:
    db_url = f"sqlite:///{tmp_path}/source_max.db"
    engine = create_engine(db_url)
    table_1 = build_full_source_table_name(1)
    table_2 = build_full_source_table_name(2)
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                CREATE TABLE {table_1} (
                    process_id TEXT, step_seq TEXT, step_name TEXT, layer_id TEXT, descript TEXT,
                    sys_key_vals TEXT, last_update_date TEXT, del_yn TEXT
                )
                """,
            ),
        )
        conn.execute(
            text(
                f"""
                CREATE TABLE {table_2} (
                    process_id TEXT, step_seq TEXT, step_name TEXT, layer_id TEXT, descript TEXT,
                    sys_key_vals TEXT, last_update_date TEXT, del_yn TEXT
                )
                """,
            ),
        )
        conn.execute(text(f"INSERT INTO {table_1} VALUES ('P1','1','S1','L1','','K1','2026-04-05T10:00:00+00:00','N')"))
        conn.execute(text(f"INSERT INTO {table_2} VALUES ('P2','1','S2','L2','','K2','2026-04-05T11:00:00+00:00','N')"))

    max_ts = fetch_full_source_max_last_update(source_db_url=db_url, line_ids=[1, 2])
    assert max_ts is not None
    assert max_ts.startswith("2026-04-05T11:00:00")


def test_fetch_incremental_rows_since_pushdown(tmp_path: Path) -> None:
    db_url = f"sqlite:///{tmp_path}/incr.db"
    engine = create_engine(db_url)
    table_name = "step_incremental_history"
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                CREATE TABLE {table_name} (
                    line_id INTEGER,
                    process_id TEXT,
                    step_seq TEXT,
                    step_name TEXT,
                    layer_id TEXT,
                    descript TEXT,
                    sys_key_vals TEXT,
                    last_update_date TEXT,
                    del_yn TEXT
                )
                """,
            ),
        )
        conn.execute(
            text(
                f"""
                INSERT INTO {table_name} VALUES
                (1,'P1','1','S1','L1','','A','2026-04-02T10:00:00+00:00','N'),
                (1,'P1','2','S2','L2','','B','2026-04-02T10:00:00+00:00','N'),
                (1,'P2','1','S3','L3','','A','2026-04-02T10:01:00+00:00','N')
                """,
            ),
        )

    rows = fetch_incremental_rows_since(
        source_db_url=db_url,
        source_table=table_name,
        last_event_ts="2026-04-02T10:00:00+00:00",
        last_sys_key_vals="A",
        batch_limit=10,
    )
    assert len(rows) == 2
    assert rows[0]["sys_key_vals"] == "B"
    assert rows[1]["last_update_date"] == "2026-04-02T10:01:00+00:00"


def test_fetch_incremental_rows_between_backfill_window(tmp_path: Path) -> None:
    db_url = f"sqlite:///{tmp_path}/incr_window.db"
    engine = create_engine(db_url)
    table_name = "step_incremental_history"
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                CREATE TABLE {table_name} (
                    line_id INTEGER,
                    process_id TEXT,
                    step_seq TEXT,
                    step_name TEXT,
                    layer_id TEXT,
                    descript TEXT,
                    sys_key_vals TEXT,
                    last_update_date TEXT,
                    del_yn TEXT
                )
                """,
            ),
        )
        conn.execute(
            text(
                f"""
                INSERT INTO {table_name} VALUES
                (1,'P1','1','S1','L1','','A','2026-04-02T09:59:59+00:00','N'),
                (1,'P1','2','S2','L2','','B','2026-04-02T10:00:00+00:00','N'),
                (1,'P2','1','S3','L3','','C','2026-04-02T10:30:00+00:00','N'),
                (1,'P2','2','S4','L4','','D','2026-04-02T11:00:00+00:00','N')
                """,
            ),
        )

    rows = fetch_incremental_rows_between(
        source_db_url=db_url,
        source_table=table_name,
        start_ts="2026-04-02T10:00:00+00:00",
        end_ts="2026-04-02T11:00:00+00:00",
        batch_limit=100,
    )
    assert len(rows) == 2
    assert rows[0]["sys_key_vals"] == "B"
    assert rows[1]["sys_key_vals"] == "C"


def test_merge_delete_idempotency_for_line_rerun(tmp_path: Path) -> None:
    db_url = f"sqlite:///{tmp_path}/idempotency.db"
    _create_schema(db_url)

    stage_table = "step_stage_2"
    prepare_stage_table(db_url=db_url, stage_table=stage_table)
    insert_stage_rows(
        db_url=db_url,
        stage_table=stage_table,
        rows=[
            {"process_id": "P1", "step_seq": "1", "step_name": "S1", "layer_id": "L1", "descript": "", "sys_key_vals": "K1", "last_update_date": "2026-04-02T10:00:00+00:00", "del_yn": "N"},
            {"process_id": "P2", "step_seq": "2", "step_name": "S2", "layer_id": "L2", "descript": "", "sys_key_vals": "K2", "last_update_date": "2026-04-02T10:00:00+00:00", "del_yn": "N"},
        ],
    )

    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO step_current (line_id, process_id, step_seq, step_name, layer_id, descript, sys_key_vals, source_updated_at, raw_payload)
                VALUES
                (1, 'P1', '1', 'old', 'L1', '', 'K1', '2026-04-01', '{}'),
                (1, 'P3', '3', 'old', 'L3', '', 'K3', '2026-04-01', '{}')
                """,
            ),
        )

    first_merge = merge_step_current_from_stage(db_url=db_url, stage_table=stage_table, line_id=1)
    first_delete = delete_missing_step_current_from_stage(db_url=db_url, stage_table=stage_table, line_id=1)
    second_merge = merge_step_current_from_stage(db_url=db_url, stage_table=stage_table, line_id=1)
    second_delete = delete_missing_step_current_from_stage(db_url=db_url, stage_table=stage_table, line_id=1)

    with engine.begin() as conn:
        final_count = conn.execute(text("SELECT COUNT(*) FROM step_current WHERE line_id = 1")).scalar_one()
        keys = conn.execute(
            text("SELECT process_id, step_seq FROM step_current WHERE line_id = 1 ORDER BY process_id, step_seq"),
        ).all()

    assert first_merge >= 2
    assert first_delete == 1
    assert second_merge >= 0
    assert second_delete == 0
    assert final_count == 2
    assert keys == [("P1", "1"), ("P2", "2")]


def test_build_reconciliation_report(tmp_path: Path) -> None:
    db_url = f"sqlite:///{tmp_path}/recon.db"
    _create_schema(db_url)

    run_log_id = ensure_run_log(
        db_url=db_url,
        dag_id="full_to_current_hourly",
        run_id="manual__2026-04-03T01:00:00+00:00",
        airflow_dag_run_id="manual__2026-04-03T01:00:00+00:00",
        status="success",
    )
    upsert_line_statuses(
        db_url=db_url,
        run_log_id=run_log_id,
        line_statuses=[
            {"line_id": 1, "status": "validated", "extracted_rows": 10, "merged_rows": 8, "deleted_rows": 2},
        ],
    )

    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO step_current (line_id, process_id, step_seq, step_name, layer_id, descript, sys_key_vals, source_updated_at, raw_payload)
                VALUES
                (1, 'P1', '1', 'S1', '1.0', '', 'K1', '2026-04-03T00:00:00+00:00', '{}'),
                (1, 'P2', '2', 'S2', '2.0', '', 'K2', '2026-04-03T00:00:00+00:00', '{}')
                """,
            ),
        )
    save_watermark(
        db_url=db_url,
        pipeline_name="step_incremental",
        last_event_ts="2026-04-03T00:10:00+00:00",
        last_sys_key_vals="K2",
    )

    report = build_reconciliation_report(db_url=db_url, line_ids=[1, 2])
    assert report["generated_at"]
    assert len(report["line_summaries"]) == 2
    line1 = [line for line in report["line_summaries"] if line["line_id"] == 1][0]
    line2 = [line for line in report["line_summaries"] if line["line_id"] == 2][0]
    assert line1["current_rows"] == 2
    assert line1["latest_status"]["status"] == "validated"
    assert line2["current_rows"] == 0
    assert line2["latest_status"] is None
    assert report["watermark"]["pipeline_name"] == "step_incremental"


def test_compute_service_health_snapshot(tmp_path: Path) -> None:
    db_url = f"sqlite:///{tmp_path}/health.db"
    _create_schema(db_url)

    run_log_id = ensure_run_log(
        db_url=db_url,
        dag_id="full_to_current_hourly",
        run_id="manual__2026-04-05T01:00:00+00:00",
        airflow_dag_run_id="manual__2026-04-05T01:00:00+00:00",
        status="running",
    )
    finalize_run_log(
        db_url=db_url,
        run_log_id=run_log_id,
        run_summary={"failed_lines": 0, "total_extracted_rows": 0, "total_merged_rows": 0, "total_deleted_rows": 0},
        status="success",
        error_summary=None,
    )
    save_watermark(
        db_url=db_url,
        pipeline_name="step_incremental",
        last_event_ts="2026-04-05T00:10:00+00:00",
        last_sys_key_vals="K1",
    )

    snapshot = compute_service_health_snapshot(db_url=db_url, freshness_sla_minutes=120)
    assert snapshot["is_fresh"] is True
    assert snapshot["has_watermark"] is True
    assert snapshot["latest_full_success"] is not None
    assert snapshot["watermark"]["pipeline_name"] == "step_incremental"
