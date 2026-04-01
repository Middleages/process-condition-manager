"""Step Master incremental -> step_event_audit daily DAG scaffold."""

from __future__ import annotations

from datetime import datetime

from airflow.decorators import dag, task


@dag(
    dag_id="incremental_audit_daily",
    start_date=datetime(2026, 3, 31),
    schedule="@daily",
    catchup=False,
    tags=["step-master", "incremental-audit"],
)
def incremental_audit_daily():
    @task
    def read_incremental_since_watermark() -> dict:
        # TODO(C1): sync_watermark 조회 + source 증분 조회 구현
        return {"rows": [], "last_event_ts": None, "last_sys_key_vals": None}

    @task
    def append_step_event_audit(payload: dict) -> dict:
        # TODO(C2): step_event_audit append insert 구현
        rows = payload.get("rows", [])
        return {"inserted_rows": len(rows), **payload}

    @task
    def run_incremental_dq_checks(payload: dict) -> dict:
        # TODO(C3): null/duplicate/domain 체크 구현
        payload["dq_violation_count"] = 0
        return payload

    @task
    def update_watermark(payload: dict) -> dict:
        # TODO(C4): append + DQ 성공 시에만 워터마크 업데이트 구현
        return payload

    @task
    def publish_metrics(payload: dict) -> None:
        # TODO(C5): metric emit 구현
        _ = payload

    extracted = read_incremental_since_watermark()
    appended = append_step_event_audit(extracted)
    checked = run_incremental_dq_checks(appended)
    updated = update_watermark(checked)
    publish_metrics(updated)


incremental_audit_daily()
