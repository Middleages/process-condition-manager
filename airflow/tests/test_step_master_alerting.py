from __future__ import annotations

from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1] / "dags"))

from step_master_alerting import build_alert_event, emit_alert_event


def test_build_alert_event_shape() -> None:
    event = build_alert_event(
        dag_id="full_to_current_hourly",
        event_type="run_failed_lines",
        severity="warning",
        message="failed lines detected",
        payload={"failed_lines": 2},
    )
    assert event["dag_id"] == "full_to_current_hourly"
    assert event["event_type"] == "run_failed_lines"
    assert event["severity"] == "warning"
    assert event["payload"]["failed_lines"] == 2
    assert event["ts"]


def test_emit_alert_event_without_webhook_is_noop() -> None:
    event = build_alert_event(
        dag_id="incremental_audit_daily",
        event_type="incremental_dq_violation",
        severity="warning",
        message="dq issue",
    )
    assert emit_alert_event(event=event, webhook_url=None) is False
