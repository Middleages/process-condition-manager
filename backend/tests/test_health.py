"""T2 골격 검증: 앱 부팅 + 이중 엔진 초기화."""

from httpx import AsyncClient


async def test_health_returns_ok(client: AsyncClient) -> None:
    """GET /health 가 200과 상태를 반환한다."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["app"] == "process-condition-manager"


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
