"""DB persistence helpers for step-master DAG run metadata.

These helpers are intentionally lightweight (SQLAlchemy Core + text SQL) so DAG
tasks can persist run/line status without importing backend ORM modules.
"""

from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any

from sqlalchemy import create_engine, text

_SAFE_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _assert_safe_identifier(identifier: str) -> None:
    if not _SAFE_IDENTIFIER_RE.fullmatch(identifier):
        raise ValueError(f"Unsafe SQL identifier: {identifier}")


def build_full_source_table_name(line_id: int) -> str:
    return f"fab_f_step_{line_id}"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_run_log(
    *,
    db_url: str,
    dag_id: str,
    run_id: str,
    airflow_dag_run_id: str | None,
    status: str,
) -> int:
    query = text(
        """
        INSERT INTO etl_run_log (dag_id, run_id, airflow_dag_run_id, status, started_at, extracted_rows, merged_rows, deleted_rows, failed_lines)
        VALUES (:dag_id, :run_id, :airflow_dag_run_id, :status, :started_at, 0, 0, 0, 0)
        ON CONFLICT (dag_id, run_id)
        DO UPDATE SET status = EXCLUDED.status
        RETURNING id
        """,
    )
    engine = create_engine(db_url)
    with engine.begin() as conn:
        run_log_id = conn.execute(
            query,
            {
                "dag_id": dag_id,
                "run_id": run_id,
                "airflow_dag_run_id": airflow_dag_run_id,
                "status": status,
                "started_at": utc_now(),
            },
        ).scalar_one()
    return int(run_log_id)


def upsert_line_statuses(
    *,
    db_url: str,
    run_log_id: int,
    line_statuses: list[dict[str, Any]],
) -> None:
    query = text(
        """
        INSERT INTO etl_run_line_status (
            run_log_id, line_id, status, retry_count, extracted_rows, merged_rows, deleted_rows, dq_violation_count, error_reason, created_at, updated_at
        )
        VALUES (
            :run_log_id, :line_id, :status, 0, :extracted_rows, :merged_rows, :deleted_rows, :dq_violation_count, :error_reason, :created_at, :updated_at
        )
        ON CONFLICT (run_log_id, line_id)
        DO UPDATE SET
            status = EXCLUDED.status,
            extracted_rows = EXCLUDED.extracted_rows,
            merged_rows = EXCLUDED.merged_rows,
            deleted_rows = EXCLUDED.deleted_rows,
            dq_violation_count = EXCLUDED.dq_violation_count,
            error_reason = EXCLUDED.error_reason,
            updated_at = EXCLUDED.updated_at
        """,
    )
    now = utc_now()
    params = [
        {
            "run_log_id": run_log_id,
            "line_id": row["line_id"],
            "status": row["status"],
            "extracted_rows": row.get("extracted_rows", 0),
            "merged_rows": row.get("merged_rows", 0),
            "deleted_rows": row.get("deleted_rows", 0),
            "dq_violation_count": int(row.get("null_key_count", 0)) + int(row.get("duplicate_key_count", 0)),
            "error_reason": row.get("status_reason"),
            "created_at": now,
            "updated_at": now,
        }
        for row in line_statuses
    ]
    if not params:
        return
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(query, params)


def finalize_run_log(
    *,
    db_url: str,
    run_log_id: int,
    run_summary: dict[str, Any],
    status: str,
    error_summary: str | None = None,
) -> None:
    query = text(
        """
        UPDATE etl_run_log
        SET
            status = :status,
            finished_at = :finished_at,
            extracted_rows = :extracted_rows,
            merged_rows = :merged_rows,
            deleted_rows = :deleted_rows,
            failed_lines = :failed_lines,
            duration_seconds = :duration_seconds,
            error_summary = :error_summary
        WHERE id = :run_log_id
        """,
    )
    engine = create_engine(db_url)
    finished_at = utc_now()
    with engine.begin() as conn:
        started_at = conn.execute(text("SELECT started_at FROM etl_run_log WHERE id = :run_log_id"), {"run_log_id": run_log_id}).scalar_one_or_none()
        duration_seconds = None
        if started_at is not None and hasattr(started_at, "timestamp"):
            duration_seconds = max(0.0, finished_at.timestamp() - started_at.timestamp())
        conn.execute(
            query,
            {
                "status": status,
                "finished_at": finished_at,
                "extracted_rows": int(run_summary.get("total_extracted_rows", 0)),
                "merged_rows": int(run_summary.get("total_merged_rows", 0)),
                "deleted_rows": int(run_summary.get("total_deleted_rows", 0)),
                "failed_lines": int(run_summary.get("failed_lines", 0)),
                "duration_seconds": duration_seconds,
                "error_summary": error_summary,
                "run_log_id": run_log_id,
            },
        )


def load_watermark(*, db_url: str, pipeline_name: str) -> dict[str, Any]:
    query = text(
        """
        SELECT last_event_ts, last_sys_key_vals
        FROM sync_watermark
        WHERE pipeline_name = :pipeline_name
        """,
    )
    engine = create_engine(db_url)
    with engine.begin() as conn:
        row = conn.execute(query, {"pipeline_name": pipeline_name}).mappings().first()
    if row is None:
        return {"last_event_ts": None, "last_sys_key_vals": None}
    return {"last_event_ts": row["last_event_ts"], "last_sys_key_vals": row["last_sys_key_vals"]}


def save_watermark(
    *,
    db_url: str,
    pipeline_name: str,
    last_event_ts: str | None,
    last_sys_key_vals: str | None,
) -> None:
    query = text(
        """
        INSERT INTO sync_watermark (pipeline_name, last_event_ts, last_sys_key_vals, updated_at)
        VALUES (:pipeline_name, :last_event_ts, :last_sys_key_vals, :updated_at)
        ON CONFLICT (pipeline_name)
        DO UPDATE SET
            last_event_ts = EXCLUDED.last_event_ts,
            last_sys_key_vals = EXCLUDED.last_sys_key_vals,
            updated_at = EXCLUDED.updated_at
        """,
    )
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(
            query,
            {
                "pipeline_name": pipeline_name,
                "last_event_ts": last_event_ts,
                "last_sys_key_vals": last_sys_key_vals,
                "updated_at": utc_now(),
            },
        )


def merge_step_current_from_stage(
    *,
    db_url: str,
    stage_table: str,
    line_id: int,
) -> int:
    _assert_safe_identifier(stage_table)
    engine = create_engine(db_url)
    with engine.begin() as conn:
        updated_at = utc_now()
        if conn.dialect.name == "sqlite":
            update_query = text(
                f"""
                UPDATE step_current
                SET
                    step_name = (SELECT s.step_name FROM {stage_table} s WHERE s.process_id = step_current.process_id AND s.step_seq = step_current.step_seq),
                    layer_id = (SELECT s.layer_id FROM {stage_table} s WHERE s.process_id = step_current.process_id AND s.step_seq = step_current.step_seq),
                    descript = (SELECT s.descript FROM {stage_table} s WHERE s.process_id = step_current.process_id AND s.step_seq = step_current.step_seq),
                    sys_key_vals = (SELECT s.sys_key_vals FROM {stage_table} s WHERE s.process_id = step_current.process_id AND s.step_seq = step_current.step_seq),
                    source_updated_at = (SELECT s.last_update_date FROM {stage_table} s WHERE s.process_id = step_current.process_id AND s.step_seq = step_current.step_seq),
                    raw_payload = (SELECT s.raw_payload FROM {stage_table} s WHERE s.process_id = step_current.process_id AND s.step_seq = step_current.step_seq),
                    updated_at = :updated_at
                WHERE line_id = :line_id
                  AND EXISTS (
                    SELECT 1 FROM {stage_table} s
                    WHERE s.process_id = step_current.process_id
                      AND s.step_seq = step_current.step_seq
                  )
                """,
            )
            insert_query = text(
                f"""
                INSERT INTO step_current (line_id, process_id, step_seq, step_name, layer_id, descript, sys_key_vals, source_updated_at, raw_payload, updated_at)
                SELECT :line_id, s.process_id, s.step_seq, s.step_name, s.layer_id, s.descript, s.sys_key_vals, s.last_update_date, s.raw_payload, :updated_at
                FROM {stage_table} s
                WHERE NOT EXISTS (
                    SELECT 1 FROM step_current sc
                    WHERE sc.line_id = :line_id
                      AND sc.process_id = s.process_id
                      AND sc.step_seq = s.step_seq
                )
                """,
            )
            updated = conn.execute(update_query, {"line_id": line_id, "updated_at": updated_at}).rowcount or 0
            inserted = conn.execute(insert_query, {"line_id": line_id, "updated_at": updated_at}).rowcount or 0
            return int(updated + inserted)

        query = text(
            f"""
            INSERT INTO step_current (line_id, process_id, step_seq, step_name, layer_id, descript, sys_key_vals, source_updated_at, raw_payload, updated_at)
            SELECT
                :line_id,
                s.process_id,
                s.step_seq,
                s.step_name,
                s.layer_id,
                s.descript,
                s.sys_key_vals,
                s.last_update_date,
                s.raw_payload,
                :updated_at
            FROM {stage_table} s
            ON CONFLICT (line_id, process_id, step_seq)
            DO UPDATE SET
                step_name = EXCLUDED.step_name,
                layer_id = EXCLUDED.layer_id,
                descript = EXCLUDED.descript,
                sys_key_vals = EXCLUDED.sys_key_vals,
                source_updated_at = EXCLUDED.source_updated_at,
                raw_payload = EXCLUDED.raw_payload,
                updated_at = EXCLUDED.updated_at
            """,
        )
        result = conn.execute(query, {"line_id": line_id, "updated_at": updated_at})
        return int(result.rowcount or 0)


def delete_missing_step_current_from_stage(
    *,
    db_url: str,
    stage_table: str,
    line_id: int,
) -> int:
    _assert_safe_identifier(stage_table)
    engine = create_engine(db_url)
    with engine.begin() as conn:
        if conn.dialect.name == "sqlite":
            query = text(
                f"""
                DELETE FROM step_current
                WHERE line_id = :line_id
                  AND NOT EXISTS (
                    SELECT 1
                    FROM {stage_table} s
                    WHERE s.process_id = step_current.process_id
                      AND s.step_seq = step_current.step_seq
                  )
                """,
            )
        else:
            query = text(
                f"""
                DELETE FROM step_current sc
                WHERE sc.line_id = :line_id
                  AND NOT EXISTS (
                    SELECT 1
                    FROM {stage_table} s
                    WHERE s.process_id = sc.process_id
                      AND s.step_seq = sc.step_seq
                  )
                """,
            )
        result = conn.execute(query, {"line_id": line_id})
    return int(result.rowcount or 0)


def fetch_source_rows(
    *,
    source_db_url: str,
    source_table: str,
) -> list[dict[str, Any]]:
    _assert_safe_identifier(source_table)
    query = text(
        f"""
        SELECT process_id, step_seq, step_name, layer_id, descript, sys_key_vals, last_update_date, del_yn
        FROM {source_table}
        """,
    )
    engine = create_engine(source_db_url)
    with engine.begin() as conn:
        rows = conn.execute(query).mappings().all()
    return [dict(row) for row in rows]


def fetch_full_source_max_last_update(
    *,
    source_db_url: str,
    line_ids: list[int],
) -> str | None:
    engine = create_engine(source_db_url)
    max_values: list[datetime] = []
    with engine.begin() as conn:
        for line_id in sorted(set(line_ids)):
            table = build_full_source_table_name(line_id)
            _assert_safe_identifier(table)
            value = conn.execute(text(f"SELECT MAX(last_update_date) AS max_ts FROM {table}")).scalar_one_or_none()
            if value is None:
                continue
            if isinstance(value, str):
                try:
                    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                except ValueError:
                    continue
            elif isinstance(value, datetime):
                parsed = value
            else:
                continue
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            max_values.append(parsed.astimezone(timezone.utc))
    if not max_values:
        return None
    return max(max_values).isoformat()


def fetch_incremental_rows_since(
    *,
    source_db_url: str,
    source_table: str,
    last_event_ts: str | None,
    last_sys_key_vals: str | None,
    batch_limit: int | None = None,
) -> list[dict[str, Any]]:
    _assert_safe_identifier(source_table)
    limit_sql = "" if not batch_limit or batch_limit <= 0 else f"LIMIT {int(batch_limit)}"
    query = text(
        f"""
        SELECT process_id, step_seq, step_name, layer_id, descript, sys_key_vals, last_update_date, del_yn, line_id
        FROM {source_table}
        WHERE (
            :last_event_ts IS NULL
            OR last_update_date > :last_event_ts
            OR (last_update_date = :last_event_ts AND COALESCE(sys_key_vals, '') > :last_sys_key_vals)
        )
        ORDER BY last_update_date, sys_key_vals
        {limit_sql}
        """,
    )
    engine = create_engine(source_db_url)
    with engine.begin() as conn:
        rows = conn.execute(
            query,
            {
                "last_event_ts": last_event_ts,
                "last_sys_key_vals": last_sys_key_vals or "",
            },
        ).mappings().all()
    return [dict(row) for row in rows]


def fetch_incremental_rows_between(
    *,
    source_db_url: str,
    source_table: str,
    start_ts: str,
    end_ts: str,
    batch_limit: int | None = None,
) -> list[dict[str, Any]]:
    _assert_safe_identifier(source_table)
    limit_sql = "" if not batch_limit or batch_limit <= 0 else f"LIMIT {int(batch_limit)}"
    query = text(
        f"""
        SELECT process_id, step_seq, step_name, layer_id, descript, sys_key_vals, last_update_date, del_yn, line_id
        FROM {source_table}
        WHERE last_update_date >= :start_ts
          AND last_update_date < :end_ts
        ORDER BY last_update_date, sys_key_vals
        {limit_sql}
        """,
    )
    engine = create_engine(source_db_url)
    with engine.begin() as conn:
        rows = conn.execute(
            query,
            {
                "start_ts": start_ts,
                "end_ts": end_ts,
            },
        ).mappings().all()
    return [dict(row) for row in rows]


def prepare_stage_table(
    *,
    db_url: str,
    stage_table: str,
) -> None:
    _assert_safe_identifier(stage_table)
    create_query = text(
        f"""
        CREATE TABLE IF NOT EXISTS {stage_table} (
            process_id VARCHAR(100) NOT NULL,
            step_seq VARCHAR(50) NOT NULL,
            step_name VARCHAR(200) NULL,
            layer_id VARCHAR(50) NULL,
            descript VARCHAR(500) NULL,
            sys_key_vals VARCHAR(255) NULL,
            last_update_date TIMESTAMP NULL,
            del_yn VARCHAR(1) NULL,
            raw_payload JSON NULL
        )
        """,
    )
    truncate_query = text(f"DELETE FROM {stage_table}")
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(create_query)
        conn.execute(truncate_query)


def insert_stage_rows(
    *,
    db_url: str,
    stage_table: str,
    rows: list[dict[str, Any]],
) -> int:
    _assert_safe_identifier(stage_table)
    if not rows:
        return 0
    insert_query = text(
        f"""
        INSERT INTO {stage_table} (
            process_id, step_seq, step_name, layer_id, descript, sys_key_vals, last_update_date, del_yn, raw_payload
        )
        VALUES (
            :process_id, :step_seq, :step_name, :layer_id, :descript, :sys_key_vals, :last_update_date, :del_yn, :raw_payload
        )
        """,
    )
    params = [
        {
            "process_id": row.get("process_id"),
            "step_seq": row.get("step_seq"),
            "step_name": row.get("step_name"),
            "layer_id": row.get("layer_id"),
            "descript": row.get("descript"),
            "sys_key_vals": row.get("sys_key_vals"),
            "last_update_date": row.get("last_update_date"),
            "del_yn": row.get("del_yn"),
            "raw_payload": "{}",
        }
        for row in rows
    ]
    engine = create_engine(db_url)
    with engine.begin() as conn:
        result = conn.execute(insert_query, params)
    return int(result.rowcount or 0)


def compute_full_stage_metrics(
    *,
    db_url: str,
    stage_table: str,
    line_id: int,
) -> dict[str, int]:
    _assert_safe_identifier(stage_table)
    engine = create_engine(db_url)
    queries = {
        "duplicate_key_count": text(
            f"""
            SELECT COUNT(*) AS cnt
            FROM (
              SELECT process_id, step_seq, COUNT(*) c
              FROM {stage_table}
              GROUP BY process_id, step_seq
              HAVING COUNT(*) > 1
            ) d
            """,
        ),
        "null_key_count": text(
            f"""
            SELECT COUNT(*) AS cnt
            FROM {stage_table}
            WHERE process_id IS NULL OR step_seq IS NULL
            """,
        ),
        "current_rows": text("SELECT COUNT(*) AS cnt FROM step_current WHERE line_id = :line_id"),
        "missing_rows": text(
            f"""
            SELECT COUNT(*) AS cnt
            FROM step_current sc
            WHERE sc.line_id = :line_id
              AND NOT EXISTS (
                SELECT 1
                FROM {stage_table} s
                WHERE s.process_id = sc.process_id
                  AND s.step_seq = sc.step_seq
              )
            """,
        ),
    }
    with engine.begin() as conn:
        duplicate_key_count = int(conn.execute(queries["duplicate_key_count"]).scalar_one() or 0)
        null_key_count = int(conn.execute(queries["null_key_count"]).scalar_one() or 0)
        current_rows = int(conn.execute(queries["current_rows"], {"line_id": line_id}).scalar_one() or 0)
        missing_rows = int(conn.execute(queries["missing_rows"], {"line_id": line_id}).scalar_one() or 0)
    return {
        "duplicate_key_count": duplicate_key_count,
        "null_key_count": null_key_count,
        "current_rows": current_rows,
        "missing_rows": missing_rows,
    }


def append_step_event_audit_rows(
    *,
    db_url: str,
    rows: list[dict[str, Any]],
    dag_run_id: str | None,
) -> int:
    if not rows:
        return 0
    query = text(
        """
        INSERT INTO step_event_audit (
            line_id, process_id, step_seq, del_yn, sys_key_vals, event_ts, source_batch_ts, dag_run_id, raw_payload, ingested_at
        )
        VALUES (
            :line_id, :process_id, :step_seq, :del_yn, :sys_key_vals, :event_ts, :source_batch_ts, :dag_run_id, :raw_payload, :ingested_at
        )
        """,
    )
    now = utc_now()
    params = [
        {
            "line_id": row.get("line_id"),
            "process_id": row.get("process_id"),
            "step_seq": row.get("step_seq"),
            "del_yn": row.get("del_yn"),
            "sys_key_vals": row.get("sys_key_vals"),
            "event_ts": row.get("last_update_date"),
            "source_batch_ts": row.get("source_batch_ts"),
            "dag_run_id": dag_run_id,
            "raw_payload": "{}",
            "ingested_at": now,
        }
        for row in rows
    ]
    engine = create_engine(db_url)
    with engine.begin() as conn:
        result = conn.execute(query, params)
    return int(result.rowcount or 0)


def build_reconciliation_report(
    *,
    db_url: str,
    line_ids: list[int],
    pipeline_name: str = "step_incremental",
) -> dict[str, Any]:
    engine = create_engine(db_url)
    line_summaries: list[dict[str, Any]] = []
    with engine.begin() as conn:
        for line_id in sorted(set(line_ids)):
            current_rows = int(
                conn.execute(
                    text("SELECT COUNT(*) FROM step_current WHERE line_id = :line_id"),
                    {"line_id": line_id},
                ).scalar_one()
                or 0
            )
            latest_status = conn.execute(
                text(
                    """
                    SELECT ls.status, ls.extracted_rows, ls.merged_rows, ls.deleted_rows, ls.updated_at, rl.run_id
                    FROM etl_run_line_status ls
                    JOIN etl_run_log rl ON rl.id = ls.run_log_id
                    WHERE ls.line_id = :line_id
                      AND rl.dag_id = 'full_to_current_hourly'
                    ORDER BY rl.started_at DESC, ls.updated_at DESC
                    LIMIT 1
                    """,
                ),
                {"line_id": line_id},
            ).mappings().first()
            line_summaries.append(
                {
                    "line_id": line_id,
                    "current_rows": current_rows,
                    "latest_status": None if latest_status is None else dict(latest_status),
                }
            )

        watermark = conn.execute(
            text(
                """
                SELECT pipeline_name, last_event_ts, last_sys_key_vals, updated_at
                FROM sync_watermark
                WHERE pipeline_name = :pipeline_name
                LIMIT 1
                """,
            ),
            {"pipeline_name": pipeline_name},
        ).mappings().first()

    return {
        "generated_at": utc_now().isoformat(),
        "line_summaries": line_summaries,
        "watermark": None if watermark is None else dict(watermark),
    }


def compute_service_health_snapshot(
    *,
    db_url: str,
    freshness_sla_minutes: int,
) -> dict[str, Any]:
    engine = create_engine(db_url)
    with engine.begin() as conn:
        latest_full_success = conn.execute(
            text(
                """
                SELECT run_id, finished_at
                FROM etl_run_log
                WHERE dag_id = 'full_to_current_hourly'
                  AND status = 'success'
                  AND finished_at IS NOT NULL
                ORDER BY finished_at DESC
                LIMIT 1
                """,
            )
        ).mappings().first()
        watermark = conn.execute(
            text(
                """
                SELECT pipeline_name, updated_at, last_event_ts, last_sys_key_vals
                FROM sync_watermark
                WHERE pipeline_name = 'step_incremental'
                LIMIT 1
                """,
            )
        ).mappings().first()

    now = utc_now()
    finished_at = latest_full_success["finished_at"] if latest_full_success else None
    if hasattr(finished_at, "tzinfo") and finished_at is not None and finished_at.tzinfo is None:
        finished_at = finished_at.replace(tzinfo=timezone.utc)
    if isinstance(finished_at, str):
        try:
            finished_at = datetime.fromisoformat(finished_at.replace("Z", "+00:00"))
        except ValueError:
            finished_at = None
    freshness_lag_minutes = None
    if finished_at is not None:
        freshness_lag_minutes = int((now - finished_at).total_seconds() // 60)
    is_fresh = freshness_lag_minutes is not None and freshness_lag_minutes <= freshness_sla_minutes

    return {
        "checked_at": now.isoformat(),
        "freshness_sla_minutes": freshness_sla_minutes,
        "latest_full_success": None if latest_full_success is None else dict(latest_full_success),
        "watermark": None if watermark is None else dict(watermark),
        "freshness_lag_minutes": freshness_lag_minutes,
        "is_fresh": is_fresh,
        "has_watermark": watermark is not None,
    }
