"""T2 골격 검증: 앱 부팅 + 이중 엔진 초기화."""

import pytest
from httpx import AsyncClient

from app.core import maintenance


async def test_health_returns_ok(client: AsyncClient) -> None:
    """GET /health 가 200과 상태를 반환한다."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["app"] == "process-condition-manager"


async def test_phase4_writer_health_reports_pre_unfreeze_when_mutations_disabled(
    client: AsyncClient, monkeypatch
) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    resp = await client.get("/health/phase4-writer")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ok"
    assert body["contract_version"] == 1
    assert body["db_revision"] == "0006"
    assert body["project_mutations_enabled"] is False
    assert body["pre_unfreeze_ready"] is True
    assert body["runtime_state"] == "pre_unfreeze"


async def test_phase4_writer_health_reports_active_when_mutations_enabled(
    client: AsyncClient, monkeypatch
) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", True)

    resp = await client.get("/health/phase4-writer")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["pre_unfreeze_ready"] is False
    assert body["runtime_state"] == "active"


@pytest.mark.parametrize(
    ("mutations_enabled", "expected_pre_unfreeze_ready", "expected_runtime_state"),
    [
        (False, True, "pre_unfreeze"),
        (True, False, "active"),
    ],
)
async def test_phase4_writer_health_accepts_revision_0007(
    client: AsyncClient,
    monkeypatch,
    mutations_enabled: bool,
    expected_pre_unfreeze_ready: bool,
    expected_runtime_state: str,
) -> None:
    async def _compatible_revision() -> str | None:
        return "0007"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", mutations_enabled)

    resp = await client.get("/health/phase4-writer")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ok"
    assert body["contract_version"] == 1
    assert body["db_revision"] == "0007"
    assert body["project_mutations_enabled"] is mutations_enabled
    assert body["pre_unfreeze_ready"] is expected_pre_unfreeze_ready
    assert body["runtime_state"] == expected_runtime_state


async def test_phase4_writer_health_returns_503_on_revision_mismatch(
    client: AsyncClient, monkeypatch
) -> None:
    async def _incompatible_revision() -> str | None:
        return "0005"

    monkeypatch.setattr(maintenance, "read_app_revision", _incompatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    resp = await client.get("/health/phase4-writer")

    assert resp.status_code == 503, resp.text
    body = resp.json()
    assert body["code"] == "phase4_writer_contract_mismatch"
    assert body["details"]["minimum_revision"] == "0006"


def test_dual_engines_initialized() -> None:
    """app_engine / ingest_engine 두 엔진이 별도로 초기화된다."""
    from app.core import db

    assert db.app_engine is not None
    assert db.ingest_engine is not None
    assert db.app_engine is not db.ingest_engine


def test_engines_target_separate_databases() -> None:
    """두 엔진이 서로 다른 DB URL을 향한다 (앱/적재 경계)."""
    from app.core.db import app_engine, ingest_engine

    assert str(app_engine.url) != str(ingest_engine.url)


def test_app_exposes_engines_on_state() -> None:
    """조립된 앱이 state에 두 엔진 참조를 노출한다."""
    from app.main import app

    assert app.state.app_engine is not None
    assert app.state.ingest_engine is not None
