"""이중 DB 엔진/세션 팩토리.

- app_engine   : 앱 DB (Alembic 소유). 읽기/쓰기.
- ingest_engine: 적재 DB. 읽기 전용 (P2 Ingest Boundary — PCM은 절대 쓰지 않는다).

적재 커넥션은 asyncpg의 `default_transaction_read_only` 서버 설정으로
PostgreSQL 레벨에서 읽기 전용을 강제한다. 적재 테이블 접근은
ingest reader(T4) 밖에서 금지된다.
"""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    """앱 DB 전용 SQLAlchemy 선언적 베이스 (모델은 T3 이후 추가)."""


# 앱 DB: 읽기/쓰기
app_engine = create_async_engine(
    settings.app_database_url,
    future=True,
    pool_pre_ping=True,
)
AppSessionLocal = async_sessionmaker(
    app_engine,
    expire_on_commit=False,
    class_=AsyncSession,
)

# 적재 DB: 읽기 전용 (모든 트랜잭션을 읽기 전용으로 강제)
ingest_engine = create_async_engine(
    settings.ingest_database_url,
    future=True,
    pool_pre_ping=True,
    connect_args={"server_settings": {"default_transaction_read_only": "on"}},
)
IngestSessionLocal = async_sessionmaker(
    ingest_engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_app_session() -> AsyncIterator[AsyncSession]:
    """앱 DB 세션 의존성 (읽기/쓰기)."""
    async with AppSessionLocal() as session:
        yield session


async def get_ingest_session() -> AsyncIterator[AsyncSession]:
    """적재 DB 세션 의존성 (읽기 전용). ingest reader(T4)에서만 사용한다."""
    async with IngestSessionLocal() as session:
        yield session
