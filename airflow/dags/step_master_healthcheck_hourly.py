"""Step Master service healthcheck DAG.

Checks freshness/watermark health and emits critical alerts when breached.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import logging

from airflow.decorators import dag, task
from airflow.exceptions import AirflowFailException, AirflowSkipException
from airflow.models import Variable

from step_master_alerting import build_alert_event, emit_alert_event
from step_master_store import compute_service_health_snapshot

logger = logging.getLogger(__name__)


@dag(
    dag_id="step_master_healthcheck_hourly",
    start_date=datetime(2026, 4, 5),
    schedule="15 * * * *",
    catchup=False,
    max_active_runs=1,
    default_args={
        "retries": 1,
        "retry_delay": timedelta(minutes=5),
        "pool": "default_pool",
    },
    tags=["step-master", "healthcheck"],
)
def step_master_healthcheck_hourly():
    @task
    def check_service_health() -> dict:
        db_url = Variable.get("STEP_SERVICE_DB_URL", default_var="")
        if not db_url:
            raise AirflowSkipException("STEP_SERVICE_DB_URL is empty. Skipping healthcheck run.")

        freshness_sla_minutes = int(Variable.get("STEP_CURRENT_FRESHNESS_SLA_MINUTES", default_var="120"))
        webhook_url = Variable.get("STEP_ALERT_WEBHOOK_URL", default_var="")
        snapshot = compute_service_health_snapshot(
            db_url=db_url,
            freshness_sla_minutes=freshness_sla_minutes,
        )

        logger.info("step_master_service_health=%s", snapshot)

        if not snapshot["is_fresh"] or not snapshot["has_watermark"]:
            emit_alert_event(
                event=build_alert_event(
                    dag_id="step_master_healthcheck_hourly",
                    event_type="service_health_breach",
                    severity="critical",
                    message="step master service healthcheck failed",
                    payload=snapshot,
                ),
                webhook_url=webhook_url,
            )
            raise AirflowFailException(
                "step_master_service_healthcheck_failed: "
                f"is_fresh={snapshot['is_fresh']} has_watermark={snapshot['has_watermark']}",
            )

        return snapshot

    check_service_health()


step_master_healthcheck_hourly()
