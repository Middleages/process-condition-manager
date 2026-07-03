"""pytest 공통 픽스처.

- client: DB 무의존 라이브니스/조립 검증용 클라이언트
- db_client: SQLite 인메모리 앱 DB로 get_app_session을 오버라이드한 클라이언트
  (레지스트리 CRUD API 테스트용). JSONB 등 PG 전용 기능은 T3 레지스트리에
  없으므로 SQLite로 고충실도 검증이 가능하다.
"""

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — 모든 모델을 metadata에 등록 (create_all 대상)
from app.core.db import Base, get_app_session
from app.main import app


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """앱을 ASGI 트랜스포트로 감싼 비동기 테스트 클라이언트."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def db_client() -> AsyncIterator[AsyncClient]:
    """SQLite 인메모리 앱 DB로 배선된 테스트 클라이언트."""
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = async_sessionmaker(
        engine, expire_on_commit=False, class_=AsyncSession
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def _override_get_app_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_app_session] = _override_get_app_session
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_app_session, None)
        await engine.dispose()
