"""Guarded PostgreSQL performance gate for Phase 4 history reads.

This module is the RED-handoff benchmark scaffold until the planned history
repository/service seam lands. It binds the benchmark harness to explicit SQL
now so the dataset, timings, and EXPLAIN checks stay deterministic and can be
repointed to the production read surface later without changing the fixture.
"""

from __future__ import annotations

import json
import os
import statistics
import time
import uuid
from collections.abc import Awaitable, Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Final

import pytest
import sqlalchemy as sa
from sqlalchemy import event, insert, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

import app.models  # noqa: F401 -- register all models for metadata.create_all
from app.domain.parameters.types import ValueType
from app.models.parameter import Parameter
from app.models.project import (
    CellValue,
    ChangeEvent,
    ChangeEventType,
    LayerCondition,
    Project,
    ProjectProfile,
    ProjectStatus,
    SheetLayer,
)
from tests.postgres_database import TemporaryPostgresDatabase, temporary_postgres_database

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")

_LAYER_COUNT: Final[int] = 100
_PARAMETER_COUNT: Final[int] = 200
_CELL_VALUE_COUNT: Final[int] = _LAYER_COUNT * _PARAMETER_COUNT
_EVENT_COUNT: Final[int] = 100_000
_EVENT_BATCH_SIZE: Final[int] = 5_000
_TIMELINE_LIMIT: Final[int] = 50
_DETAIL_LIMIT: Final[int] = 100
_CELL_HISTORY_LIMIT: Final[int] = 50
_PASTE_LIMIT: Final[int] = 200
_WARMUP_RUNS: Final[int] = 1
_TIMED_RUNS: Final[int] = 5
_PAGE_BYTE_LIMIT: Final[int] = 256 * 1024
_TIMELINE_MS_LIMIT: Final[float] = 250.0
_DETAIL_MS_LIMIT: Final[float] = 250.0
_CELL_HISTORY_MS_LIMIT: Final[float] = 150.0
_PASTE_OVERHEAD_LIMIT: Final[float] = 0.20

_HISTORY_INDEX_SPECS: Final[tuple[sa.Index, ...]] = (
    sa.Index(
        "ix_change_event_project_id_id_desc",
        ChangeEvent.project_id,
        ChangeEvent.id.desc(),
    ),
    sa.Index(
        "ix_change_event_project_type_id_desc",
        ChangeEvent.project_id,
        ChangeEvent.event_type,
        ChangeEvent.id.desc(),
    ),
    sa.Index(
        "ix_change_event_project_cell_id_desc",
        ChangeEvent.project_id,
        ChangeEvent.condition_id,
        ChangeEvent.parameter_code,
        ChangeEvent.id.desc(),
        postgresql_where=sa.text("condition_id IS NOT NULL AND parameter_code IS NOT NULL"),
    ),
    sa.Index(
        "ix_change_event_project_condition_id_desc",
        ChangeEvent.project_id,
        ChangeEvent.condition_id,
        ChangeEvent.id.desc(),
        postgresql_where=sa.text("condition_id IS NOT NULL"),
    ),
    sa.Index(
        "ix_change_event_project_layer_id_desc",
        ChangeEvent.project_id,
        ChangeEvent.layer_key,
        ChangeEvent.id.desc(),
        postgresql_where=sa.text("layer_key IS NOT NULL"),
    ),
    sa.Index(
        "ix_change_event_project_actor_id_desc",
        ChangeEvent.project_id,
        ChangeEvent.actor,
        ChangeEvent.id.desc(),
    ),
    sa.Index(
        "ix_change_event_project_origin_id_desc",
        ChangeEvent.project_id,
        ChangeEvent.origin,
        ChangeEvent.id.desc(),
        postgresql_where=sa.text("origin IS NOT NULL"),
    ),
    sa.Index(
        "ix_change_event_project_source_id_desc",
        ChangeEvent.project_id,
        ChangeEvent.source_project_id,
        ChangeEvent.id.desc(),
        postgresql_where=sa.text("source_project_id IS NOT NULL"),
    ),
    sa.Index(
        "ix_change_event_project_created_id_desc",
        ChangeEvent.project_id,
        ChangeEvent.created_at.desc(),
        ChangeEvent.id.desc(),
    ),
    sa.Index(
        "ix_change_event_project_batch_id_desc",
        ChangeEvent.project_id,
        ChangeEvent.batch_id,
        ChangeEvent.id.desc(),
        postgresql_where=sa.text("batch_id IS NOT NULL"),
    ),
)


@dataclass(frozen=True, slots=True)
class HistoryPerformanceFixture:
    project_id: int
    layer_keys: tuple[str, ...]
    condition_ids: tuple[int, ...]
    parameter_codes: tuple[str, ...]
    snapshot_max_event_id: int
    current_condition_id: int
    current_parameter_code: str
    deleted_condition_id: int
    deleted_parameter_code: str
    timeline_batch_id: str
    detail_batch_id: str
    paste_batch_id: str
    cell_history_batch_id: str


@dataclass(frozen=True, slots=True)
class QueryBenchmark:
    label: str
    samples: int
    p50_ms: float
    p95_ms: float
    max_ms: float
    max_sql_count: int
    max_serialized_bytes: int


@dataclass(frozen=True, slots=True)
class ExplainPlanInfo:
    node_types: tuple[str, ...]
    index_names: tuple[str, ...]


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[2]


@contextmanager
def _migrated_database(revision: str = "head") -> Iterator[TemporaryPostgresDatabase]:
    with temporary_postgres_database() as database:
        sync_engine = sa.create_engine(
            database.sync_url,
            future=True,
            isolation_level="AUTOCOMMIT",
        )
        config = Config(str(_backend_root() / "alembic.ini"))
        config.set_main_option("script_location", str(_backend_root() / "alembic"))
        config.set_main_option("sqlalchemy.url", database.sync_url)
        try:
            with sync_engine.connect() as connection:
                config.attributes["connection"] = connection
                command.upgrade(config, revision)
            yield database
        finally:
            sync_engine.dispose()


def _async_engine(database: TemporaryPostgresDatabase) -> AsyncEngine:
    return create_async_engine(database.async_url, poolclass=NullPool)


def _serialize_rows(rows: Sequence[dict[str, Any]]) -> int:
    return len(json.dumps(list(rows), ensure_ascii=False, sort_keys=True).encode("utf-8"))


def _normalize_datetime(value: datetime) -> datetime:
    return value.astimezone(UTC)


@contextmanager
def _statement_counter(engine: Engine) -> Iterator[list[str]]:
    statements: list[str] = []

    def _capture(
        _connection: sa.Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _capture)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", _capture)


def _p95(values: Sequence[float]) -> float:
    if len(values) == 1:
        return values[0]
    return statistics.quantiles(values, n=20, method="inclusive")[18]


def _query_benchmark(label: str, samples: Sequence[tuple[float, int, int]]) -> QueryBenchmark:
    timings = [sample[0] for sample in samples]
    sql_counts = [sample[1] for sample in samples]
    byte_counts = [sample[2] for sample in samples]
    return QueryBenchmark(
        label=label,
        samples=len(samples),
        p50_ms=statistics.median(timings),
        p95_ms=_p95(timings),
        max_ms=max(timings),
        max_sql_count=max(sql_counts),
        max_serialized_bytes=max(byte_counts),
    )


async def _seed_project(session: AsyncSession) -> Project:
    project = Project(
        line_id="L1",
        process_id="HISTORY_PERF",
        part_id="P0",
        name="history-perf",
        status=ProjectStatus.DRAFT,
        profile=ProjectProfile(
            process_name="HISTORY_PERF",
            device_type_code="DEFAULT",
            project_category_code="DEFAULT",
            comment="History performance fixture",
        ),
    )
    session.add(project)
    await session.flush()
    return project


async def _seed_layers_and_conditions(
    session: AsyncSession,
    *,
    project: Project,
) -> tuple[list[SheetLayer], list[LayerCondition]]:
    layers: list[SheetLayer] = []
    for index in range(_LAYER_COUNT):
        layers.append(
            SheetLayer(
                project_id=project.id,
                layer_key=f"L1::HISTORY_PERF::{index + 1:03d}::L{index + 1:02d}",
                step_seq=f"{index + 1:03d}",
                layer_id=f"L{index + 1:02d}",
                sort_order=index + 1,
                backbone_snapshot={"schema_version": 2, "source_project_id": 9999},
            )
        )
    session.add_all(layers)
    await session.flush()

    conditions: list[LayerCondition] = []
    for index, layer in enumerate(layers):
        condition = LayerCondition(
            layer_id=layer.id,
            label="base",
            condition_index=1,
            is_por=index == 0,
        )
        condition.cell_values.append(
            CellValue(
                parameter_code=f"param_{(index % _PARAMETER_COUNT) + 1:03d}",
                value_text=f"seed-{index:03d}",
            )
        )
        conditions.append(condition)
        layer.conditions.append(condition)
    session.add_all(conditions)
    await session.flush()
    return layers, conditions


async def _seed_parameter_registry(session: AsyncSession) -> list[Parameter]:
    parameters = [
        Parameter(
            code=f"param_{index + 1:03d}",
            display_name=f"Parameter {index + 1:03d}",
            value_type=ValueType.TEXT,
            sort_order=index + 1,
        )
        for index in range(_PARAMETER_COUNT)
    ]
    session.add_all(parameters)
    await session.flush()
    return parameters


async def _seed_special_deleted_condition(
    session: AsyncSession,
    *,
    layer: SheetLayer,
) -> tuple[LayerCondition, int]:
    deleted_condition = LayerCondition(
        layer_id=layer.id,
        label="deleted",
        condition_index=2,
        is_por=False,
    )
    deleted_condition.cell_values.append(
        CellValue(parameter_code="param_002", value_text="deleted-seed")
    )
    session.add(deleted_condition)
    await session.flush()

    remove_event = ChangeEvent(
        project_id=layer.project_id,
        event_type=ChangeEventType.CONDITION_REMOVE,
        actor="system",
        batch_id=None,
        origin="manual",
        layer_key=layer.layer_key,
        condition_id=deleted_condition.id,
        parameter_code="param_002",
        payload={
            "layer_key": layer.layer_key,
            "condition_id": deleted_condition.id,
            "snapshot": {
                "label": deleted_condition.label,
                "is_por": deleted_condition.is_por,
                "condition_index": deleted_condition.condition_index,
                "cells": {"param_002": "deleted-seed"},
            },
        },
        created_at=datetime(2026, 7, 16, 8, 0, tzinfo=UTC),
    )
    session.add(remove_event)
    await session.flush()

    deleted_condition_id = deleted_condition.id
    await session.delete(deleted_condition)
    await session.flush()
    return deleted_condition, deleted_condition_id


async def _seed_history_fixture(session: AsyncSession) -> HistoryPerformanceFixture:
    project = await _seed_project(session)
    layers, conditions = await _seed_layers_and_conditions(session, project=project)
    parameters = await _seed_parameter_registry(session)
    deleted_condition, deleted_condition_id = await _seed_special_deleted_condition(
        session, layer=layers[0]
    )

    current_condition = conditions[0]
    hot_condition = conditions[1]
    current_parameter_code = current_condition.cell_values[0].parameter_code
    deleted_parameter_code = deleted_condition.cell_values[0].parameter_code

    timeline_batch_id = uuid.uuid5(uuid.NAMESPACE_URL, "pcm-history-timeline").hex
    detail_batch_id = uuid.uuid5(uuid.NAMESPACE_URL, "pcm-history-detail").hex
    paste_batch_id = uuid.uuid5(uuid.NAMESPACE_URL, "pcm-history-paste").hex
    cell_history_batch_id = uuid.uuid5(uuid.NAMESPACE_URL, "pcm-history-cell-history").hex

    event_rows = _build_events(
        project=project,
        layers=layers,
        conditions=conditions,
        parameters=parameters,
        current_condition=current_condition,
        current_parameter_code=current_parameter_code,
        hot_condition=hot_condition,
        deleted_condition_id=deleted_condition_id,
        deleted_parameter_code=deleted_parameter_code,
        timeline_batch_id=timeline_batch_id,
        detail_batch_id=detail_batch_id,
        paste_batch_id=paste_batch_id,
        cell_history_batch_id=cell_history_batch_id,
    )

    for offset in range(0, len(event_rows), _EVENT_BATCH_SIZE):
        await session.execute(insert(ChangeEvent), event_rows[offset : offset + _EVENT_BATCH_SIZE])
    await session.flush()
    await session.execute(text("ANALYZE project"))
    await session.execute(text("ANALYZE sheet_layer"))
    await session.execute(text("ANALYZE layer_condition"))
    await session.execute(text("ANALYZE cell_value"))
    await session.execute(text("ANALYZE change_event"))
    await session.commit()

    return HistoryPerformanceFixture(
        project_id=project.id,
        layer_keys=tuple(layer.layer_key for layer in layers),
        condition_ids=tuple(condition.id for condition in conditions),
        parameter_codes=tuple(parameter.code for parameter in parameters),
        snapshot_max_event_id=len(event_rows),
        current_condition_id=current_condition.id,
        current_parameter_code=current_parameter_code,
        deleted_condition_id=deleted_condition_id,
        deleted_parameter_code=deleted_parameter_code,
        timeline_batch_id=timeline_batch_id,
        detail_batch_id=detail_batch_id,
        paste_batch_id=paste_batch_id,
        cell_history_batch_id=cell_history_batch_id,
    )


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
    project: Project,
    layers: Sequence[SheetLayer],
    conditions: Sequence[LayerCondition],
    parameters: Sequence[Parameter],
    current_condition: LayerCondition,
    current_parameter_code: str,
    hot_condition: LayerCondition,
    deleted_condition_id: int,
    deleted_parameter_code: str,
    timeline_batch_id: str,
    detail_batch_id: str,
    paste_batch_id: str,
    cell_history_batch_id: str,
) -> list[dict[str, object]]:
    """Build a deterministic 100k mixed structured history event stream."""

    rows: list[dict[str, object]] = []
    event_id = 0
    created_at = datetime(2026, 7, 16, 8, 0, tzinfo=UTC)
    manual_paste = ("manual", "paste")

    def add_event(
        event_type: ChangeEventType,
        *,
        batch_id: str | None,
        actor: str,
        origin: str | None,
        layer: SheetLayer,
        condition: LayerCondition | None,
        parameter_code: str | None,
        old_value: str | None = None,
        new_value: str | None = None,
        source_project_id: int | None = None,
        source_layer_key: str | None = None,
        payload: dict[str, object] | None = None,
    ) -> None:
        nonlocal event_id, created_at
        event_id += 1
        created_at = created_at + timedelta(milliseconds=1)
        rows.append(
            {
                "id": event_id,
                "project_id": project.id,
                "event_type": event_type,
                "actor": actor,
                "payload": payload or {},
                "condition_id": None if condition is None else condition.id,
                "parameter_code": parameter_code,
                "old_value": old_value,
                "new_value": new_value,
                "layer_key": layer.layer_key,
                "batch_id": batch_id,
                "origin": origin,
                "source_project_id": source_project_id,
                "source_layer_key": source_layer_key,
                "created_at": created_at,
            }
        )

    # Dedicated hot paths used by the read benchmarks.
    current_layer = layers[0]
    for index in range(52):
        add_event(
            ChangeEventType.CELL_UPDATE,
            batch_id=cell_history_batch_id,
            actor="dev-admin" if index % 2 == 0 else "qa-bot",
            origin=manual_paste[index % 2],
            layer=current_layer,
            condition=current_condition,
            parameter_code=current_parameter_code,
            old_value=f"history-{index:03d}",
            new_value=f"history-{index + 1:03d}",
            source_project_id=project.id,
            source_layer_key=current_layer.layer_key,
            payload={"batch_id": cell_history_batch_id, "origin": manual_paste[index % 2]},
        )

    for index in range(100):
        add_event(
            ChangeEventType.CELL_UPDATE,
            batch_id=detail_batch_id,
            actor="dev-admin" if index % 2 == 0 else "perf-bot",
            origin=manual_paste[index % 2],
            layer=current_layer,
            condition=hot_condition,
            parameter_code=parameters[index % len(parameters)].code,
            old_value=f"detail-{index:03d}",
            new_value=f"detail-{index + 1:03d}",
            source_project_id=project.id,
            source_layer_key=current_layer.layer_key,
            payload={"batch_id": detail_batch_id, "origin": manual_paste[index % 2]},
        )

    for index in range(200):
        layer = layers[index % len(layers)]
        condition = conditions[index % len(conditions)]
        add_event(
            ChangeEventType.CELL_UPDATE,
            batch_id=paste_batch_id,
            actor="operator" if index % 3 == 0 else "qa-bot",
            origin="paste",
            layer=layer,
            condition=condition,
            parameter_code=parameters[index % len(parameters)].code,
            old_value=f"paste-{index:03d}",
            new_value=f"paste-{index + 1:03d}",
            source_project_id=project.id,
            source_layer_key=layer.layer_key,
            payload={"batch_id": paste_batch_id, "origin": "paste"},
        )

    generic_cell_batches = 19_824
    for batch_index in range(generic_cell_batches):
        batch_id = uuid.uuid5(uuid.NAMESPACE_URL, f"pcm-history-generic-{batch_index}").hex
        for repeat in range(2):
            layer = layers[(batch_index + repeat) % len(layers)]
            condition = conditions[(batch_index + repeat) % len(conditions)]
            parameter = parameters[(batch_index * 2 + repeat) % len(parameters)]
            origin = manual_paste[(batch_index + repeat) % 2]
            add_event(
                ChangeEventType.CELL_UPDATE,
                batch_id=batch_id,
                actor="dev-admin" if repeat == 0 else "perf-bot",
                origin=origin,
                layer=layer,
                condition=condition,
                parameter_code=parameter.code,
                old_value=f"cell-{batch_index:05d}-{repeat}-old",
                new_value=f"cell-{batch_index:05d}-{repeat}-new",
                source_project_id=project.id,
                source_layer_key=layer.layer_key,
                payload={"batch_id": batch_id, "origin": origin},
            )

    # Structured events for condition, POR, profile, and backbone lanes.
    for index in range(10_000):
        layer = layers[index % len(layers)]
        condition = conditions[index % len(conditions)]
        add_event(
            ChangeEventType.CONDITION_ADD,
            batch_id=None,
            actor="operator",
            origin="manual",
            layer=layer,
            condition=condition,
            parameter_code=None,
            payload={
                "layer_key": layer.layer_key,
                "condition_id": condition.id,
                "source_condition_id": None,
                "detail": {"event": "condition_add"},
            },
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
        )
        add_event(
            ChangeEventType.CONDITION_REMOVE,
            batch_id=None,
            actor="operator",
            origin="manual",
            layer=layer,
            condition=condition,
            parameter_code=None,
            payload={
                "layer_key": layer.layer_key,
                "condition_id": condition.id,
                "snapshot": {
                    "label": condition.label,
                    "is_por": condition.is_por,
                    "condition_index": condition.condition_index,
                    "cells": {parameters[index % len(parameters)].code: f"{index:03d}"},
                },
            },
        )
        add_event(
            ChangeEventType.POR_CHANGE,
            batch_id=None,
            actor="operator",
            origin="manual",
            layer=layer,
            condition=condition,
            parameter_code=None,
            payload={
                "layer_key": layer.layer_key,
                "old_por_condition_id": condition.id if index % 2 == 0 else None,
                "new_por_condition_id": condition.id,
            },
        )
        add_event(
            ChangeEventType.PROJECT_PROFILE_UPDATE,
            batch_id=None,
            actor="system",
            origin="system",
            layer=layer,
            condition=None,
            parameter_code=None,
            payload={
                "batch_id": None,
                "project_profile": {
                    "process_name": project.profile.process_name,
                    "device_type_code": project.profile.device_type_code,
                    "project_category_code": project.profile.project_category_code,
                    "comment": f"profile-{index:05d}",
                },
            },
        )

    for index in range(10_000):
        batch_id = uuid.uuid5(uuid.NAMESPACE_URL, f"pcm-history-backbone-copy-{index}").hex
        layer = layers[index % len(layers)]
        add_event(
            ChangeEventType.PROJECT_PROFILE_UPDATE,
            batch_id=batch_id,
            actor="system",
            origin="backbone",
            layer=layer,
            condition=conditions[index % len(conditions)],
            parameter_code=None,
            source_project_id=project.id,
            source_layer_key=layer.layer_key,
            payload={
                "batch_id": batch_id,
                "schema_version": 1 if index % 2 == 0 else 2,
                "source_project_id": project.id,
                "source_layer_key": layer.layer_key,
            },
        )
        add_event(
            ChangeEventType.BACKBONE_LAYER_REPLACE,
            batch_id=batch_id,
            actor="system",
            origin="backbone",
            layer=layer,
            condition=conditions[(index + 1) % len(conditions)],
            parameter_code=None,
            source_project_id=project.id,
            source_layer_key=layers[(index + 1) % len(layers)].layer_key,
            payload={
                "batch_id": batch_id,
                "schema_version": 1 if index % 2 == 0 else 2,
                "source_project_id": project.id,
                "source_layer_key": layers[(index + 1) % len(layers)].layer_key,
            },
            layer_key=target_layer_key,
            source_project_id=9999,
            source_layer_key=source_layer_key,
        )

    assert len(rows) == _EVENT_COUNT, len(rows)
    assert event_id == _EVENT_COUNT
    return rows


async def _assert_seed_counts(session: AsyncSession, fixture: HistoryPerformanceFixture) -> None:
    assert await session.scalar(select(sa.func.count(Project.id))) == 1
    assert await session.scalar(select(sa.func.count(ProjectProfile.project_id))) == 1
    assert await session.scalar(select(sa.func.count(SheetLayer.id))) == _LAYER_COUNT
    assert await session.scalar(select(sa.func.count(LayerCondition.id))) == _LAYER_COUNT
    assert await session.scalar(select(sa.func.count(Parameter.id))) == _PARAMETER_COUNT
    assert await session.scalar(select(sa.func.count(ChangeEvent.id))) == _EVENT_COUNT
    assert (
        await session.scalar(select(sa.func.max(ChangeEvent.id))) == fixture.snapshot_max_event_id
    )


def _timeline_statement(
    *,
    project_id: int,
    snapshot_max_event_id: int,
    limit: int,
    layer_key: str | None = None,
    event_type: ChangeEventType | None = None,
    actor: str | None = None,
    origin: str | None = None,
    source_project_id: int | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
) -> sa.sql.Select[tuple[object, ...]]:
    stmt = (
        select(
            ChangeEvent.id,
            ChangeEvent.event_type,
            ChangeEvent.actor,
            ChangeEvent.created_at,
            ChangeEvent.batch_id,
            ChangeEvent.origin,
            ChangeEvent.layer_key,
            ChangeEvent.source_project_id,
            ChangeEvent.source_layer_key,
            ChangeEvent.condition_id,
            ChangeEvent.parameter_code,
        )
        .where(ChangeEvent.project_id == project_id, ChangeEvent.id <= snapshot_max_event_id)
        .order_by(ChangeEvent.id.desc())
        .limit(limit)
    )
    if layer_key is not None:
        stmt = stmt.where(ChangeEvent.layer_key == layer_key)
    if event_type is not None:
        stmt = stmt.where(ChangeEvent.event_type == event_type)
    if actor is not None:
        stmt = stmt.where(ChangeEvent.actor == actor)
    if origin is not None:
        stmt = stmt.where(ChangeEvent.origin == origin)
    if source_project_id is not None:
        stmt = stmt.where(ChangeEvent.source_project_id == source_project_id)
    if created_from is not None:
        stmt = stmt.where(ChangeEvent.created_at >= created_from)
    if created_to is not None:
        stmt = stmt.where(ChangeEvent.created_at < created_to)
    return stmt


def _batch_detail_statement(
    *, project_id: int, batch_id: str, snapshot_max_event_id: int, limit: int
) -> sa.sql.Select[tuple[object, ...]]:
    return (
        select(
            ChangeEvent.id,
            ChangeEvent.event_type,
            ChangeEvent.actor,
            ChangeEvent.created_at,
            ChangeEvent.batch_id,
            ChangeEvent.origin,
            ChangeEvent.layer_key,
            ChangeEvent.source_project_id,
            ChangeEvent.source_layer_key,
            ChangeEvent.condition_id,
            ChangeEvent.parameter_code,
        )
        .where(
            ChangeEvent.project_id == project_id,
            ChangeEvent.batch_id == batch_id,
            ChangeEvent.id <= snapshot_max_event_id,
        )
        .order_by(ChangeEvent.id.desc())
        .limit(limit)
    )


def _cell_history_statement(
    *,
    project_id: int,
    condition_id: int,
    parameter_code: str,
    snapshot_max_event_id: int,
    limit: int,
) -> sa.sql.Select[tuple[object, ...]]:
    return (
        select(
            ChangeEvent.id,
            ChangeEvent.event_type,
            ChangeEvent.actor,
            ChangeEvent.created_at,
            ChangeEvent.batch_id,
            ChangeEvent.origin,
            ChangeEvent.layer_key,
            ChangeEvent.source_project_id,
            ChangeEvent.source_layer_key,
            ChangeEvent.condition_id,
            ChangeEvent.parameter_code,
            ChangeEvent.old_value,
            ChangeEvent.new_value,
        )
        .where(
            ChangeEvent.project_id == project_id,
            ChangeEvent.condition_id == condition_id,
            ChangeEvent.parameter_code == parameter_code,
            ChangeEvent.event_type == ChangeEventType.CELL_UPDATE,
            ChangeEvent.id <= snapshot_max_event_id,
        )
        .order_by(ChangeEvent.id.desc())
        .limit(limit)
    )


def _coordinate_statement(
    *, project_id: int, condition_id: int, parameter_code: str
) -> sa.sql.Select[tuple[Any, ...]]:
    return (
        select(SheetLayer.layer_key, CellValue.id)
        .select_from(CellValue)
        .join(LayerCondition, LayerCondition.id == CellValue.condition_id)
        .join(SheetLayer, SheetLayer.id == LayerCondition.layer_id)
        .where(
            SheetLayer.project_id == project_id,
            LayerCondition.id == condition_id,
            CellValue.parameter_code == parameter_code,
        )
        .limit(1)
    )


async def _fetch_rows(
    session: AsyncSession, statement: sa.sql.Select[tuple[Any, ...]]
) -> list[dict[str, Any]]:
    result = await session.execute(statement)
    return [dict(row) for row in result.mappings().all()]


async def _benchmark(
    *,
    engine: AsyncEngine,
    factory: async_sessionmaker[AsyncSession],
    label: str,
    statement_factory: Callable[[AsyncSession], Awaitable[list[dict[str, Any]]]],
) -> tuple[QueryBenchmark, list[dict[str, Any]]]:
    samples: list[tuple[float, int, int]] = []
    last_rows: list[dict[str, Any]] = []
    for sample_index in range(_WARMUP_RUNS + _TIMED_RUNS):
        async with factory() as session:
            with _statement_counter(engine.sync_engine) as statements:
                start = time.perf_counter()
                rows = await statement_factory(session)
                elapsed_ms = (time.perf_counter() - start) * 1000.0
        if sample_index == 0:
            continue
        last_rows = rows
        samples.append((elapsed_ms, len(statements), _serialize_rows(rows)))
    return _query_benchmark(label, samples), last_rows


async def _explain_plan(
    session: AsyncSession, statement: sa.sql.Select[tuple[object, ...]]
) -> ExplainPlanInfo:
    compiled = statement.compile(
        dialect=session.get_bind().dialect,
        compile_kwargs={"literal_binds": True},
    )
    explain_sql = text(f"EXPLAIN (FORMAT JSON) {compiled}")
    payload = (await session.execute(explain_sql)).scalar_one()
    plan_document = json.loads(payload) if isinstance(payload, str) else payload
    root = plan_document[0]["Plan"]

    node_types: list[str] = []
    index_names: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            node_type = node.get("Node Type")
            if isinstance(node_type, str):
                node_types.append(node_type)
            index_name = node.get("Index Name")
            if isinstance(index_name, str):
                index_names.append(index_name)
            for child in node.get("Plans", []) or []:
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(root)
    return ExplainPlanInfo(node_types=tuple(node_types), index_names=tuple(index_names))


@pytest.mark.asyncio
async def test_history_fixture_builder_seeds_expected_counts() -> None:
    with _migrated_database("head") as database:
        engine = _async_engine(database)
        factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        try:
            async with factory() as session:
                fixture = await _seed_history_fixture(session)
                await _assert_seed_counts(session, fixture)
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_history_timeline_batch_and_cell_queries_stay_within_budget() -> None:
    with _migrated_database("head") as database:
        engine = _async_engine(database)
        factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        try:
            async with factory() as session:
                fixture = await _seed_history_fixture(session)

            async def unfiltered_timeline(session: AsyncSession) -> list[dict[str, Any]]:
                return await _fetch_rows(
                    session,
                    _timeline_statement(
                        project_id=fixture.project_id,
                        snapshot_max_event_id=fixture.snapshot_max_event_id,
                        limit=_TIMELINE_LIMIT,
                    ),
                )

            async def indexed_timeline(session: AsyncSession) -> list[dict[str, Any]]:
                return await _fetch_rows(
                    session,
                    _timeline_statement(
                        project_id=fixture.project_id,
                        snapshot_max_event_id=fixture.snapshot_max_event_id,
                        limit=_TIMELINE_LIMIT,
                        layer_key=fixture.layer_keys[0],
                    ),
                )

            async def batch_detail(session: AsyncSession) -> list[dict[str, Any]]:
                return await _fetch_rows(
                    session,
                    _batch_detail_statement(
                        project_id=fixture.project_id,
                        batch_id=fixture.detail_batch_id,
                        snapshot_max_event_id=fixture.snapshot_max_event_id,
                        limit=_DETAIL_LIMIT,
                    ),
                )

            async def cell_history(session: AsyncSession) -> list[dict[str, Any]]:
                return await _fetch_rows(
                    session,
                    _cell_history_statement(
                        project_id=fixture.project_id,
                        condition_id=fixture.current_condition_id,
                        parameter_code=fixture.current_parameter_code,
                        snapshot_max_event_id=fixture.snapshot_max_event_id,
                        limit=_CELL_HISTORY_LIMIT,
                    ),
                )

            async def coordinate_lookup(session: AsyncSession) -> list[dict[str, Any]]:
                return await _fetch_rows(
                    session,
                    _coordinate_statement(
                        project_id=fixture.project_id,
                        condition_id=fixture.current_condition_id,
                        parameter_code=fixture.current_parameter_code,
                    ),
                )

            timeline_bench, timeline_rows = await _benchmark(
                engine=engine,
                factory=factory,
                label="timeline_unfiltered",
                statement_factory=unfiltered_timeline,
            )
            filtered_timeline_bench, filtered_timeline_rows = await _benchmark(
                engine=engine,
                factory=factory,
                label="timeline_layer_filtered",
                statement_factory=indexed_timeline,
            )
            batch_bench, batch_rows = await _benchmark(
                engine=engine,
                factory=factory,
                label="batch_detail_100",
                statement_factory=batch_detail,
            )
            cell_history_bench, cell_history_rows = await _benchmark(
                engine=engine,
                factory=factory,
                label="cell_history_50",
                statement_factory=cell_history,
            )
            coordinate_bench, coordinate_rows = await _benchmark(
                engine=engine,
                factory=factory,
                label="coordinate_lookup",
                statement_factory=coordinate_lookup,
            )
        finally:
            await engine.dispose()

    assert timeline_rows
    assert filtered_timeline_rows
    assert batch_rows
    assert cell_history_rows
    assert coordinate_rows

    assert timeline_bench.samples == _TIMED_RUNS
    assert timeline_bench.p95_ms <= _TIMELINE_MS_LIMIT
    assert timeline_bench.max_ms <= _TIMELINE_MS_LIMIT
    assert timeline_bench.max_sql_count <= 1
    assert timeline_bench.max_serialized_bytes <= _PAGE_BYTE_LIMIT

    assert filtered_timeline_bench.p95_ms <= _TIMELINE_MS_LIMIT
    assert filtered_timeline_bench.max_sql_count <= 1
    assert filtered_timeline_bench.max_serialized_bytes <= _PAGE_BYTE_LIMIT

    assert batch_bench.p95_ms <= _DETAIL_MS_LIMIT
    assert batch_bench.max_ms <= _DETAIL_MS_LIMIT
    assert batch_bench.max_sql_count <= 1
    assert batch_bench.max_serialized_bytes <= _PAGE_BYTE_LIMIT

    assert cell_history_bench.p95_ms <= _CELL_HISTORY_MS_LIMIT
    assert cell_history_bench.max_ms <= _CELL_HISTORY_MS_LIMIT
    assert cell_history_bench.max_sql_count <= 1
    assert cell_history_bench.max_serialized_bytes <= _PAGE_BYTE_LIMIT

    assert coordinate_bench.max_sql_count <= 1
    assert coordinate_bench.max_serialized_bytes <= _PAGE_BYTE_LIMIT


@pytest.mark.asyncio
async def test_history_explain_plans_use_intended_0007_indexes() -> None:
    with _migrated_database("head") as database:
        engine = _async_engine(database)
        factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        try:
            async with factory() as session:
                fixture = await _seed_history_fixture(session)

                start = _normalize_datetime(datetime(2026, 7, 16, 8, 0, tzinfo=UTC))
                end = start + timedelta(hours=1)
                explain_cases: dict[str, tuple[sa.sql.Select[tuple[object, ...]], set[str]]] = {
                    "layer": (
                        _timeline_statement(
                            project_id=fixture.project_id,
                            snapshot_max_event_id=fixture.snapshot_max_event_id,
                            limit=_TIMELINE_LIMIT,
                            layer_key=fixture.layer_keys[0],
                        ),
                        {"ix_change_event_project_layer_id_desc"},
                    ),
                    "type": (
                        _timeline_statement(
                            project_id=fixture.project_id,
                            snapshot_max_event_id=fixture.snapshot_max_event_id,
                            limit=_TIMELINE_LIMIT,
                            event_type=ChangeEventType.CELL_UPDATE,
                        ),
                        {"ix_change_event_project_type_id_desc"},
                    ),
                    "actor": (
                        _timeline_statement(
                            project_id=fixture.project_id,
                            snapshot_max_event_id=fixture.snapshot_max_event_id,
                            limit=_TIMELINE_LIMIT,
                            actor="dev-admin",
                        ),
                        {"ix_change_event_project_actor_id_desc"},
                    ),
                    "origin": (
                        _timeline_statement(
                            project_id=fixture.project_id,
                            snapshot_max_event_id=fixture.snapshot_max_event_id,
                            limit=_TIMELINE_LIMIT,
                            origin="manual",
                        ),
                        {"ix_change_event_project_origin_id_desc"},
                    ),
                    "source": (
                        _timeline_statement(
                            project_id=fixture.project_id,
                            snapshot_max_event_id=fixture.snapshot_max_event_id,
                            limit=_TIMELINE_LIMIT,
                            source_project_id=fixture.project_id,
                        ),
                        {"ix_change_event_project_source_id_desc"},
                    ),
                    "period": (
                        _timeline_statement(
                            project_id=fixture.project_id,
                            snapshot_max_event_id=fixture.snapshot_max_event_id,
                            limit=_TIMELINE_LIMIT,
                            created_from=start,
                            created_to=end,
                        ),
                        {"ix_change_event_project_created_id_desc"},
                    ),
                    "cell": (
                        _cell_history_statement(
                            project_id=fixture.project_id,
                            condition_id=fixture.current_condition_id,
                            parameter_code=fixture.current_parameter_code,
                            snapshot_max_event_id=fixture.snapshot_max_event_id,
                            limit=_CELL_HISTORY_LIMIT,
                        ),
                        {"ix_change_event_project_cell_id_desc"},
                    ),
                }
                for label, (statement, expected_indexes) in explain_cases.items():
                    plan = await _explain_plan(session, statement)
                    assert "Seq Scan" not in plan.node_types, label
                    assert expected_indexes.issubset(set(plan.index_names)), (label, plan)
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_history_200_cell_paste_median_overhead_stays_bounded_pre_and_post_0007() -> None:
    with _migrated_database("0006") as pre_database, _migrated_database("head") as post_database:
        pre_engine = _async_engine(pre_database)
        post_engine = _async_engine(post_database)
        pre_factory = async_sessionmaker(pre_engine, expire_on_commit=False, class_=AsyncSession)
        post_factory = async_sessionmaker(post_engine, expire_on_commit=False, class_=AsyncSession)
        try:
            async with pre_factory() as pre_session:
                pre_fixture = await _seed_history_fixture(pre_session)
            async with post_factory() as post_session:
                post_fixture = await _seed_history_fixture(post_session)

            async def paste_query(
                session: AsyncSession, fixture: HistoryPerformanceFixture
            ) -> list[dict[str, Any]]:
                return await _fetch_rows(
                    session,
                    _batch_detail_statement(
                        project_id=fixture.project_id,
                        batch_id=fixture.paste_batch_id,
                        snapshot_max_event_id=fixture.snapshot_max_event_id,
                        limit=_PASTE_LIMIT,
                    ),
                )

            pre_bench, pre_rows = await _benchmark(
                engine=pre_engine,
                factory=pre_factory,
                label="paste_pre_0006",
                statement_factory=lambda session: paste_query(session, pre_fixture),
            )
            post_bench, post_rows = await _benchmark(
                engine=post_engine,
                factory=post_factory,
                label="paste_post_0007",
                statement_factory=lambda session: paste_query(session, post_fixture),
            )
        finally:
            await pre_engine.dispose()
            await post_engine.dispose()

    assert len(pre_rows) == _PASTE_LIMIT
    assert len(post_rows) == _PASTE_LIMIT
    assert pre_bench.samples == _TIMED_RUNS
    assert post_bench.samples == _TIMED_RUNS
    if pre_bench.p50_ms > 0:
        overhead = (post_bench.p50_ms - pre_bench.p50_ms) / pre_bench.p50_ms
        assert overhead <= _PASTE_OVERHEAD_LIMIT


@pytest.mark.asyncio
async def test_history_fixture_is_queryable_after_seed_and_analyze() -> None:
    with _migrated_database("head") as database:
        engine = _async_engine(database)
        factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        try:
            async with factory() as session:
                fixture = await _seed_history_fixture(session)
                timeline = await _fetch_rows(
                    session,
                    _timeline_statement(
                        project_id=fixture.project_id,
                        snapshot_max_event_id=fixture.snapshot_max_event_id,
                        limit=_TIMELINE_LIMIT,
                    ),
                )
                batch_detail = await _fetch_rows(
                    session,
                    _batch_detail_statement(
                        project_id=fixture.project_id,
                        batch_id=fixture.detail_batch_id,
                        snapshot_max_event_id=fixture.snapshot_max_event_id,
                        limit=_DETAIL_LIMIT,
                    ),
                )
                cell_history = await _fetch_rows(
                    session,
                    _cell_history_statement(
                        project_id=fixture.project_id,
                        condition_id=fixture.current_condition_id,
                        parameter_code=fixture.current_parameter_code,
                        snapshot_max_event_id=fixture.snapshot_max_event_id,
                        limit=_CELL_HISTORY_LIMIT,
                    ),
                )
        finally:
            await engine.dispose()

    assert len(timeline) == _TIMELINE_LIMIT
    assert len(batch_detail) == _DETAIL_LIMIT
    assert len(cell_history) == _CELL_HISTORY_LIMIT
