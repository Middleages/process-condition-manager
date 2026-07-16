"""Guarded PostgreSQL fixture for the Phase 4 History performance gate."""

from __future__ import annotations

import json
import os
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
    CellValue,
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
_CELL_VALUE_COUNT: Final[int] = _LAYER_COUNT * _PARAMETER_COUNT
_EVENT_COUNT: Final[int] = 100_000
_EVENT_BATCH_SIZE: Final[int] = 5_000
_HISTORY_INDEX_DDLS: Final[tuple[str, ...]] = (
    (
        "CREATE INDEX IF NOT EXISTS ix_change_event_project_id_id_desc "
        "ON change_event (project_id, id DESC)"
    ),
    (
        "CREATE INDEX IF NOT EXISTS ix_change_event_project_type_id_desc "
        "ON change_event (project_id, event_type, id DESC)"
    ),
    (
        "CREATE INDEX IF NOT EXISTS ix_change_event_project_cell_id_desc "
        "ON change_event (project_id, condition_id, parameter_code, id DESC) "
        "WHERE condition_id IS NOT NULL AND parameter_code IS NOT NULL"
    ),
    (
        "CREATE INDEX IF NOT EXISTS ix_change_event_project_condition_id_desc "
        "ON change_event (project_id, condition_id, id DESC) "
        "WHERE condition_id IS NOT NULL"
    ),
    (
        "CREATE INDEX IF NOT EXISTS ix_change_event_project_layer_id_desc "
        "ON change_event (project_id, layer_key, id DESC) "
        "WHERE layer_key IS NOT NULL"
    ),
    (
        "CREATE INDEX IF NOT EXISTS ix_change_event_project_actor_id_desc "
        "ON change_event (project_id, actor, id DESC)"
    ),
    (
        "CREATE INDEX IF NOT EXISTS ix_change_event_project_origin_id_desc "
        "ON change_event (project_id, origin, id DESC) "
        "WHERE origin IS NOT NULL"
    ),
    (
        "CREATE INDEX IF NOT EXISTS ix_change_event_project_source_id_desc "
        "ON change_event (project_id, source_project_id, id DESC) "
        "WHERE source_project_id IS NOT NULL"
    ),
    (
        "CREATE INDEX IF NOT EXISTS ix_change_event_project_created_id_desc "
        "ON change_event (project_id, created_at DESC, id DESC)"
    ),
    (
        "CREATE INDEX IF NOT EXISTS ix_change_event_project_batch_id_desc "
        "ON change_event (project_id, batch_id, id DESC) "
        "WHERE batch_id IS NOT NULL"
    ),
)


@dataclass(frozen=True, slots=True)
class HistoryPerformanceFixture:
    project_id: int
    layer_keys: tuple[str, ...]
    condition_ids: tuple[int, ...]
    parameter_codes: tuple[str, ...]
    cell_value_count: int
    event_ids: tuple[int, ...]
    max_created_at: datetime


def _build_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(database_url, poolclass=NullPool)


async def _prepare_schema(engine: AsyncEngine) -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)


async def _prepare_history_indexes(engine: AsyncEngine) -> None:
    async with engine.begin() as connection:
        for ddl in _HISTORY_INDEX_DDLS:
            await connection.execute(sa.text(ddl))


async def _analyze_database(engine: AsyncEngine) -> None:
    async with engine.begin() as connection:
        await connection.execute(sa.text("ANALYZE"))


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
    layers: list[SheetLayer] = []
    for index in range(1, _LAYER_COUNT + 1):
        layer_key = f"L1::HISTORY_PERF::{index:03d}::ACT"
        layers.append(
            SheetLayer(
                project_id=project_id,
                layer_key=layer_key,
                step_seq=f"{index:03d}",
                layer_id="ACT",
                sort_order=index,
            )
        )
        layer_keys.append(layer_key)

    session.add_all(layers)
    await session.flush()

    conditions = [
        LayerCondition(
            layer_id=layer.id,
            label="base",
            condition_index=1,
            is_por=True,
        )
        for layer in layers
    ]
    session.add_all(conditions)
    await session.flush()

    return tuple(layer_keys), tuple(condition.id for condition in conditions)


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


async def _seed_cell_values(
    session: AsyncSession,
    *,
    condition_ids: tuple[int, ...],
    parameter_codes: tuple[str, ...],
) -> int:
    rows: list[dict[str, object]] = []
    for layer_index, condition_id in enumerate(condition_ids):
        for parameter_index, parameter_code in enumerate(parameter_codes):
            rows.append(
                {
                    "condition_id": condition_id,
                    "parameter_code": parameter_code,
                    "value_text": f"v-{layer_index:03d}-{parameter_index:03d}",
                }
            )
    for offset in range(0, len(rows), _EVENT_BATCH_SIZE):
        await session.execute(insert(CellValue), rows[offset : offset + _EVENT_BATCH_SIZE])
    await session.flush()
    return len(rows)


def _build_events(
    *,
    project_id: int,
    layer_keys: tuple[str, ...],
    condition_ids: tuple[int, ...],
    parameter_codes: tuple[str, ...],
) -> tuple[list[dict[str, object]], datetime]:
    """Build a deterministic 100k event stream outside the timed section."""

    rows: list[dict[str, object]] = []
    created_at = datetime(2026, 7, 16, 8, 0, tzinfo=UTC)
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
        layer_key: str | None = None,
        origin: str | None = None,
        source_project_id: int | None = None,
        source_layer_key: str | None = None,
    ) -> None:
        nonlocal event_id, created_at
        event_id += 1
        created_at = created_at + timedelta(seconds=1)
        rows.append(
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
                "layer_key": layer_key,
                "batch_id": batch_id,
                "origin": origin,
                "source_project_id": source_project_id,
                "source_layer_key": source_layer_key,
                "created_at": created_at,
            }
        )

    manual_or_paste = cycle(("manual", "paste"))
    actors = cycle(("dev-admin", "perf-bot", "qa-bot"))

    # 30k cell updates: deterministic batches with manual/paste origins.
    for batch_index in range(15_000):
        batch_id = f"cell-batch-{batch_index:05d}"
        for repeat in range(2):
            coordinate_index = batch_index * 2 + repeat
            layer_index = coordinate_index % len(layer_keys)
            parameter_index = coordinate_index % len(parameter_codes)
            origin = next(manual_or_paste)
            add_event(
                ChangeEventType.CELL_UPDATE,
                batch_id=batch_id,
                actor=next(actors),
                payload={"batch_id": batch_id, "origin": origin},
                condition_id=condition_ids[layer_index],
                parameter_code=parameter_codes[parameter_index],
                old_value=f"{coordinate_index % 97}",
                new_value=f"{(coordinate_index + repeat) % 113}",
                layer_key=layer_keys[layer_index],
                origin=origin,
            )

    # 10k condition additions, removals, and POR changes.
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
                "detail": {"event": "condition_add"},
            },
            condition_id=condition_id,
            layer_key=layer_key,
        )
        add_event(
            ChangeEventType.CONDITION_REMOVE,
            batch_id=None,
            actor="operator",
            payload={
                "layer_key": layer_key,
                "condition_id": condition_id,
                "removed_condition_snapshot": {"label": "base", "is_por": True},
            },
            condition_id=condition_id,
            layer_key=layer_key,
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
            condition_id=condition_id,
            layer_key=layer_key,
        )

    # 10k project create/profile update rows.
    for index in range(10_000):
        batch_id = f"project-batch-{index:05d}"
        add_event(
            ChangeEventType.PROJECT_CREATE,
            batch_id=batch_id,
            actor="system",
            payload={
                "batch_id": batch_id,
                "capture": {
                    "line_id": "L1",
                    "process_id": "HISTORY_PERF",
                    "part_id": f"P{index:04d}",
                },
                "detail": {"event": "project_create", "version": 1},
            },
            source_project_id=9999 if index % 3 == 0 else None,
        )
        add_event(
            ChangeEventType.PROJECT_PROFILE_UPDATE,
            batch_id=batch_id,
            actor="system",
            payload={
                "batch_id": batch_id,
                "capture": {
                    "process_name": "HISTORY_PERF",
                    "device_type_code": "DUT-A",
                },
                "detail": {"event": "project_profile_update", "version": 2},
            },
        )

    # 10k v1 count-only backbone copy rows and 10k v2 capture+detail layer replace rows.
    for index in range(10_000):
        batch_id = f"backbone-batch-{index:05d}"
        target_layer_key = layer_keys[index % len(layer_keys)]
        source_layer_key = layer_keys[(index + 1) % len(layer_keys)]
        add_event(
            ChangeEventType.BACKBONE_COPY,
            batch_id=batch_id,
            actor="system",
            payload={"count": 200, "version": 1},
            source_project_id=9999,
        )
        add_event(
            ChangeEventType.BACKBONE_LAYER_REPLACE,
            batch_id=batch_id,
            actor="system",
            payload={
                "capture": {
                    "source_project_id": 9999,
                    "source_layer_key": source_layer_key,
                    "target_layer_key": target_layer_key,
                },
                "detail": {
                    "version": 2,
                    "source_layer_key": source_layer_key,
                    "target_layer_key": target_layer_key,
                },
            },
            layer_key=target_layer_key,
            source_project_id=9999,
            source_layer_key=source_layer_key,
        )

    assert len(rows) == _EVENT_COUNT
    return rows, created_at


async def _seed_history_fixture(session: AsyncSession) -> HistoryPerformanceFixture:
    project_id = await _seed_project(session)
    layer_keys, condition_ids = await _seed_layers_and_conditions(session, project_id=project_id)
    parameter_codes = await _seed_parameters(session)
    cell_value_count = await _seed_cell_values(
        session,
        condition_ids=condition_ids,
        parameter_codes=parameter_codes,
    )
    event_rows, max_created_at = _build_events(
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
        cell_value_count=cell_value_count,
        event_ids=tuple(row["id"] for row in event_rows),
        max_created_at=max_created_at,
    )


async def _scalar_count(session: AsyncSession, statement: sa.sql.Select[tuple[int]]) -> int:
    return int((await session.execute(statement)).scalar_one())


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


def _timeline_event_type_statement(
    project_id: int, snapshot_max_event_id: int, event_type: ChangeEventType
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
            ChangeEvent.event_type == event_type,
            ChangeEvent.id <= snapshot_max_event_id,
        )
        .order_by(ChangeEvent.id.desc())
        .limit(50)
    )


def _timeline_cell_statement(
    project_id: int,
    snapshot_max_event_id: int,
    *,
    condition_id: int,
    parameter_code: str,
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
            ChangeEvent.condition_id == condition_id,
            ChangeEvent.parameter_code == parameter_code,
            ChangeEvent.id <= snapshot_max_event_id,
        )
        .order_by(ChangeEvent.id.desc())
        .limit(50)
    )


def _timeline_layer_statement(
    project_id: int, snapshot_max_event_id: int, *, layer_key: str
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
            ChangeEvent.layer_key == layer_key,
            ChangeEvent.id <= snapshot_max_event_id,
        )
        .order_by(ChangeEvent.id.desc())
        .limit(50)
    )


def _timeline_actor_statement(
    project_id: int, snapshot_max_event_id: int, *, actor: str
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
            ChangeEvent.actor == actor,
            ChangeEvent.id <= snapshot_max_event_id,
        )
        .order_by(ChangeEvent.id.desc())
        .limit(50)
    )


def _timeline_origin_statement(
    project_id: int, snapshot_max_event_id: int, *, origin: str
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
            ChangeEvent.origin == origin,
            ChangeEvent.id <= snapshot_max_event_id,
        )
        .order_by(ChangeEvent.id.desc())
        .limit(50)
    )


def _timeline_source_statement(
    project_id: int, snapshot_max_event_id: int, *, source_project_id: int
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
            ChangeEvent.source_project_id == source_project_id,
            ChangeEvent.id <= snapshot_max_event_id,
        )
        .order_by(ChangeEvent.id.desc())
        .limit(50)
    )


def _timeline_period_statement(
    project_id: int, snapshot_max_created_at: datetime
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
            ChangeEvent.created_at <= snapshot_max_created_at,
        )
        .order_by(ChangeEvent.created_at.desc(), ChangeEvent.id.desc())
        .limit(50)
    )


def _cell_coordinate_statement(
    condition_id: int, parameter_code: str
) -> sa.sql.Select[tuple[object, ...]]:
    return (
        select(CellValue.id, CellValue.condition_id, CellValue.parameter_code, CellValue.value_text)
        .where(
            CellValue.condition_id == condition_id,
            CellValue.parameter_code == parameter_code,
        )
        .limit(1)
    )


def _timeline_explain_sql(sql: str) -> str:
    return f"EXPLAIN (FORMAT JSON) {sql}"


def _collect_plan_node_types(plan: object) -> list[str]:
    nodes: list[str] = []
    if isinstance(plan, dict):
        node_type = plan.get("Node Type")
        if isinstance(node_type, str):
            nodes.append(node_type)
        for child in plan.get("Plans", []) or []:
            nodes.extend(_collect_plan_node_types(child))
    elif isinstance(plan, list):
        for child in plan:
            nodes.extend(_collect_plan_node_types(child))
    return nodes


def _collect_plan_index_names(plan: object) -> list[str]:
    indexes: list[str] = []
    if isinstance(plan, dict):
        index_name = plan.get("Index Name")
        if isinstance(index_name, str):
            indexes.append(index_name)
        for child in plan.get("Plans", []) or []:
            indexes.extend(_collect_plan_index_names(child))
    elif isinstance(plan, list):
        for child in plan:
            indexes.extend(_collect_plan_index_names(child))
    return indexes


async def _execute_query_plan(
    session: AsyncSession, statement: sa.sql.Select[tuple[object, ...]]
) -> object:
    explain = (
        await session.execute(
            sa.text(
                _timeline_explain_sql(
                    str(statement.compile(compile_kwargs={"literal_binds": True}))
                )
            ),
        )
    ).scalar_one()
    return explain


@pytest.mark.asyncio
async def test_history_fixture_builder_seeds_expected_counts() -> None:
    assert _PG_URL is not None
    with temporary_postgres_database() as database:
        engine = _build_engine(database.async_url)
        try:
            await _prepare_schema(engine)
            factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
            async with factory() as session:
                fixture = await _seed_history_fixture(session)
                await session.commit()

            async with factory() as session:
                assert (
                    await session.scalar(
                        select(sa.func.count(Project.id)).where(Project.id == fixture.project_id)
                    )
                    == 1
                )
                assert (
                    await _scalar_count(session, select(sa.func.count(SheetLayer.id)))
                    == _LAYER_COUNT
                )
                assert (
                    await _scalar_count(session, select(sa.func.count(LayerCondition.id)))
                    == _LAYER_COUNT
                )
                assert (
                    await _scalar_count(session, select(sa.func.count(CellValue.id)))
                    == _CELL_VALUE_COUNT
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


@pytest.mark.asyncio
async def test_history_query_plans_use_expected_indexes() -> None:
    assert _PG_URL is not None
    with temporary_postgres_database() as database:
        engine = _build_engine(database.async_url)
        try:
            await _prepare_schema(engine)
            factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
            async with factory() as session:
                fixture = await _seed_history_fixture(session)
                await session.commit()

            await _prepare_history_indexes(engine)
            await _analyze_database(engine)

            async with factory() as session:
                plan_cases: list[tuple[str, sa.sql.Select[tuple[object, ...]], str]] = [
                    (
                        "unfiltered timeline",
                        _timeline_page_statement(fixture.project_id, max(fixture.event_ids)),
                        "ix_change_event_project_id_id_desc",
                    ),
                    (
                        "event type timeline",
                        _timeline_event_type_statement(
                            fixture.project_id,
                            max(fixture.event_ids),
                            ChangeEventType.CELL_UPDATE,
                        ),
                        "ix_change_event_project_type_id_desc",
                    ),
                    (
                        "cell timeline",
                        _timeline_cell_statement(
                            fixture.project_id,
                            max(fixture.event_ids),
                            condition_id=fixture.condition_ids[0],
                            parameter_code=fixture.parameter_codes[0],
                        ),
                        "ix_change_event_project_cell_id_desc",
                    ),
                    (
                        "layer timeline",
                        _timeline_layer_statement(
                            fixture.project_id,
                            max(fixture.event_ids),
                            layer_key=fixture.layer_keys[0],
                        ),
                        "ix_change_event_project_layer_id_desc",
                    ),
                    (
                        "actor timeline",
                        _timeline_actor_statement(
                            fixture.project_id,
                            max(fixture.event_ids),
                            actor="perf-bot",
                        ),
                        "ix_change_event_project_actor_id_desc",
                    ),
                    (
                        "origin timeline",
                        _timeline_origin_statement(
                            fixture.project_id,
                            max(fixture.event_ids),
                            origin="manual",
                        ),
                        "ix_change_event_project_origin_id_desc",
                    ),
                    (
                        "source timeline",
                        _timeline_source_statement(
                            fixture.project_id,
                            max(fixture.event_ids),
                            source_project_id=9999,
                        ),
                        "ix_change_event_project_source_id_desc",
                    ),
                    (
                        "period timeline",
                        _timeline_period_statement(fixture.project_id, fixture.max_created_at),
                        "ix_change_event_project_created_id_desc",
                    ),
                ]

                for label, statement, expected_index in plan_cases:
                    explain = (
                        await session.execute(
                            sa.text(
                                _timeline_explain_sql(
                                    str(statement.compile(compile_kwargs={"literal_binds": True}))
                                )
                            )
                        )
                    ).scalar_one()
                    plan = (
                        json.loads(explain)[0]["Plan"]
                        if isinstance(explain, str)
                        else explain[0]["Plan"]
                    )
                    node_types = _collect_plan_node_types(plan)
                    index_names = _collect_plan_index_names(plan)
                    assert "Seq Scan" not in node_types, label
                    assert expected_index in index_names, label

                cell_coordinate = (
                    await session.execute(
                        sa.text(
                            _timeline_explain_sql(
                                str(
                                    _cell_coordinate_statement(
                                        fixture.condition_ids[0], fixture.parameter_codes[0]
                                    ).compile(compile_kwargs={"literal_binds": True})
                                )
                            )
                        )
                    )
                ).scalar_one()
                cell_plan = (
                    json.loads(cell_coordinate)[0]["Plan"]
                    if isinstance(cell_coordinate, str)
                    else cell_coordinate[0]["Plan"]
                )
                cell_index_names = _collect_plan_index_names(cell_plan)
                cell_node_types = _collect_plan_node_types(cell_plan)
                assert "Seq Scan" not in cell_node_types
                assert "uq_cell_condition_param" in cell_index_names
        finally:
            await engine.dispose()
