"""Step Master reconciliation report DAG.

Produces a lightweight DB-backed reconciliation snapshot for operations.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import logging

from airflow.decorators import dag, task
from airflow.exceptions import AirflowSkipException
from airflow.models import Variable

from step_master_guardrails import parse_line_whitelist
from step_master_store import build_reconciliation_report

logger = logging.getLogger(__name__)


@dag(
    dag_id="step_master_reconciliation_daily",
    start_date=datetime(2026, 4, 3),
    schedule="30 1 * * *",
    catchup=False,
    max_active_runs=1,
    default_args={
        "retries": 1,
        "retry_delay": timedelta(minutes=15),
        "pool": "default_pool",
    },
    tags=["step-master", "reconciliation"],
)
def step_master_reconciliation_daily():
    @task
    def run_reconciliation() -> dict:
        db_url = Variable.get("STEP_SERVICE_DB_URL", default_var="")
        raw_line_ids = Variable.get("STEP_LINE_WHITELIST", default_var="")
        line_ids = parse_line_whitelist(raw_line_ids)
        if not db_url:
            raise AirflowSkipException("STEP_SERVICE_DB_URL is empty. Skipping reconciliation run.")
        if not line_ids:
            raise AirflowSkipException("STEP_LINE_WHITELIST is empty. Skipping reconciliation run.")

        report = build_reconciliation_report(db_url=db_url, line_ids=line_ids)
        logger.info("step_master_reconciliation_report=%s", report)
        return report

    run_reconciliation()


step_master_reconciliation_daily()
