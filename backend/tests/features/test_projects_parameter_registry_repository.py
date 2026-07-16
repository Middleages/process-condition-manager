"""Repository seams for captured parameter registry queries."""

import os
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 -- register every model for create_all
from app.core.db import Base
from app.domain.parameters.types import ValueType
from app.features.projects.repository import ProjectRepository
from app.models.parameter import Parameter, ParameterCategory
from tests.postgres_database import temporary_postgres_database

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")


@pytest.fixture
async def sqlite_engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
        await engine.dispose()


@pytest.fixture
def sqlite_factory(sqlite_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(sqlite_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture
async def pg_engine() -> AsyncIterator[AsyncEngine]:
    assert _PG_URL is not None
    with temporary_postgres_database() as database:
        engine = create_async_engine(database.async_url)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        try:
            yield engine
        finally:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.drop_all)
            await engine.dispose()


@pytest.fixture
def pg_factory(pg_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)


async def _seed_parameter_registry(session: AsyncSession) -> None:
    photo = ParameterCategory(code="photo", display_name="Photo", sort_order=1)
    session.add_all(
        [
            Parameter(
                code="alpha",
                display_name="Alpha",
                value_type=ValueType.TEXT,
                sort_order=1,
                category=None,
                is_active=True,
            ),
            Parameter(
                code="beta",
                display_name="Beta",
                value_type=ValueType.NUMBER,
                sort_order=1,
                category=photo,
                is_active=True,
            ),
            Parameter(
                code="gamma",
                display_name="Gamma",
                value_type=ValueType.TEXT,
                sort_order=2,
                category=photo,
                is_active=True,
            ),
            Parameter(
                code="legacy_speed",
                display_name="Legacy speed",
                value_type=ValueType.TEXT,
                sort_order=1,
                category=photo,
                is_active=False,
            ),
        ]
    )
    await session.commit()


async def _seed_active_only_registry(session: AsyncSession) -> None:
    photo = ParameterCategory(code="photo", display_name="Photo", sort_order=1)
    session.add_all(
        [
            Parameter(
                code="alpha",
                display_name="Alpha",
                value_type=ValueType.TEXT,
                sort_order=1,
                category=None,
                is_active=True,
            ),
            Parameter(
                code="beta",
                display_name="Beta",
                value_type=ValueType.NUMBER,
                sort_order=1,
                category=photo,
                is_active=True,
            ),
            Parameter(
                code="gamma",
                display_name="Gamma",
                value_type=ValueType.TEXT,
                sort_order=2,
                category=photo,
                is_active=True,
            ),
        ]
    )
    await session.commit()


async def test_capture_parameter_registry_sqlite_active_rows_order_and_categories(
    sqlite_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with sqlite_factory() as session:
        await _seed_active_only_registry(session)
        captured = await ProjectRepository(session).capture_parameter_registry()

    assert [parameter.parameter_code for parameter in captured.parameters] == [
        "alpha",
        "beta",
        "gamma",
    ]
    assert [parameter.sort_order for parameter in captured.parameters] == [1, 1, 2]
    assert [parameter.category_code for parameter in captured.parameters] == [
        None,
        "photo",
        "photo",
    ]
    assert [parameter.active_at_capture for parameter in captured.parameters] == [
        True,
        True,
        True,
    ]
    assert captured.unresolved_codes == ()


async def test_capture_parameter_registry_sqlite_inactive_rows_and_unknown_codes(
    sqlite_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with sqlite_factory() as session:
        await _seed_parameter_registry(session)
        captured = await ProjectRepository(session).capture_parameter_registry(
            {"legacy_speed", "missing"}
        )

    assert [parameter.parameter_code for parameter in captured.parameters] == [
        "alpha",
        "beta",
        "legacy_speed",
        "gamma",
    ]
    assert [parameter.category_code for parameter in captured.parameters] == [
        None,
        "photo",
        "photo",
        "photo",
    ]
    assert [parameter.active_at_capture for parameter in captured.parameters] == [
        True,
        True,
        False,
        True,
    ]
    assert captured.unresolved_codes == ("missing",)


async def test_capture_parameter_registry_sqlite_does_not_lazy_load_after_return(
    sqlite_factory: async_sessionmaker[AsyncSession],
    sqlite_engine: AsyncEngine,
) -> None:
    statements: list[str] = []

    def capture_sql(
        _conn: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(sqlite_engine.sync_engine, "before_cursor_execute", capture_sql)
    try:
        async with sqlite_factory() as session:
            await _seed_parameter_registry(session)
            captured = await ProjectRepository(session).capture_parameter_registry(
                {"legacy_speed"}
            )

        statements.clear()
        assert [
            (parameter.parameter_code, parameter.category_code, parameter.value_type)
            for parameter in captured.parameters
        ] == [
            ("alpha", None, ValueType.TEXT),
            ("beta", "photo", ValueType.NUMBER),
            ("legacy_speed", "photo", ValueType.TEXT),
            ("gamma", "photo", ValueType.TEXT),
        ]
        assert captured.unresolved_codes == ()
        assert statements == []
    finally:
        event.remove(sqlite_engine.sync_engine, "before_cursor_execute", capture_sql)


@pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")
async def test_capture_parameter_registry_postgres_matches_sqlite_semantics(
    pg_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with pg_factory() as session:
        await _seed_parameter_registry(session)
        captured = await ProjectRepository(session).capture_parameter_registry(
            {"legacy_speed", "missing"}
        )

    assert [parameter.parameter_code for parameter in captured.parameters] == [
        "alpha",
        "beta",
        "legacy_speed",
        "gamma",
    ]
    assert [parameter.category_code for parameter in captured.parameters] == [
        None,
        "photo",
        "photo",
        "photo",
    ]
    assert captured.unresolved_codes == ("missing",)
