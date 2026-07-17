"""Read-only loader for frozen backbone diff inputs."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.db import app_engine
from app.features.backbone_diff.contracts import DiffInput
from app.features.backbone_diff.repository import BackboneDiffRepository

_READ_ONLY_ENGINE: AsyncEngine
if app_engine.dialect.name == "postgresql":
    _READ_ONLY_ENGINE = app_engine.execution_options(
        isolation_level="REPEATABLE READ"
    )
else:
    _READ_ONLY_ENGINE = app_engine
ReadOnlySessionLocal = async_sessionmaker(
    _READ_ONLY_ENGINE,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def load_diff_input(project_id: int) -> DiffInput:
    async with ReadOnlySessionLocal() as session:
        if session.bind is not None and session.bind.dialect.name == "postgresql":
            await session.execute(text("SET TRANSACTION READ ONLY"))
        return await BackboneDiffRepository(session).load(project_id)


async def load_diff_input_with_session_factory(
    project_id: int,
    session_factory: async_sessionmaker[AsyncSession],
) -> DiffInput:
    async with session_factory() as session:
        if session.bind is not None and session.bind.dialect.name == "postgresql":
            await session.execute(text("SET TRANSACTION READ ONLY"))
        return await BackboneDiffRepository(session).load(project_id)
