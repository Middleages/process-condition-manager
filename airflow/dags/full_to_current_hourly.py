"""Step Master full snapshot -> step_current hourly DAG.

Scope:
- B1 build_line_list (whitelist)
- B2 extract_stage_line (line-level mapped task scaffold)
- B3 validate_line_load (line-level mapped task scaffold)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging

from airflow.decorators import dag, task
from airflow.exceptions import AirflowSkipException
from airflow.operators.python import get_current_context
from airflow.models import Variable

from step_master_alerting import build_alert_event, emit_alert_event
from step_master_guardrails import (
    DEFAULT_DELETE_COUNT_THRESHOLD,
    DEFAULT_DELETE_RATIO_THRESHOLD,
    DEFAULT_READY_MAX_AGE_MINUTES,
    compute_delete_guardrail,
    derive_line_status,
    determine_delete_block_reason,
    is_upstream_ready,
    parse_iso_datetime,
    parse_line_whitelist,
    summarize_line_statuses,
)
from step_master_store import ensure_run_log, finalize_run_log, upsert_line_statuses
from step_master_store import (
    build_full_source_table_name,
    compute_full_stage_metrics,
    delete_missing_step_current_from_stage,
    fetch_full_source_max_last_update,
    fetch_source_rows,
    insert_stage_rows,
    merge_step_current_from_stage,
    prepare_stage_table,
)

logger = logging.getLogger(__name__)


@dag(
    dag_id="full_to_current_hourly",
    start_date=datetime(2026, 3, 31),
    schedule="40 * * * *",
    catchup=False,
    max_active_runs=1,
    default_args={
        "retries": 2,
        "retry_delay": timedelta(minutes=5),
        "pool": "default_pool",
    },
    tags=["step-master", "full-sync"],
)
def full_to_current_hourly():
    @task
    def check_upstream_ready() -> None:
        source_max_raw = None
        source_db_url = Variable.get("STEP_FULL_SOURCE_DB_URL", default_var="")
        raw_lines = Variable.get("STEP_LINE_WHITELIST", default_var="")
        line_ids = parse_line_whitelist(raw_lines) if raw_lines else []
        if source_db_url and line_ids:
            source_max_raw = fetch_full_source_max_last_update(
                source_db_url=source_db_url,
                line_ids=line_ids,
            )
        if source_max_raw is None:
            source_max_raw = Variable.get("STEP_FULL_SOURCE_MAX_LAST_UPDATE_DATE", default_var=None)
        source_max = parse_iso_datetime(source_max_raw)
        max_age_minutes = int(
            Variable.get("STEP_FULL_READY_MAX_AGE_MINUTES", default_var=str(DEFAULT_READY_MAX_AGE_MINUTES)),
        )
        now_utc = datetime.now(timezone.utc)
        if source_max_raw and source_max is None:
            raise AirflowSkipException(
                "Upstream ready check skipped: invalid STEP_FULL_SOURCE_MAX_LAST_UPDATE_DATE format.",
            )
        if not is_upstream_ready(source_max, now_utc, max_age_minutes):
            raise AirflowSkipException(
                "Upstream full load not ready by max(last_update_date). Skipping run.",
            )

    @task
    def build_line_list() -> list[int]:
        raw = Variable.get("STEP_LINE_WHITELIST", default_var="")
        line_ids = parse_line_whitelist(raw)
        if not line_ids:
            raise AirflowSkipException("STEP_LINE_WHITELIST is empty. Skipping run.")
        return line_ids

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
    def extract_stage_line(line_id: int) -> dict:
        source_db_url = Variable.get("STEP_FULL_SOURCE_DB_URL", default_var="")
        service_db_url = Variable.get("STEP_SERVICE_DB_URL", default_var="")
        stage_table = f"step_stage_{line_id}"
        source_rows: list[dict] = []
        if source_db_url:
            source_table = build_full_source_table_name(line_id)
            source_rows = fetch_source_rows(source_db_url=source_db_url, source_table=source_table)
        if service_db_url:
            prepare_stage_table(db_url=service_db_url, stage_table=stage_table)
            inserted = insert_stage_rows(db_url=service_db_url, stage_table=stage_table, rows=source_rows)
            metrics = compute_full_stage_metrics(db_url=service_db_url, stage_table=stage_table, line_id=line_id)
        else:
            inserted = len(source_rows)
            metrics = {
                "duplicate_key_count": 0,
                "null_key_count": 0,
                "current_rows": 0,
                "missing_rows": 0,
            }
        return {
            "line_id": line_id,
            "extracted_rows": inserted,
            "current_rows": metrics["current_rows"],
            "missing_rows": metrics["missing_rows"],
            "duplicate_key_count": metrics["duplicate_key_count"],
            "null_key_count": metrics["null_key_count"],
            "source_max_ts": None if not source_rows else max((r.get("last_update_date") for r in source_rows), default=None),
            "stage_table": stage_table,
        }

    @task
    def validate_line_load(stage_result: dict) -> dict:
        extracted_rows = int(stage_result.get("extracted_rows", 0))
        current_rows = int(stage_result.get("current_rows", 0))
        missing_rows = int(stage_result.get("missing_rows", 0))
        min_stage_rows = int(Variable.get("STEP_MIN_STAGE_ROWS", default_var="1"))
        delete_ratio_threshold = float(
            Variable.get("STEP_DELETE_RATIO_THRESHOLD", default_var=str(DEFAULT_DELETE_RATIO_THRESHOLD)),
        )
        delete_count_threshold = int(
            Variable.get("STEP_DELETE_COUNT_THRESHOLD", default_var=str(DEFAULT_DELETE_COUNT_THRESHOLD)),
        )
        guardrail_allowed, delete_ratio = compute_delete_guardrail(
            current_rows,
            missing_rows,
            delete_ratio_threshold=delete_ratio_threshold,
            delete_count_threshold=delete_count_threshold,
        )
        if extracted_rows < min_stage_rows:
            delete_block_reason = "MIN_STAGE_ROWS_UNDER_THRESHOLD"
        else:
            delete_block_reason = determine_delete_block_reason(extracted_rows, guardrail_allowed)
        return {
            "line_id": stage_result["line_id"],
            "extracted_rows": extracted_rows,
            "current_rows": current_rows,
            "stage_table": stage_result.get("stage_table"),
            "duplicate_key_count": int(stage_result.get("duplicate_key_count", 0)),
            "null_key_count": int(stage_result.get("null_key_count", 0)),
            "delete_ratio": delete_ratio,
            "missing_rows": missing_rows,
            "min_stage_rows": min_stage_rows,
            "is_delete_allowed": extracted_rows >= min_stage_rows and guardrail_allowed,
            "delete_block_reason": delete_block_reason,
        }

    @task
    def persist_line_status(validation_result: dict) -> dict:
        status = derive_line_status(validation_result)
        return {
            "line_id": validation_result["line_id"],
            "status": status,
            "status_reason": validation_result["delete_block_reason"],
            "extracted_rows": validation_result["extracted_rows"],
            "merged_rows": validation_result.get("merged_rows", 0),
            "deleted_rows": validation_result.get("deleted_rows", 0),
            "current_rows": validation_result["current_rows"],
            "missing_rows": validation_result["missing_rows"],
            "min_stage_rows": validation_result["min_stage_rows"],
            "is_delete_allowed": validation_result["is_delete_allowed"],
            "delete_block_reason": validation_result["delete_block_reason"],
            "null_key_count": validation_result["null_key_count"],
            "duplicate_key_count": validation_result["duplicate_key_count"],
        }

    @task
    def merge_current_line(validation_result: dict) -> dict:
        db_url = Variable.get("STEP_SERVICE_DB_URL", default_var="")
        merged_rows = 0
        if db_url and validation_result.get("stage_table"):
            merged_rows = merge_step_current_from_stage(
                db_url=db_url,
                stage_table=validation_result["stage_table"],
                line_id=validation_result["line_id"],
            )
        return {**validation_result, "merged_rows": merged_rows}

    @task
    def delete_missing_line(merge_result: dict) -> dict:
        db_url = Variable.get("STEP_SERVICE_DB_URL", default_var="")
        deleted_rows = 0
        if (
            db_url
            and merge_result.get("stage_table")
            and merge_result.get("is_delete_allowed", False)
        ):
            deleted_rows = delete_missing_step_current_from_stage(
                db_url=db_url,
                stage_table=merge_result["stage_table"],
                line_id=merge_result["line_id"],
            )
        return {**merge_result, "deleted_rows": deleted_rows}

    @task
    def persist_line_statuses_task(run_log_id: int | None, line_statuses: list[dict]) -> list[dict]:
        db_url = Variable.get("STEP_SERVICE_DB_URL", default_var="")
        if run_log_id and db_url:
            upsert_line_statuses(db_url=db_url, run_log_id=run_log_id, line_statuses=line_statuses)
        return line_statuses

    @task
    def finalize_run(run_log_id: int | None, line_statuses: list[dict]) -> dict:
        summary = summarize_line_statuses(line_statuses)
        webhook_url = Variable.get("STEP_ALERT_WEBHOOK_URL", default_var="")
        if summary["failed_lines"] > 0:
            logger.warning(
                "full_to_current_hourly completed with failures: failed_lines=%s total_lines=%s",
                summary["failed_lines"],
                summary["total_lines"],
            )
            emit_alert_event(
                event=build_alert_event(
                    dag_id="full_to_current_hourly",
                    event_type="run_failed_lines",
                    severity="warning",
                    message="failed lines detected",
                    payload=summary,
                ),
                webhook_url=webhook_url,
            )
        if summary["delete_blocked_lines"] > 0:
            logger.warning(
                "full_to_current_hourly delete guardrail blocked lines: delete_blocked_lines=%s",
                summary["delete_blocked_lines"],
            )
            emit_alert_event(
                event=build_alert_event(
                    dag_id="full_to_current_hourly",
                    event_type="delete_guardrail_blocked",
                    severity="warning",
                    message="delete guardrail blocked one or more lines",
                    payload=summary,
                ),
                webhook_url=webhook_url,
            )
        db_url = Variable.get("STEP_SERVICE_DB_URL", default_var="")
        if run_log_id and db_url:
            finalize_run_log(
                db_url=db_url,
                run_log_id=run_log_id,
                run_summary=summary,
                status="success" if summary["failed_lines"] == 0 else "failed",
                error_summary=None if summary["failed_lines"] == 0 else "Some lines failed DQ",
            )
        return summary

    ready = check_upstream_ready()
    run_log_id = init_run_log()
    lines = build_line_list()
    ready >> lines
    run_log_id >> lines
    staged = extract_stage_line.expand(line_id=lines)
    validated = validate_line_load.expand(stage_result=staged)
    merged = merge_current_line.expand(validation_result=validated)
    deleted = delete_missing_line.expand(merge_result=merged)
    line_statuses = persist_line_status.expand(validation_result=deleted)
    persisted_line_statuses = persist_line_statuses_task(run_log_id, line_statuses)
    finalize_run(run_log_id, persisted_line_statuses)


full_to_current_hourly()
