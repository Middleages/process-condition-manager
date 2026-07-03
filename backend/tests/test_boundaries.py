"""T2에서 이미 구현된 경계(seam) 검증: 예외 매핑, 인증 경계, 설정, 모델 메타데이터."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.auth import Role, UserContext, get_current_user
from app.core.config import Settings
from app.core.errors import (
    AppError,
    ConflictError,
    DomainValidationError,
    NotFoundError,
    register_exception_handlers,
)


def test_app_database_url_sync_swaps_driver() -> None:
    """동기 URL 프로퍼티가 asyncpg 드라이버를 psycopg2로 치환한다."""
    s = Settings(app_database_url="postgresql+asyncpg://u:p@h:5432/db")
    assert s.app_database_url_sync == "postgresql+psycopg2://u:p@h:5432/db"


def test_models_expose_base_metadata() -> None:
    """models 패키지가 Base metadata를 노출한다 (Alembic autogenerate용)."""
    from app.models import Base

    assert Base.metadata is not None


async def test_get_current_user_is_not_yet_implemented() -> None:
    """인증 어댑터는 경계만 있고 구현은 T5로 미룬다."""
    with pytest.raises(NotImplementedError):
        await get_current_user()


def test_user_context_carries_roles() -> None:
    """UserContext가 역할 튜플을 보관한다."""
    ctx = UserContext(id="u1", roles=(Role.ADMIN,))
    assert ctx.id == "u1"
    assert Role.ADMIN in ctx.roles


@pytest.mark.parametrize(
    ("exc", "status", "code"),
    [
        (AppError("boom"), 500, "internal_error"),
        (NotFoundError("no"), 404, "not_found"),
        (ConflictError("locked"), 409, "conflict"),
        (DomainValidationError("bad"), 422, "validation_error"),
    ],
)
async def test_app_error_maps_to_http(exc: AppError, status: int, code: str) -> None:
    """AppError 계열이 표준 JSON 오류 응답으로 매핑된다."""
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/boom")
    async def _boom() -> None:
        raise exc

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/boom")

    assert resp.status_code == status
    body = resp.json()
    assert body["code"] == code
    assert body["message"] == str(exc)
