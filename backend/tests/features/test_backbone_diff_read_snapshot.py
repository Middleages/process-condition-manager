"""Backbone diff snapshot loader contracts."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from dataclasses import replace

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 -- register all models for metadata
from app.core.db import Base
from app.core.errors import NotFoundError
from app.domain.backbone.snapshot import (
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
    serialize_backbone_snapshot,
)
from app.domain.parameters.types import ValueType
from app.features.backbone_diff.read_snapshot import load_diff_input_with_session_factory
from app.models.parameter import Parameter, ParameterCategory
from app.models.project import CellValue, LayerCondition, Project, SheetLayer
from tests.factories import make_project_profile
from tests.postgres_database import temporary_postgres_database

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")


def _source_fingerprint(source) -> tuple[object | None, ...]:
    return (
        source.project_id,
        source.sheet_layer_id,
        source.layer_key,
        source.step_seq,
        source.layer_id,
        source.sort_order,
        source.source_project_id,
        source.source_layer_key,
    )



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
            await engine.dispose()


@pytest.fixture

def pg_factory(pg_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)


async def _seed_parameters(session: AsyncSession) -> None:
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
                code="legacy",
                display_name="Legacy",
                value_type=ValueType.TEXT,
                sort_order=2,
                category=photo,
                is_active=False,
            ),
            Parameter(
                code="gamma",
                display_name="Gamma",
                value_type=ValueType.TEXT,
                sort_order=3,
                category=None,
                is_active=True,
            ),
        ]
    )
    await session.commit()


async def _seed_project(session: AsyncSession) -> tuple[Project, SheetLayer]:
    project = Project(
        line_id="L1",
        process_id="PROC_A",
        part_id="PART_A",
        name="Project A",
        profile=make_project_profile(process_name="PROC_A"),
    )
    layer = SheetLayer(
        layer_key="L1::PROC_A::010::ACT",
        step_seq="010",
        layer_id="ACT",
        eqp_type="ACT",
        eqp_type_desc="Active",
        area_name="PHOTO",
        sort_order=1,
        source_project_id=7,
        source_layer_key="L1::PROC_A::010::ACT",
        backbone_snapshot=serialize_backbone_snapshot(
            BackboneSnapshot(
                capture_batch_id="0123456789abcdef0123456789abcdef",
                source=BackboneSnapshotSource(
                    project_id=1,
                    sheet_layer_id=11,
                    layer_key="L1::PROC_A::010::ACT",
                    step_seq="010",
                    layer_id="ACT",
                ),
                columns=(
                    BackboneSnapshotColumn(
                        parameter_code="alpha",
                        value_type=ValueType.TEXT,
                        display_name="Alpha",
                        category_code=None,
                        sort_order=1,
                        active_at_capture=True,
                    ),
                ),
                conditions=(
                    BackboneSnapshotCondition(
                        source_condition_id=101,
                        label="base",
                        condition_index=0,
                        is_por=True,
                        cells=(BackboneSnapshotCell(parameter_code="alpha", value="old"),),
                    ),
                ),
            )
        ),
    )
    layer.conditions.extend(
        [
            LayerCondition(
                label="base",
                condition_index=0,
                is_por=True,
                source_condition_id=101,
            ),
            LayerCondition(
                label="base-dup",
                condition_index=1,
                is_por=False,
                source_condition_id=101,
            ),
            LayerCondition(
                label="orphan",
                condition_index=2,
                is_por=False,
                source_condition_id=None,
            ),
            LayerCondition(
                label="blank",
                condition_index=3,
                is_por=False,
                source_condition_id=303,
            ),
        ]
    )
    layer.conditions[0].cell_values.extend(
        [
            CellValue(parameter_code="alpha", value_text="new"),
            CellValue(parameter_code="legacy", value_text="stored"),
        ]
    )
    layer.conditions[1].cell_values.append(CellValue(parameter_code="alpha", value_text="dup"))
    layer.conditions[2].cell_values.append(CellValue(parameter_code="alpha", value_text="orphan"))
    project.layers.append(layer)
    session.add(project)
    await session.commit()
    return project, layer


async def test_load_diff_input_sqlite_freezes_graph_without_lazy_queries(
    sqlite_factory: async_sessionmaker[AsyncSession], sqlite_engine: AsyncEngine
) -> None:
    async with sqlite_factory() as session:
        await _seed_parameters(session)
        project, layer = await _seed_project(session)

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
        loaded = await load_diff_input_with_session_factory(project.id, sqlite_factory)
    finally:
        event.remove(sqlite_engine.sync_engine, "before_cursor_execute", capture_sql)

    assert loaded.project_id == project.id
    assert loaded.line_id == "L1"
    assert loaded.process_id == "PROC_A"
    assert loaded.part_id == "PART_A"
    assert len(statements) <= 8

    loaded_layer = loaded.layers[0]
    assert loaded_layer.layer_key == layer.layer_key
    assert loaded_layer.current_source.project_id == project.id
    assert loaded_layer.current_source.sheet_layer_id == layer.id
    assert loaded_layer.current_source.layer_key == layer.layer_key
    assert loaded_layer.current_source.step_seq == layer.step_seq
    assert loaded_layer.current_source.layer_id == layer.layer_id
    assert loaded_layer.current_source.sort_order == layer.sort_order
    assert loaded_layer.current_source.source_project_id == layer.source_project_id
    assert loaded_layer.current_source.source_layer_key == layer.source_layer_key
    assert not hasattr(loaded_layer.current_source, "capture_batch_id")
    assert not hasattr(loaded_layer.current_source, "captured_at")
    assert [parameter.code for parameter in loaded_layer.current_parameters] == [
        "alpha",
        "legacy",
        "gamma",
    ]
    assert [parameter.active for parameter in loaded_layer.current_parameters] == [
        True,
        False,
        True,
    ]

    assert loaded_layer.current_conditions[0].source_condition_id == 101
    assert loaded_layer.current_conditions[1].source_condition_id == 101
    assert loaded_layer.current_conditions[2].source_condition_id is None
    assert loaded_layer.current_conditions[3].source_condition_id == 303
    assert loaded_layer.current_conditions[0].cells_by_code()["alpha"] == "new"
    assert loaded_layer.current_conditions[0].cells_by_code()["legacy"] == "stored"
    assert loaded_layer.current_conditions[1].cells_by_code()["alpha"] == "dup"
    assert loaded_layer.current_conditions[2].cells_by_code()["alpha"] == "orphan"
    assert loaded_layer.current_conditions[3].cells == ()

    statements.clear()
    assert loaded_layer.current_conditions[0].cells[0].value == "new"
    assert statements == []

    mutated = replace(
        loaded_layer,
        current_source=replace(loaded_layer.current_source, layer_id="010-ALT"),
    )
    assert _source_fingerprint(loaded_layer.current_source) != _source_fingerprint(
        mutated.current_source
    )


async def test_load_diff_input_missing_project_raises_not_found(
    sqlite_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with sqlite_factory() as session:
        await _seed_parameters(session)

    with pytest.raises(NotFoundError) as excinfo:
        await load_diff_input_with_session_factory(999_999, sqlite_factory)

    assert excinfo.value.code == "not_found"
    assert excinfo.value.details == {"project_id": 999_999}


@pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")
async def test_load_diff_input_postgres_is_repeatable_read_and_read_only(
    pg_factory: async_sessionmaker[AsyncSession],
    pg_engine: AsyncEngine,
) -> None:
    read_only_engine = pg_engine.execution_options(isolation_level="REPEATABLE READ")
    read_only_factory = async_sessionmaker(
        read_only_engine, expire_on_commit=False, class_=AsyncSession
    )
    async with pg_factory() as session:
        await _seed_parameters(session)
        project, layer = await _seed_project(session)

    statements: list[str] = []

    def capture_sql(
        _conn,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(read_only_engine.sync_engine, "before_cursor_execute", capture_sql)
    try:
        loaded = await load_diff_input_with_session_factory(project.id, read_only_factory)
    finally:
        event.remove(read_only_engine.sync_engine, "before_cursor_execute", capture_sql)

    assert statements[0].lstrip().upper().startswith("SET TRANSACTION READ ONLY")
    async with read_only_factory() as session:
        isolation = (await session.execute(text("SHOW transaction_isolation"))).scalar_one()
    assert isolation.upper() == "REPEATABLE READ"
    assert loaded.layers[0].current_source.project_id == project.id
    assert loaded.layers[0].current_source.sheet_layer_id == layer.id
    assert loaded.layers[0].current_source.source_project_id == layer.source_project_id
    assert loaded.layers[0].current_source.source_layer_key == layer.source_layer_key
    assert [parameter.code for parameter in loaded.layers[0].current_parameters] == [
        "alpha",
        "legacy",
        "gamma",
    ]
    assert [parameter.active for parameter in loaded.layers[0].current_parameters] == [
        True,
        False,
        True,
    ]


@pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")
async def test_load_diff_input_postgres_rejects_writes_in_read_only_transaction(
    pg_factory: async_sessionmaker[AsyncSession],
    pg_engine: AsyncEngine,
) -> None:
    read_only_engine = pg_engine.execution_options(isolation_level="REPEATABLE READ")
    read_only_factory = async_sessionmaker(
        read_only_engine, expire_on_commit=False, class_=AsyncSession
    )
    async with pg_factory() as session:
        await _seed_parameters(session)
        project, _ = await _seed_project(session)

    async with read_only_factory() as session:
        await session.execute(text("SET TRANSACTION READ ONLY"))
        session.add(
            Parameter(
                code="omega",
                display_name="Omega",
                value_type=ValueType.TEXT,
                sort_order=4,
                category=None,
                is_active=True,
            )
        )
        with pytest.raises(DBAPIError):
            await session.flush()

    loaded = await load_diff_input_with_session_factory(project.id, read_only_factory)
    assert loaded.project_id == project.id
