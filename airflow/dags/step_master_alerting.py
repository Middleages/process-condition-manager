"""Lightweight alert emitter for Step Master DAGs.

Fail-safe by design: alert emission must never fail DAG tasks.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from typing import Any
from urllib import request

logger = logging.getLogger(__name__)


def build_alert_event(
    *,
    dag_id: str,
    event_type: str,
    severity: str,
    message: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "dag_id": dag_id,
        "event_type": event_type,
        "severity": severity,
        "message": message,
        "payload": payload or {},
    }


def emit_alert_event(
    *,
    event: dict[str, Any],
    webhook_url: str | None,
    timeout_seconds: int = 3,
) -> bool:
    if not webhook_url:
        logger.info("alert_event(no-webhook)=%s", event)
        return False
    try:
        req = request.Request(
            webhook_url,
            method="POST",
            data=json.dumps(event).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with request.urlopen(req, timeout=timeout_seconds) as resp:
            ok = 200 <= resp.status < 300
            if not ok:
                logger.warning("alert webhook non-2xx status=%s event=%s", resp.status, event)
            return ok
    except Exception as exc:  # noqa: BLE001 - fail-safe alert path
        logger.warning("alert webhook failed: %s event=%s", exc, event)
        return False
