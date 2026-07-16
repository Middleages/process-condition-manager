"""Guarded PostgreSQL fixture for the Phase 4 History performance gate.

This file is intentionally a RED-handoff scaffold for the future repository/service
integration. The first concrete slice here is the deterministic 100k-history
fixture builder plus a focused PostgreSQL smoke test that proves the dataset shape
before timing the planned API surface.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from itertools import cycle
from typing import Final

import pytest
import sqlalchemy as sa
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

import app.models  # noqa: F401 -- register every model on Base.metadata
from app.core.db import Base
from app.domain.parameters.types import ValueType
from app.models.parameter import Parameter
from app.models.project import (
    ChangeEvent,
    ChangeEventType,
    LayerCondition,
    Project,
    SheetLayer,
)
from tests.factories import make_project_profile
from tests.postgres_database import temporary_postgres_database

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")

_LAYER_COUNT: Final[int] = 100
_PARAMETER_COUNT: Final[int] = 200
_EVENT_COUNT: Final[int] = 100_000
_EVENT_BATCH_SIZE: Final[int] = 5_000


@dataclass(frozen=True, slots=True)
class HistoryPerformanceFixture:
    project_id: int
    layer_keys: tuple[str, ...]
    condition_ids: tuple[int, ...]
    parameter_codes: tuple[str, ...]
    event_ids: tuple[int, ...]


def _build_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(database_url, poolclass=NullPool)


async def _prepare_schema(engine: AsyncEngine) -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)


async def _seed_project(session: AsyncSession) -> int:
    project = Project(
        line_id="L1",
        process_id="HISTORY_PERF",
        part_id="P0",
        name="history-perf",
        profile=make_project_profile(process_name="HISTORY_PERF"),
    )
    session.add(project)
    await session.flush()
    return project.id


async def _seed_layers_and_conditions(
    session: AsyncSession, *, project_id: int
) -> tuple[tuple[str, ...], tuple[int, ...]]:
    layer_keys: list[str] = []
    condition_ids: list[int] = []
    project = await session.get(Project, project_id)
    assert project is not None
    for index in range(1, _LAYER_COUNT + 1):
        layer_key = f"L1::HISTORY_PERF::{index:03d}::ACT"
        layer = SheetLayer(
            project_id=project_id,
            layer_key=layer_key,
            step_seq=f"{index:03d}",
            layer_id="ACT",
            sort_order=index,
        )
        layer.conditions.append(
            LayerCondition(
                label="base",
                condition_index=1,
                is_por=True,
            )
        )
        project.layers.append(layer)
        layer_keys.append(layer_key)

    await session.flush()
    for layer in project.layers:
        assert layer.conditions
        condition_ids.append(layer.conditions[0].id)
    return tuple(layer_keys), tuple(condition_ids)


async def _seed_parameters(session: AsyncSession) -> tuple[str, ...]:
    parameters = [
        Parameter(
            code=f"param_{index:03d}",
            display_name=f"Parameter {index:03d}",
            value_type=ValueType.TEXT,
            sort_order=index,
        )
        for index in range(1, _PARAMETER_COUNT + 1)
    ]
    session.add_all(parameters)
    await session.flush()
    return tuple(parameter.code for parameter in parameters)


def _build_events(
    *,
    project_id: int,
    layer_keys: tuple[str, ...],
    condition_ids: tuple[int, ...],
    parameter_codes: tuple[str, ...],
) -> list[dict[str, object]]:
    """Build a deterministic 100k event stream outside the timed section."""

    batches: list[dict[str, object]] = []
    now = datetime(2026, 7, 16, 8, 0, tzinfo=UTC)
    event_id = 0

    def add_event(
        event_type: ChangeEventType,
        *,
        batch_id: str | None,
        actor: str,
        payload: dict[str, object],
        condition_id: int | None = None,
        parameter_code: str | None = None,
        old_value: str | None = None,
        new_value: str | None = None,
    ) -> None:
        nonlocal event_id, now
        event_id += 1
        now = now + timedelta(seconds=1)
        batches.append(
            {
                "id": event_id,
                "project_id": project_id,
                "event_type": event_type,
                "actor": actor,
                "payload": payload,
                "condition_id": condition_id,
                "parameter_code": parameter_code,
                "old_value": old_value,
                "new_value": new_value,
                "created_at": now,
            }
        )

    manual_or_paste = cycle(("manual", "paste"))
    actors = cycle(("dev-admin", "perf-bot", "qa-bot"))

    # 40k cell updates: mixed manual/paste batches across the 20k coordinate grid.
    for batch_index in range(20_000):
        batch_id = uuid.uuid4().hex
        for repeat in range(2):
            condition_id = condition_ids[(batch_index + repeat) % len(condition_ids)]
            parameter_code = parameter_codes[(batch_index * 2 + repeat) % len(parameter_codes)]
            origin = next(manual_or_paste)
            add_event(
                ChangeEventType.CELL_UPDATE,
                batch_id=batch_id,
                actor=next(actors),
                payload={
                    "batch_id": batch_id,
                    "origin": origin,
                    "layer_key": layer_keys[(batch_index + repeat) % len(layer_keys)],
                },
                condition_id=condition_id,
                parameter_code=parameter_code,
                old_value=f"{batch_index % 97}",
                new_value=f"{(batch_index + repeat) % 113}",
            )

    # 20k condition/POR/profile events.
    for index in range(10_000):
        layer_key = layer_keys[index % len(layer_keys)]
        condition_id = condition_ids[index % len(condition_ids)]
        add_event(
            ChangeEventType.CONDITION_ADD,
            batch_id=None,
            actor="operator",
            payload={
                "layer_key": layer_key,
                "condition_id": condition_id,
                "source_condition_id": None,
            },
        )
        add_event(
            ChangeEventType.POR_CHANGE,
            batch_id=None,
            actor="operator",
            payload={
                "layer_key": layer_key,
                "old_por_condition_id": condition_id if index % 2 == 0 else None,
                "new_por_condition_id": condition_id,
            },
        )

    # 20k profile/backbone create events.
    for index in range(10_000):
        batch_id = uuid.uuid4().hex
        add_event(
            ChangeEventType.PROJECT_CREATE,
            batch_id=batch_id,
            actor="system",
            payload={
                "batch_id": batch_id,
                "backbone_project_id": None if index % 3 else 9999,
                "identity": {"line_id": "L1", "process_id": "HISTORY_PERF", "part_id": f"P{index}"},
            },
        )
        add_event(
            ChangeEventType.BACKBONE_COPY,
            batch_id=batch_id,
            actor="system",
            payload={
                "batch_id": batch_id,
                "backbone_project_id": 9999,
                "auto_count": 50,
                "manual_count": 25,
                "unmatched_count": 25,
            },
        )

    # 20k backbone layer replace events.
    for index in range(20_000):
        layer_key = layer_keys[index % len(layer_keys)]
        batch_id = uuid.uuid4().hex
        add_event(
            ChangeEventType.BACKBONE_LAYER_REPLACE,
            batch_id=batch_id,
            actor="system",
            payload={
                "batch_id": batch_id,
                "target_layer_key": layer_key,
                "source_project_id": 9999,
                "source_layer_key": layer_keys[(index + 1) % len(layer_keys)],
            },
        )

    assert len(batches) == _EVENT_COUNT
    return batches


def _timeline_page_statement(
    project_id: int, snapshot_max_event_id: int
) -> sa.sql.Select[tuple[object, ...]]:
    return (
        select(
            ChangeEvent.id,
            ChangeEvent.event_type,
            ChangeEvent.actor,
            ChangeEvent.created_at,
            ChangeEvent.condition_id,
            ChangeEvent.parameter_code,
        )
        .where(
            ChangeEvent.project_id == project_id,
            ChangeEvent.id <= snapshot_max_event_id,
        )
        .order_by(ChangeEvent.id.desc())
        .limit(50)
    )


async def _seed_history_fixture(session: AsyncSession) -> HistoryPerformanceFixture:
    project_id = await _seed_project(session)
    layer_keys, condition_ids = await _seed_layers_and_conditions(
        session, project_id=project_id
    )
    parameter_codes = await _seed_parameters(session)
    event_rows = _build_events(
        project_id=project_id,
        layer_keys=layer_keys,
        condition_ids=condition_ids,
        parameter_codes=parameter_codes,
    )
    for offset in range(0, len(event_rows), _EVENT_BATCH_SIZE):
        await session.execute(insert(ChangeEvent), event_rows[offset : offset + _EVENT_BATCH_SIZE])
    await session.flush()
    return HistoryPerformanceFixture(
        project_id=project_id,
        layer_keys=layer_keys,
        condition_ids=condition_ids,
        parameter_codes=parameter_codes,
        event_ids=tuple(row["id"] for row in event_rows),
    )


async def _scalar_count(session: AsyncSession, statement: sa.sql.Select[tuple[int]]) -> int:
    return int((await session.execute(statement)).scalar_one())


@pytest.mark.asyncio
async def test_history_fixture_builder_seeds_expected_counts() -> None:
    assert _PG_URL is not None
    with temporary_postgres_database() as database:
        engine = await _build_engine(database.async_url)
        try:
            await _prepare_schema(engine)
            factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
            async with factory() as session:
                fixture = await _seed_history_fixture(session)
                await session.commit()

            async with factory() as session:
                assert await session.scalar(
                    select(sa.func.count(Project.id)).where(Project.id == fixture.project_id)
                ) == 1
                assert (
                    await _scalar_count(session, select(sa.func.count(SheetLayer.id)))
                    == _LAYER_COUNT
                )
                assert (
                    await _scalar_count(session, select(sa.func.count(LayerCondition.id)))
                    == _LAYER_COUNT
                )
                assert (
                    await _scalar_count(session, select(sa.func.count(Parameter.id)))
                    == _PARAMETER_COUNT
                )
                assert (
                    await _scalar_count(session, select(sa.func.count(ChangeEvent.id)))
                    == _EVENT_COUNT
                )
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_history_timeline_preview_query_uses_explicit_columns_only() -> None:
    assert _PG_URL is not None
    with temporary_postgres_database() as database:
        engine = _build_engine(database.async_url)
        statements: list[str] = []

        def _capture(
            _connection: object,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: object,
            _executemany: object,
        ) -> None:
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)

        sa.event.listen(engine.sync_engine, "before_cursor_execute", _capture)
        try:
            await _prepare_schema(engine)
            factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
            async with factory() as session:
                fixture = await _seed_history_fixture(session)
                await session.commit()

            async with factory() as session:
                statement = _timeline_page_statement(
                    fixture.project_id,
                    snapshot_max_event_id=max(fixture.event_ids),
                )
                rows = (await session.execute(statement)).all()
        finally:
            sa.event.remove(engine.sync_engine, "before_cursor_execute", _capture)
            await engine.dispose()

    assert rows  # sanity: the seeded history is queryable
    assert len(statements) >= 1
    assert "payload" not in statements[-1].lower()
    assert "change_event.payload" not in statements[-1].lower()
    assert "order by change_event.id desc" in statements[-1].lower()
    assert "limit" in statements[-1].lower()
