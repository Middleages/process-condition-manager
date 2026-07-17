"""Read-only loader for frozen backbone diff inputs."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.db import app_engine
from app.features.backbone_diff.contracts import BackboneDiffProjectInput
from app.features.backbone_diff.repository import BackboneDiffRepository


def build_read_only_sessionmaker(
    engine: AsyncEngine,
) -> async_sessionmaker[AsyncSession]:
    """Create a repeatable-read sessionmaker that shares the engine pool."""

    read_only_engine = (
        engine.execution_options(isolation_level="REPEATABLE READ")
        if engine.dialect.name == "postgresql"
        else engine
    )
    return async_sessionmaker(
        read_only_engine,
        expire_on_commit=False,
        class_=AsyncSession,
    )


ReadOnlySessionLocal = build_read_only_sessionmaker(app_engine)


async def load_diff_input(project_id: int) -> BackboneDiffProjectInput:
    async with ReadOnlySessionLocal() as session:
        if session.bind is not None and session.bind.dialect.name == "postgresql":
            await session.execute(text("SET TRANSACTION READ ONLY"))
        return await BackboneDiffRepository(session).load(project_id)


async def load_diff_input_with_session_factory(
    project_id: int,
    session_factory: async_sessionmaker[AsyncSession],
) -> BackboneDiffProjectInput:
    async with session_factory() as session:
        if session.bind is not None and session.bind.dialect.name == "postgresql":
            await session.execute(text("SET TRANSACTION READ ONLY"))
        return await BackboneDiffRepository(session).load(project_id)
