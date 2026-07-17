"""Guarded PostgreSQL loader performance gate for backbone diff."""

from __future__ import annotations

import os
import resource
import time
import tracemalloc
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models  # noqa: F401 -- register all models for metadata
from app.core.db import Base
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
pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL unset")

_LAYER_COUNT = 100
_PARAMETER_COUNT = 200
_CELL_COUNT = _LAYER_COUNT * _PARAMETER_COUNT
_MAX_DATA_SELECTS = 8
_MAX_TOTAL_ROUND_TRIPS = 9
_MAX_ELAPSED_MS = 6_500.0
_MAX_TRACEMALLOC_BYTES = 64 * 1024 * 1024
_MAX_RSS_KIB = 512 * 1024


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


async def _seed_large_project(session: AsyncSession) -> Project:
    category = ParameterCategory(code="perf", display_name="Perf", sort_order=1)
    params: list[Parameter] = []
    for idx in range(_PARAMETER_COUNT):
        params.append(
            Parameter(
                code=f"param_{idx:04d}",
                display_name=f"Parameter {idx:04d}",
                value_type=ValueType.TEXT,
                sort_order=idx,
                category=category if idx % 5 == 0 else None,
                is_active=idx != 7,
            )
        )
    session.add_all(params)

    project = Project(
        line_id="L1",
        process_id="PROC_PERF",
        part_id="PART_PERF",
        name="Backbone diff perf",
        profile=make_project_profile(process_name="PROC_PERF"),
    )
    for layer_idx in range(_LAYER_COUNT):
        layer = SheetLayer(
            layer_key=f"L1::PROC_PERF::{layer_idx:03d}::ACT",
            step_seq=f"{layer_idx:03d}",
            layer_id="ACT",
            eqp_type="ACT",
            eqp_type_desc="Active",
            area_name="PERF",
            sort_order=layer_idx,
            source_project_id=1,
            source_layer_key=f"L1::PROC_PERF::{layer_idx:03d}::ACT",
            backbone_snapshot=serialize_backbone_snapshot(
                BackboneSnapshot(
                    capture_batch_id="0123456789abcdef0123456789abcdef",
                    source=BackboneSnapshotSource(
                        project_id=1,
                        sheet_layer_id=layer_idx + 1,
                        layer_key=f"L1::PROC_PERF::{layer_idx:03d}::ACT",
                        step_seq=f"{layer_idx:03d}",
                        layer_id="ACT",
                    ),
                    columns=(
                        BackboneSnapshotColumn(
                            parameter_code="param_0000",
                            value_type=ValueType.TEXT,
                            display_name="Parameter 0000",
                            category_code="perf",
                            sort_order=0,
                            active_at_capture=True,
                        ),
                    ),
                    conditions=(
                        BackboneSnapshotCondition(
                            source_condition_id=10_000 + layer_idx,
                            label="base",
                            condition_index=0,
                            is_por=True,
                            cells=(
                                BackboneSnapshotCell(parameter_code="param_0000", value="baseline"),
                            ),
                        ),
                    ),
                )
            ),
        )
        condition = LayerCondition(
            label="base",
            condition_index=0,
            is_por=True,
            source_condition_id=10_000 + layer_idx,
        )
        condition.cell_values.extend(
            [
                CellValue(
                    parameter_code=f"param_{param_idx:04d}",
                    value_text=f"v-{layer_idx:03d}-{param_idx:04d}",
                )
                for param_idx in range(_PARAMETER_COUNT)
            ]
        )
        layer.conditions.append(condition)
        project.layers.append(layer)
    session.add(project)
    await session.commit()
    return project


@pytest.mark.asyncio
async def test_backbone_diff_loader_pg_gate_bounded_queries_and_memory(
    pg_factory: async_sessionmaker[AsyncSession],
    pg_engine: AsyncEngine,
) -> None:
    read_only_engine = pg_engine.execution_options(isolation_level="REPEATABLE READ")
    read_only_factory = async_sessionmaker(
        read_only_engine, expire_on_commit=False, class_=AsyncSession
    )
    async with pg_factory() as session:
        project = await _seed_large_project(session)

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

    event.listen(read_only_engine.sync_engine, "before_cursor_execute", capture_sql)
    try:
        await load_diff_input_with_session_factory(project.id, read_only_factory)
        statements.clear()
        tracemalloc.start()
        started = time.perf_counter()
        loaded = await load_diff_input_with_session_factory(project.id, read_only_factory)
        elapsed_ms = (time.perf_counter() - started) * 1000
        current_bytes, peak_bytes = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
        event.remove(read_only_engine.sync_engine, "before_cursor_execute", capture_sql)

    rss_kib = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss

    assert statements[0].lstrip().upper().startswith("SET TRANSACTION READ ONLY")
    assert len(statements) <= _MAX_TOTAL_ROUND_TRIPS
    assert (
        len([stmt for stmt in statements if stmt.lstrip().upper().startswith("SELECT")])
        <= _MAX_DATA_SELECTS
    )
    assert elapsed_ms <= _MAX_ELAPSED_MS
    assert peak_bytes <= _MAX_TRACEMALLOC_BYTES
    assert current_bytes <= peak_bytes
    assert rss_kib <= _MAX_RSS_KIB

    assert loaded.project_id == project.id
    assert len(loaded.layers) == _LAYER_COUNT
    assert len(loaded.layers[0].current_parameters) == _PARAMETER_COUNT
    assert loaded.layers[0].current_parameters[7].active is False
    assert loaded.layers[0].current_conditions[0].source_condition_id == 10_000
    assert loaded.layers[0].current_conditions[0].cells[0].value == "v-000-0000"
    statements.clear()
    _ = loaded.layers[0].current_conditions[0].cells[0].value
    assert statements == []
