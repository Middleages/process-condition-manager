"""Step Master incremental -> step_event_audit daily DAG scaffold."""

from __future__ import annotations

from datetime import datetime, timedelta
import logging

from airflow.decorators import dag, task
from airflow.operators.python import get_current_context
from airflow.models import Variable

from step_master_alerting import build_alert_event, emit_alert_event
from step_master_guardrails import collect_candidate_cursor, evaluate_incremental_dq, is_strictly_newer_cursor
from step_master_store import (
    append_step_event_audit_rows,
    ensure_run_log,
    finalize_run_log,
    fetch_incremental_rows_between,
    fetch_incremental_rows_since,
    load_watermark,
    save_watermark,
)

logger = logging.getLogger(__name__)


@dag(
    dag_id="incremental_audit_daily",
    start_date=datetime(2026, 3, 31),
    schedule="@daily",
    catchup=False,
    max_active_runs=1,
    default_args={
        "retries": 2,
        "retry_delay": timedelta(minutes=10),
        "pool": "default_pool",
    },
    tags=["step-master", "incremental-audit"],
)
def incremental_audit_daily():
    @task
    def init_run_log() -> int | None:
        db_url = Variable.get("STEP_SERVICE_DB_URL", default_var="")
        if not db_url:
            return None
        context = get_current_context()
        dag_run = context["dag_run"]
        return ensure_run_log(
            db_url=db_url,
            dag_id=context["dag"].dag_id,
            run_id=dag_run.run_id,
            airflow_dag_run_id=dag_run.run_id,
            status="running",
        )

    @task
    def read_incremental_since_watermark() -> dict:
        db_url = Variable.get("STEP_SERVICE_DB_URL", default_var="")
        watermark = {"last_event_ts": None, "last_sys_key_vals": None}
        if db_url:
            loaded = load_watermark(db_url=db_url, pipeline_name="step_incremental")
            last_event_ts = loaded.get("last_event_ts")
            watermark = {
                "last_event_ts": last_event_ts.isoformat() if hasattr(last_event_ts, "isoformat") else last_event_ts,
                "last_sys_key_vals": loaded.get("last_sys_key_vals"),
            }
        source_db_url = Variable.get("STEP_INCREMENTAL_SOURCE_DB_URL", default_var="")
        source_table = Variable.get("STEP_INCREMENTAL_SOURCE_TABLE", default_var="step_incremental_history")
        batch_limit = int(Variable.get("STEP_INCREMENTAL_BATCH_LIMIT", default_var="50000"))
        backfill_mode = Variable.get("STEP_INCREMENTAL_BACKFILL_MODE", default_var="false").lower() == "true"
        backfill_start = Variable.get("STEP_INCREMENTAL_BACKFILL_START", default_var="")
        backfill_end = Variable.get("STEP_INCREMENTAL_BACKFILL_END", default_var="")
        if backfill_mode and (not backfill_start or not backfill_end):
            raise ValueError("Backfill mode requires STEP_INCREMENTAL_BACKFILL_START/END")

        filtered_rows = []
        if source_db_url:
            filtered_rows = (
                fetch_incremental_rows_between(
                    source_db_url=source_db_url,
                    source_table=source_table,
                    start_ts=backfill_start,
                    end_ts=backfill_end,
                    batch_limit=batch_limit,
                )
                if backfill_mode
                else fetch_incremental_rows_since(
                    source_db_url=source_db_url,
                    source_table=source_table,
                    last_event_ts=watermark["last_event_ts"],
                    last_sys_key_vals=watermark["last_sys_key_vals"],
                    batch_limit=batch_limit,
                )
            )

        return {
            "rows": filtered_rows,
            "backfill_mode": backfill_mode,
            "backfill_start": backfill_start or None,
            "backfill_end": backfill_end or None,
            "last_event_ts": watermark["last_event_ts"],
            "last_sys_key_vals": watermark["last_sys_key_vals"],
            "candidate_event_ts": None,
            "candidate_sys_key_vals": None,
        }

    @task
    def append_step_event_audit(payload: dict) -> dict:
        rows = payload.get("rows", [])
        db_url = Variable.get("STEP_SERVICE_DB_URL", default_var="")
        if db_url:
            context = get_current_context()
            inserted_rows = append_step_event_audit_rows(
                db_url=db_url,
                rows=rows,
                dag_run_id=context["dag_run"].run_id,
            )
        else:
            inserted_rows = len(rows)
        return {"inserted_rows": inserted_rows, **payload}

    @task
    def run_incremental_dq_checks(payload: dict) -> dict:
        rows = payload.get("rows", [])
        dq_result = evaluate_incremental_dq(rows)
        payload.update(dq_result)
        payload["dq_violation_count"] = dq_result["null_key_count"] + dq_result["invalid_del_yn_count"]
        null_key_fail_threshold = int(Variable.get("STEP_INCREMENTAL_DQ_NULL_KEY_FAIL_THRESHOLD", default_var="1"))
        invalid_del_yn_fail_threshold = int(Variable.get("STEP_INCREMENTAL_DQ_INVALID_DEL_YN_FAIL_THRESHOLD", default_var="1"))
        payload["dq_failed"] = (
            dq_result["null_key_count"] >= null_key_fail_threshold
            or dq_result["invalid_del_yn_count"] >= invalid_del_yn_fail_threshold
        )
        if payload.get("candidate_event_ts") is None or payload.get("candidate_sys_key_vals") is None:
            candidate_event_ts, candidate_sys_key_vals = collect_candidate_cursor(rows)
            payload["candidate_event_ts"] = candidate_event_ts
            payload["candidate_sys_key_vals"] = candidate_sys_key_vals
        return payload

    @task
    def update_watermark(payload: dict) -> dict:
        is_backfill = payload.get("backfill_mode", False)
        can_advance = (
            not is_backfill
            and
            payload.get("inserted_rows", 0) > 0
            and not payload.get("dq_failed", False)
            and is_strictly_newer_cursor(
                payload.get("candidate_event_ts"),
                payload.get("candidate_sys_key_vals"),
                payload.get("last_event_ts"),
                payload.get("last_sys_key_vals"),
            )
        )
        payload["watermark_advanced"] = can_advance
        payload["next_watermark"] = (
            {
                "last_event_ts": payload.get("candidate_event_ts"),
                "last_sys_key_vals": payload.get("candidate_sys_key_vals"),
            }
            if can_advance
            else None
        )
        db_url = Variable.get("STEP_SERVICE_DB_URL", default_var="")
        if can_advance and db_url:
            save_watermark(
                db_url=db_url,
                pipeline_name="step_incremental",
                last_event_ts=payload.get("candidate_event_ts"),
                last_sys_key_vals=payload.get("candidate_sys_key_vals"),
            )
        return payload

    @task
    def publish_metrics(run_log_id: int | None, payload: dict) -> dict:
        metrics = {
            "inserted_rows": payload.get("inserted_rows", 0),
            "dq_violation_count": payload.get("dq_violation_count", 0),
            "duplicate_event_count": payload.get("duplicate_event_count", 0),
            "watermark_advanced": payload.get("watermark_advanced", False),
            "backfill_mode": payload.get("backfill_mode", False),
        }
        webhook_url = Variable.get("STEP_ALERT_WEBHOOK_URL", default_var="")
        if metrics["dq_violation_count"] > 0:
            logger.warning(
                "incremental_audit_daily DQ violations detected: dq_violation_count=%s duplicate_event_count=%s",
                metrics["dq_violation_count"],
                metrics["duplicate_event_count"],
            )
            emit_alert_event(
                event=build_alert_event(
                    dag_id="incremental_audit_daily",
                    event_type="incremental_dq_violation",
                    severity="warning",
                    message="incremental DQ violation detected",
                    payload=metrics,
                ),
                webhook_url=webhook_url,
            )
        if metrics["inserted_rows"] > 0 and not metrics["watermark_advanced"] and not metrics["backfill_mode"]:
            logger.warning(
                "incremental_audit_daily inserted rows but watermark did not advance. inserted_rows=%s",
                metrics["inserted_rows"],
            )
            emit_alert_event(
                event=build_alert_event(
                    dag_id="incremental_audit_daily",
                    event_type="watermark_not_advanced",
                    severity="warning",
                    message="rows inserted but watermark not advanced",
                    payload=metrics,
                ),
                webhook_url=webhook_url,
            )
        db_url = Variable.get("STEP_SERVICE_DB_URL", default_var="")
        if run_log_id and db_url:
            finalize_run_log(
                db_url=db_url,
                run_log_id=run_log_id,
                run_summary={
                    "failed_lines": 0 if not payload.get("dq_failed", False) else 1,
                    "total_extracted_rows": int(metrics["inserted_rows"]),
                    "total_merged_rows": 0,
                    "total_deleted_rows": 0,
                },
                status="success" if not payload.get("dq_failed", False) else "failed",
                error_summary=None if not payload.get("dq_failed", False) else "incremental_dq_violation_detected",
            )
        return metrics

    run_log_id = init_run_log()
    extracted = read_incremental_since_watermark()
    run_log_id >> extracted
    appended = append_step_event_audit(extracted)
    checked = run_incremental_dq_checks(appended)
    updated = update_watermark(checked)
    publish_metrics(run_log_id, updated)


incremental_audit_daily()
