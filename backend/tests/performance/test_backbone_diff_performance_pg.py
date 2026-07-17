"""Guarded PostgreSQL loader performance gate for backbone diff."""

from __future__ import annotations

import json
import os
import resource
import statistics
import subprocess
import sys
import time
import tracemalloc
from pathlib import Path

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

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
_MAX_DATA_SELECTS = 8
_MAX_TOTAL_ROUND_TRIPS = 9
_MAX_FLAT_LOADER_SELECTS = 6
_MAX_P95_ELAPSED_MS = 180.0
_MAX_TRACEMALLOC_BYTES = 64 * 1024 * 1024
_MAX_RSS_KIB = 512 * 1024


async def _seed_large_project(session: AsyncSession) -> Project:
    category = ParameterCategory(code="perf", display_name="Perf", sort_order=1)
    session.add_all(
        [
            Parameter(
                code=f"param_{idx:04d}",
                display_name=f"Parameter {idx:04d}",
                value_type=ValueType.TEXT,
                sort_order=idx,
                category=category if idx % 5 == 0 else None,
                is_active=idx != 7,
            )
            for idx in range(_PARAMETER_COUNT)
        ]
    )

    project = Project(
        line_id="L1",
        process_id="PROC_PERF",
        part_id="PART_PERF",
        name="Backbone diff perf",
        profile=make_project_profile(process_name="PROC_PERF"),
    )
    for layer_idx in range(_LAYER_COUNT):
        layer_key = f"L1::PROC_PERF::{layer_idx:03d}::ACT"
        layer = SheetLayer(
            layer_key=layer_key,
            step_seq=f"{layer_idx:03d}",
            layer_id="ACT",
            eqp_type="ACT",
            eqp_type_desc="Active",
            area_name="PERF",
            sort_order=layer_idx,
            source_project_id=1,
            source_layer_key=layer_key,
            backbone_snapshot=serialize_backbone_snapshot(
                BackboneSnapshot(
                    capture_batch_id="0123456789abcdef0123456789abcdef",
                    source=BackboneSnapshotSource(
                        project_id=1,
                        sheet_layer_id=layer_idx + 1,
                        layer_key=layer_key,
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
                                BackboneSnapshotCell(
                                    parameter_code="param_0000",
                                    value="baseline",
                                ),
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


async def _measure_backbone_diff_loader_pg_gate() -> dict[str, object]:
    with temporary_postgres_database() as database:
        engine = create_async_engine(database.async_url)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        try:
            factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
            read_only_engine = engine.execution_options(isolation_level="REPEATABLE READ")
            read_only_factory = async_sessionmaker(
                read_only_engine,
                expire_on_commit=False,
                class_=AsyncSession,
            )
            async with factory() as session:
                project = await _seed_large_project(session)

            await load_diff_input_with_session_factory(project.id, read_only_factory)

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
                loaded = await load_diff_input_with_session_factory(
                    project.id,
                    read_only_factory,
                )
            finally:
                event.remove(read_only_engine.sync_engine, "before_cursor_execute", capture_sql)

            durations_ms: list[float] = []
            for _ in range(5):
                started = time.perf_counter()
                loaded = await load_diff_input_with_session_factory(
                    project.id,
                    read_only_factory,
                )
                durations_ms.append((time.perf_counter() - started) * 1000)

            tracemalloc.start()
            try:
                memory_loaded = await load_diff_input_with_session_factory(
                    project.id,
                    read_only_factory,
                )
                current_bytes, peak_bytes = tracemalloc.get_traced_memory()
            finally:
                tracemalloc.stop()

            select_count = sum(
                statement.lstrip().upper().startswith("SELECT") for statement in statements
            )
            p95_elapsed_ms = statistics.quantiles(
                durations_ms,
                n=20,
                method="inclusive",
            )[18]
            p50_elapsed_ms = statistics.median(durations_ms)
            max_elapsed_ms = max(durations_ms)
            shared_parameters = loaded.layers[0].current_parameters

            assert statements[0].lstrip().upper().startswith("SET TRANSACTION READ ONLY")
            assert loaded.project_id == project.id
            assert memory_loaded.project_id == project.id
            assert len(loaded.layers) == _LAYER_COUNT
            assert len(shared_parameters) == _PARAMETER_COUNT
            assert all(layer.current_parameters is shared_parameters for layer in loaded.layers)
            assert shared_parameters[7].active is False
            assert loaded.layers[0].current_conditions[0].source_condition_id == 10_000
            assert loaded.layers[0].current_conditions[0].cells[0].value == "v-000-0000"

            return {
                "round_trips": len(statements),
                "select_count": select_count,
                "durations_ms": durations_ms,
                "p50_elapsed_ms": p50_elapsed_ms,
                "p95_elapsed_ms": p95_elapsed_ms,
                "max_elapsed_ms": max_elapsed_ms,
                "current_bytes": current_bytes,
                "peak_bytes": peak_bytes,
                "rss_kib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                "layer_count": len(loaded.layers),
                "parameter_count": len(shared_parameters),
            }
        finally:
            await engine.dispose()


def test_backbone_diff_loader_pg_gate_bounded_queries_and_memory() -> None:
    code = (
        "import asyncio, json; "
        "from tests.performance.test_backbone_diff_performance_pg "
        "import _measure_backbone_diff_loader_pg_gate; "
        "print(json.dumps(asyncio.run(_measure_backbone_diff_loader_pg_gate())))"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[2],
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    metrics = json.loads(result.stdout.strip().splitlines()[-1])

    assert metrics["round_trips"] <= _MAX_TOTAL_ROUND_TRIPS
    assert metrics["select_count"] <= _MAX_DATA_SELECTS
    assert 4 <= metrics["select_count"] <= _MAX_FLAT_LOADER_SELECTS
    assert metrics["round_trips"] == metrics["select_count"] + 1
    assert metrics["p95_elapsed_ms"] <= _MAX_P95_ELAPSED_MS
    assert metrics["peak_bytes"] <= _MAX_TRACEMALLOC_BYTES
    assert metrics["current_bytes"] <= metrics["peak_bytes"]
    assert metrics["rss_kib"] <= _MAX_RSS_KIB
    assert metrics["layer_count"] == _LAYER_COUNT
    assert metrics["parameter_count"] == _PARAMETER_COUNT
