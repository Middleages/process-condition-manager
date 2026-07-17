"""Guarded PostgreSQL evidence runner for the Phase 4 Backbone diff budget."""

# ruff: noqa: E402 -- direct execution must add backend/ before app/test imports.

from __future__ import annotations

import argparse
import asyncio
import gc
import json
import math
import os
import platform
import subprocess
import sys
import time
import tracemalloc
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = _BACKEND_ROOT.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import sqlalchemy as sa
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models  # noqa: F401 -- register the complete production metadata
from app.core.db import Base, get_app_session
from app.domain.backbone.diff import compare_backbone
from app.domain.backbone.snapshot import (
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
    serialize_backbone_snapshot,
)
from app.domain.parameters.types import ValueType
from app.features.backbone_diff.contracts import BackboneDiffProjectInput
from app.features.backbone_diff.read_snapshot import (
    build_read_only_sessionmaker,
    load_diff_input_with_session_factory,
)
from app.main import create_app
from app.models.choice import ChoiceSet
from app.models.parameter import Parameter, ParameterCategory
from app.models.project import CellValue, LayerCondition, Project, SheetLayer
from tests.postgres_database import TemporaryPostgresDatabase, temporary_postgres_database

_SCHEMA_VERSION = 1
_FIXTURE_SEED = 20260717
_PROJECT_ID = 1
_LAYER_COUNT = 100
_PARAMETER_COUNT = 200
_CONDITION_COUNT = _LAYER_COUNT
_COORDINATE_COUNT = _LAYER_COUNT * _PARAMETER_COUNT
_WARMUP_RUNS = 1
_MEASURED_RUNS = 5
_PURE_MAX_P95_MS = 250.0
_PURE_MAX_PEAK_BYTES = 64 * 1024 * 1024
_HTTP_MAX_P95_MS = 600.0
_MAX_ROUND_TRIPS = 9
_MAX_SELECT_COUNT = 8
_MAX_RESPONSE_BYTES = 256 * 1024
_DEFAULT_OUTPUT = (
    _REPO_ROOT / "docs" / "evidence" / "phase-4-history-backbone-diff" / "G003" / "run.json"
)


@dataclass(frozen=True, slots=True)
class _SeededFixture:
    project_id: int
    first_layer_key: str
    invariants: Mapping[str, int]


class _StatementRecorder:
    """Capture statements only for the currently measured HTTP request."""

    def __init__(self) -> None:
        self._current: list[str] | None = None

    def begin(self) -> None:
        if self._current is not None:
            raise RuntimeError("statement capture is already active")
        self._current = []

    def finish(self) -> tuple[str, ...]:
        if self._current is None:
            raise RuntimeError("statement capture is not active")
        statements = tuple(self._current)
        self._current = None
        return statements

    def abort(self) -> None:
        self._current = None

    def capture(
        self,
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if self._current is not None:
            self._current.append(statement)


def _parameter_type(index: int) -> ValueType:
    return (ValueType.NUMBER, ValueType.TEXT, ValueType.CHOICE, ValueType.TEXT)[index % 4]


def _baseline_value(index: int) -> str:
    value_type = _parameter_type(index)
    if value_type is ValueType.NUMBER:
        return f"{index}.00"
    if value_type is ValueType.CHOICE:
        return f"choice_{index % 4}"
    return f"baseline-{index:03d}"


def _is_changed(index: int) -> bool:
    return index % 10 == index // 50


def _is_cleared(index: int) -> bool:
    return index % 20 == 7


def _current_value(index: int) -> str | None:
    if _is_cleared(index):
        return None
    if not _is_changed(index):
        return _baseline_value(index)
    value_type = _parameter_type(index)
    if value_type is ValueType.NUMBER:
        return f"{index + 1}.50"
    if value_type is ValueType.CHOICE:
        return f"choice_{(index + 1) % 4}"
    return f"changed-{index:03d}"


def _parameter_code(index: int) -> str:
    return f"p{index:03d}"


def _layer_key(layer_index: int) -> str:
    return f"layer-{layer_index:03d}"


def _snapshot(layer_index: int) -> dict[str, Any]:
    layer_id = layer_index + 1
    layer_key = _layer_key(layer_index)
    columns = tuple(
        BackboneSnapshotColumn(
            parameter_code=_parameter_code(index),
            value_type=_parameter_type(index),
            display_name=f"Parameter {index:03d}",
            category_code="perf" if index % 5 == 0 else None,
            sort_order=index,
            active_at_capture=True,
        )
        for index in range(_PARAMETER_COUNT)
    )
    cells = tuple(
        BackboneSnapshotCell(
            parameter_code=_parameter_code(index),
            value=_baseline_value(index),
        )
        for index in range(_PARAMETER_COUNT)
    )
    return serialize_backbone_snapshot(
        BackboneSnapshot(
            capture_batch_id=f"{layer_id:032x}",
            captured_at=datetime(2026, 7, 17, tzinfo=UTC),
            source=BackboneSnapshotSource(
                project_id=_PROJECT_ID,
                sheet_layer_id=layer_id,
                layer_key=layer_key,
                step_seq=str(layer_index + 1),
                layer_id=f"layer-id-{layer_index:03d}",
            ),
            columns=columns,
            conditions=(
                BackboneSnapshotCondition(
                    source_condition_id=10_000 + layer_index,
                    label="baseline",
                    condition_index=0,
                    is_por=True,
                    cells=cells,
                ),
            ),
        )
    )


async def _seed_fixture(engine: AsyncEngine) -> _SeededFixture:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await connection.execute(
            sa.insert(ChoiceSet),
            [{"id": 1, "code": "perf_choices", "display_name": "Perf choices"}],
        )
        await connection.execute(
            sa.insert(ParameterCategory),
            [{"id": 1, "code": "perf", "display_name": "Performance", "sort_order": 1}],
        )
        await connection.execute(
            sa.insert(Parameter),
            [
                {
                    "id": index + 1,
                    "code": _parameter_code(index),
                    "display_name": f"Parameter {index:03d}",
                    "value_type": _parameter_type(index),
                    "category_id": 1 if index % 5 == 0 else None,
                    "choice_set_id": 1 if _parameter_type(index) is ValueType.CHOICE else None,
                    "sort_order": index,
                    "is_active": True,
                }
                for index in range(_PARAMETER_COUNT)
            ],
        )
        await connection.execute(
            sa.insert(Project),
            [
                {
                    "id": _PROJECT_ID,
                    "line_id": "L1",
                    "process_id": "DIFF_PERF",
                    "part_id": "PART_PERF",
                    "name": "Backbone diff performance fixture",
                }
            ],
        )
        await connection.execute(
            sa.insert(SheetLayer),
            [
                {
                    "id": layer_index + 1,
                    "project_id": _PROJECT_ID,
                    "layer_key": _layer_key(layer_index),
                    "step_seq": str(layer_index + 1),
                    "layer_id": f"layer-id-{layer_index:03d}",
                    "sort_order": layer_index,
                    "source_project_id": _PROJECT_ID,
                    "source_layer_key": _layer_key(layer_index),
                    "backbone_snapshot": _snapshot(layer_index),
                }
                for layer_index in range(_LAYER_COUNT)
            ],
        )
        await connection.execute(
            sa.insert(LayerCondition),
            [
                {
                    "id": layer_index + 1,
                    "layer_id": layer_index + 1,
                    "label": "baseline",
                    "condition_index": 0,
                    "is_por": True,
                    "source_condition_id": 10_000 + layer_index,
                }
                for layer_index in range(_LAYER_COUNT)
            ],
        )
        await connection.execute(
            sa.insert(CellValue),
            [
                {
                    "condition_id": layer_index + 1,
                    "parameter_code": _parameter_code(parameter_index),
                    "value_text": _current_value(parameter_index),
                }
                for layer_index in range(_LAYER_COUNT)
                for parameter_index in range(_PARAMETER_COUNT)
            ],
        )

        invariants = {
            "project_count": int(
                await connection.scalar(sa.select(sa.func.count()).select_from(Project.__table__))
                or 0
            ),
            "layer_count": int(
                await connection.scalar(
                    sa.select(sa.func.count()).select_from(SheetLayer.__table__)
                )
                or 0
            ),
            "condition_count": int(
                await connection.scalar(
                    sa.select(sa.func.count()).select_from(LayerCondition.__table__)
                )
                or 0
            ),
            "parameter_count": int(
                await connection.scalar(sa.select(sa.func.count()).select_from(Parameter.__table__))
                or 0
            ),
            "coordinate_count": int(
                await connection.scalar(sa.select(sa.func.count()).select_from(CellValue.__table__))
                or 0
            ),
            "number_parameter_count": int(
                await connection.scalar(
                    sa.select(sa.func.count())
                    .select_from(Parameter.__table__)
                    .where(Parameter.value_type == ValueType.NUMBER)
                )
                or 0
            ),
            "text_parameter_count": int(
                await connection.scalar(
                    sa.select(sa.func.count())
                    .select_from(Parameter.__table__)
                    .where(Parameter.value_type == ValueType.TEXT)
                )
                or 0
            ),
            "choice_parameter_count": int(
                await connection.scalar(
                    sa.select(sa.func.count())
                    .select_from(Parameter.__table__)
                    .where(Parameter.value_type == ValueType.CHOICE)
                )
                or 0
            ),
            "null_coordinate_count": int(
                await connection.scalar(
                    sa.select(sa.func.count())
                    .select_from(CellValue.__table__)
                    .where(CellValue.value_text.is_(None))
                )
                or 0
            ),
        }

    expected = {
        "project_count": 1,
        "layer_count": _LAYER_COUNT,
        "condition_count": _CONDITION_COUNT,
        "parameter_count": _PARAMETER_COUNT,
        "coordinate_count": _COORDINATE_COUNT,
        "number_parameter_count": 50,
        "text_parameter_count": 100,
        "choice_parameter_count": 50,
        "null_coordinate_count": 1_000,
    }
    if invariants != expected:
        raise RuntimeError(f"fixture invariant mismatch: {invariants!r}")
    return _SeededFixture(
        project_id=_PROJECT_ID,
        first_layer_key=_layer_key(0),
        invariants=invariants,
    )


def _nearest_rank(samples: Sequence[float], percentile: float) -> float:
    if not samples:
        raise ValueError("nearest-rank requires at least one sample")
    ordered = sorted(samples)
    rank = max(1, math.ceil(percentile * len(ordered)))
    return ordered[rank - 1]


def _timing_summary(samples_ms: Sequence[float]) -> dict[str, Any]:
    samples = [round(sample, 6) for sample in samples_ms]
    return {
        "samples_ms": samples,
        "p50_ms": _nearest_rank(samples, 0.50),
        "p95_ms": _nearest_rank(samples, 0.95),
        "max_ms": max(samples),
    }


async def _verify_transaction(engine: AsyncEngine) -> dict[str, str]:
    read_engine = engine.execution_options(isolation_level="REPEATABLE READ")
    async with read_engine.connect() as connection:
        async with connection.begin():
            await connection.execute(sa.text("SET TRANSACTION READ ONLY"))
            isolation = str(
                (await connection.execute(sa.text("SHOW transaction_isolation"))).scalar_one()
            )
            read_only = str(
                (await connection.execute(sa.text("SHOW transaction_read_only"))).scalar_one()
            )
    if isolation != "repeatable read" or read_only != "on":
        raise RuntimeError(
            f"unexpected transaction settings: isolation={isolation!r}, read_only={read_only!r}"
        )
    return {
        "isolation": isolation,
        "read_only": read_only,
        "setup_statement": "SET TRANSACTION READ ONLY",
    }


async def _load_pure_input(engine: AsyncEngine, project_id: int) -> BackboneDiffProjectInput:
    factory = build_read_only_sessionmaker(engine)
    return await load_diff_input_with_session_factory(project_id, factory)


def _measure_pure(diff_input: BackboneDiffProjectInput) -> dict[str, Any]:
    result = compare_backbone(diff_input.layers)
    del result
    gc.collect()
    durations_ms: list[float] = []
    gc_was_enabled = gc.isenabled()
    gc.disable()
    try:
        for _ in range(_MEASURED_RUNS):
            started = time.perf_counter()
            compare_backbone(diff_input.layers)
            durations_ms.append((time.perf_counter() - started) * 1000)
    finally:
        if gc_was_enabled:
            gc.enable()

    gc.collect()
    tracemalloc.start()
    try:
        memory_result = compare_backbone(diff_input.layers)
        current_bytes, peak_bytes = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    coordinate_count = sum(
        len(condition.cells)
        for layer in diff_input.layers
        for condition in layer.current_conditions
    )
    metric = _timing_summary(durations_ms)
    metric.update(
        {
            "warmup_runs": _WARMUP_RUNS,
            "measured_runs": _MEASURED_RUNS,
            "layer_count": len(memory_result.layer_results),
            "coordinate_count": coordinate_count,
            "current_bytes": current_bytes,
            "peak_bytes": peak_bytes,
            "classification_counts": {
                "added": sum(layer.added_cell_count for layer in memory_result.layer_results),
                "changed": sum(layer.changed_cell_count for layer in memory_result.layer_results),
                "cleared": sum(layer.cleared_cell_count for layer in memory_result.layer_results),
                "removed": sum(layer.removed_cell_count for layer in memory_result.layer_results),
                "unchanged": sum(
                    layer.unchanged_cell_count for layer in memory_result.layer_results
                ),
            },
        }
    )
    return metric


async def _load_and_measure_pure(database_url: str, project_id: int) -> dict[str, Any]:
    """Measure pure compute in a fresh process, outside setup/API allocator state."""

    engine = create_async_engine(database_url, pool_pre_ping=True)
    try:
        diff_input = await _load_pure_input(engine, project_id)
        return _measure_pure(diff_input)
    finally:
        await engine.dispose()


def _measure_pure_isolated(database_url: str, project_id: int) -> dict[str, Any]:
    child_url_key = "BACKBONE_DIFF_PERF_CHILD_DATABASE_URL"
    child_code = (
        "import asyncio,json,os; "
        "from scripts.measure_backbone_diff_perf import _load_and_measure_pure; "
        f"print(json.dumps(asyncio.run(_load_and_measure_pure(os.environ['{child_url_key}'], "
        f"{project_id}))))"
    )
    env = os.environ.copy()
    env[child_url_key] = database_url
    env.pop("COVERAGE_FILE", None)
    env.pop("COVERAGE_PROCESS_START", None)
    env.pop("COVERAGE_RCFILE", None)
    completed = subprocess.run(
        [sys.executable, "-c", child_code],
        cwd=_BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "isolated pure benchmark failed: " + (completed.stderr or completed.stdout)
        )
    metric = json.loads(completed.stdout.strip().splitlines()[-1])
    if not isinstance(metric, dict):
        raise RuntimeError("isolated pure benchmark returned a non-object payload")
    return metric


def _select_count(statements: Sequence[str]) -> int:
    return sum(statement.lstrip().upper().startswith("SELECT") for statement in statements)


def _setup_is_first(statements: Sequence[str]) -> bool:
    return bool(statements) and statements[0].strip().upper() == "SET TRANSACTION READ ONLY"


async def _timed_gets(
    client: AsyncClient,
    recorder: _StatementRecorder,
    *,
    path: str,
    params: Mapping[str, str | int | bool],
    item_count: Callable[[dict[str, Any]], int],
) -> dict[str, Any]:
    durations_ms: list[float] = []
    round_trips: list[int] = []
    select_counts: list[int] = []
    response_bytes: list[int] = []
    status_codes: list[int] = []
    item_counts: list[int] = []
    setup_first: list[bool] = []

    for _ in range(_MEASURED_RUNS):
        recorder.begin()
        try:
            started = time.perf_counter()
            response = await client.get(path, params=params)
            elapsed_ms = (time.perf_counter() - started) * 1000
            statements = recorder.finish()
        except BaseException:
            recorder.abort()
            raise
        if response.status_code != 200:
            raise RuntimeError(f"{path} returned {response.status_code}: {response.text[:1000]}")
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError(f"{path} returned a non-object JSON response")
        durations_ms.append(elapsed_ms)
        round_trips.append(len(statements))
        select_counts.append(_select_count(statements))
        response_bytes.append(len(response.content))
        status_codes.append(response.status_code)
        item_counts.append(item_count(payload))
        setup_first.append(_setup_is_first(statements))

    if len(set(item_counts)) != 1:
        raise RuntimeError(f"{path} returned unstable item counts: {item_counts!r}")
    metric = _timing_summary(durations_ms)
    metric.update(
        {
            "warmup_runs": _WARMUP_RUNS,
            "measured_runs": _MEASURED_RUNS,
            "path": path,
            "round_trips": round_trips,
            "max_round_trips": max(round_trips),
            "select_counts": select_counts,
            "max_select_count": max(select_counts),
            "response_bytes": response_bytes,
            "max_response_bytes": max(response_bytes),
            "status_codes": status_codes,
            "setup_statement_first": all(setup_first),
            "item_count": item_counts[0],
        }
    )
    return metric


def _root_item_count(payload: dict[str, Any]) -> int:
    items = payload.get("changed_preview")
    if not isinstance(items, list):
        raise RuntimeError("root response has no changed_preview list")
    return len(items)


def _page_item_count(payload: dict[str, Any]) -> int:
    items = payload.get("items")
    if not isinstance(items, list):
        raise RuntimeError("branch response has no items list")
    return len(items)


def _object_list(payload: Mapping[str, Any], key: str) -> list[dict[str, Any]]:
    value = payload.get(key)
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise RuntimeError(f"response has no object list at {key}")
    return value


async def _require_ok(response: Response, label: str) -> dict[str, Any]:
    if response.status_code != 200:
        raise RuntimeError(
            f"{label} warmup returned {response.status_code}: {response.text[:1000]}"
        )
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError(f"{label} warmup returned a non-object JSON response")
    return payload


async def _measure_http(
    engine: AsyncEngine,
    fixture: _SeededFixture,
) -> dict[str, dict[str, Any]]:
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_app_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    application = create_app()
    application.dependency_overrides[get_app_session] = override_get_app_session
    recorder = _StatementRecorder()
    event.listen(engine.sync_engine, "before_cursor_execute", recorder.capture)
    transport = ASGITransport(app=application)
    try:
        async with AsyncClient(transport=transport, base_url="http://perf") as client:
            root_path = f"/api/projects/{fixture.project_id}/backbone-diff"
            root_params: dict[str, str | int | bool] = {
                "include_unchanged": "true",
                "preview_limit": 20,
            }
            root_warm = await _require_ok(
                await client.get(root_path, params=root_params),
                "root",
            )
            layer_summaries = _object_list(root_warm, "layer_summaries")
            if len(layer_summaries) != _LAYER_COUNT:
                raise RuntimeError("root warmup did not return all 100 layer summaries")
            first_layer = layer_summaries[0]
            branch_scope = first_layer.get("branch_scope")
            if not isinstance(branch_scope, str):
                raise RuntimeError("root warmup did not return a branch scope")
            root_metric = await _timed_gets(
                client,
                recorder,
                path=root_path,
                params=root_params,
                item_count=_root_item_count,
            )
            root_metric["requested_preview_limit"] = 20

            encoded_layer_key = quote(fixture.first_layer_key, safe="")
            condition_path = (
                f"/api/projects/{fixture.project_id}/backbone-diff/layers/"
                f"{encoded_layer_key}/conditions"
            )
            condition_params: dict[str, str | int | bool] = {
                "scope": branch_scope,
                "limit": 50,
            }
            condition_warm = await _require_ok(
                await client.get(condition_path, params=condition_params),
                "condition",
            )
            condition_items = _object_list(condition_warm, "items")
            if len(condition_items) != 1:
                raise RuntimeError("condition warmup did not return the fixture row")
            row_ref = condition_items[0].get("row_ref")
            cell_scope = condition_items[0].get("cell_scope")
            if not isinstance(row_ref, str) or not isinstance(cell_scope, str):
                raise RuntimeError("condition warmup did not return cell selectors")
            condition_metric = await _timed_gets(
                client,
                recorder,
                path=condition_path,
                params=condition_params,
                item_count=_page_item_count,
            )
            condition_metric["requested_limit"] = 50

            encoded_row_ref = quote(row_ref, safe="")
            cell_path = (
                f"/api/projects/{fixture.project_id}/backbone-diff/layers/"
                f"{encoded_layer_key}/conditions/{encoded_row_ref}/cells"
            )
            cell_params: dict[str, str | int | bool] = {
                "scope": cell_scope,
                "limit": 100,
            }
            cell_warm = await _require_ok(
                await client.get(cell_path, params=cell_params),
                "cell",
            )
            if _page_item_count(cell_warm) != 100:
                raise RuntimeError("cell warmup did not fill the requested 100-item page")
            cell_metric = await _timed_gets(
                client,
                recorder,
                path=cell_path,
                params=cell_params,
                item_count=_page_item_count,
            )
            cell_metric["requested_limit"] = 100
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", recorder.capture)
        application.dependency_overrides.pop(get_app_session, None)

    return {
        "root_preview_20": root_metric,
        "condition_limit_50": condition_metric,
        "cell_limit_100": cell_metric,
    }


def _fixture_report(invariants: Mapping[str, int]) -> dict[str, Any]:
    changed_per_layer = sum(_is_changed(index) for index in range(_PARAMETER_COUNT))
    cleared_per_layer = sum(_is_cleared(index) for index in range(_PARAMETER_COUNT))
    changed_coordinates = changed_per_layer * _LAYER_COUNT
    cleared_coordinates = cleared_per_layer * _LAYER_COUNT
    non_unchanged = changed_coordinates + cleared_coordinates
    return {
        "seed": _FIXTURE_SEED,
        **invariants,
        "value_kinds": ["number", "text", "choice", "null"],
        "changed_coordinate_count": changed_coordinates,
        "cleared_coordinate_count": cleared_coordinates,
        "non_unchanged_coordinate_count": non_unchanged,
        "non_unchanged_ratio": non_unchanged / _COORDINATE_COUNT,
    }


def _thresholds() -> dict[str, Any]:
    return {
        "pure_diff_20k": {
            "p95_ms_max": _PURE_MAX_P95_MS,
            "peak_bytes_max": _PURE_MAX_PEAK_BYTES,
        },
        "http_each": {
            "p95_ms_max": _HTTP_MAX_P95_MS,
            "round_trips_max": _MAX_ROUND_TRIPS,
            "select_count_max": _MAX_SELECT_COUNT,
            "response_bytes_max": _MAX_RESPONSE_BYTES,
        },
    }


def _failures(metrics: Mapping[str, Mapping[str, Any]]) -> list[str]:
    failures: list[str] = []
    pure = metrics["pure_diff_20k"]
    if int(pure["layer_count"]) != _LAYER_COUNT:
        failures.append(f"pure_diff_20k layer count is {pure['layer_count']}, expected 100")
    if int(pure["coordinate_count"]) != _COORDINATE_COUNT:
        failures.append(
            f"pure_diff_20k coordinate count is {pure['coordinate_count']}, expected 20000"
        )
    expected_classifications = {
        "added": 0,
        "changed": 2_000,
        "cleared": 1_000,
        "removed": 0,
        "unchanged": 17_000,
    }
    if pure["classification_counts"] != expected_classifications:
        failures.append(
            "pure_diff_20k classification counts are "
            f"{pure['classification_counts']!r}, expected {expected_classifications!r}"
        )
    if float(pure["p95_ms"]) > _PURE_MAX_P95_MS:
        failures.append(f"pure_diff_20k p95 {pure['p95_ms']}ms exceeds {_PURE_MAX_P95_MS}ms")
    if int(pure["peak_bytes"]) > _PURE_MAX_PEAK_BYTES:
        failures.append(
            f"pure_diff_20k peak {pure['peak_bytes']} exceeds {_PURE_MAX_PEAK_BYTES} bytes"
        )

    for label in ("root_preview_20", "condition_limit_50", "cell_limit_100"):
        metric = metrics[label]
        if float(metric["p95_ms"]) > _HTTP_MAX_P95_MS:
            failures.append(f"{label} p95 {metric['p95_ms']}ms exceeds {_HTTP_MAX_P95_MS}ms")
        if int(metric["max_round_trips"]) > _MAX_ROUND_TRIPS:
            failures.append(f"{label} trips {metric['max_round_trips']} exceeds {_MAX_ROUND_TRIPS}")
        if int(metric["max_select_count"]) > _MAX_SELECT_COUNT:
            failures.append(
                f"{label} SELECTs {metric['max_select_count']} exceeds {_MAX_SELECT_COUNT}"
            )
        if int(metric["max_response_bytes"]) > _MAX_RESPONSE_BYTES:
            failures.append(
                f"{label} response {metric['max_response_bytes']} exceeds "
                f"{_MAX_RESPONSE_BYTES} bytes"
            )
        if not bool(metric["setup_statement_first"]):
            failures.append(f"{label} did not execute SET TRANSACTION READ ONLY first")
    expected_items = {
        "root_preview_20": 20,
        "condition_limit_50": 1,
        "cell_limit_100": 100,
    }
    for label, expected in expected_items.items():
        actual = int(metrics[label]["item_count"])
        if actual != expected:
            failures.append(f"{label} returned {actual} items, expected {expected}")
    return failures


async def _run_in_database(database: TemporaryPostgresDatabase) -> dict[str, Any]:
    engine = create_async_engine(database.async_url, pool_pre_ping=True)
    try:
        fixture = await _seed_fixture(engine)
        transaction = await _verify_transaction(engine)
        pure_metric = await asyncio.to_thread(
            _measure_pure_isolated,
            database.async_url,
            fixture.project_id,
        )
        http_metrics = await _measure_http(engine, fixture)
    finally:
        await engine.dispose()

    metrics = {"pure_diff_20k": pure_metric, **http_metrics}
    failures = _failures(metrics)
    return {
        "schema_version": _SCHEMA_VERSION,
        "status": "failed" if failures else "passed",
        "command": (
            "cd backend && APP_TEST_DATABASE_URL='<guard-admin-url>' "
            "uv run python -m scripts.measure_backbone_diff_perf"
        ),
        "source": {
            "git_sha": _git("rev-parse", "HEAD"),
            "git_status_short": _git("status", "--short").splitlines(),
        },
        "runtime": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "cpu_count": os.cpu_count(),
            "load_average": list(os.getloadavg()),
            "captured_at_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        },
        "protocol": {
            "warmup_runs": _WARMUP_RUNS,
            "measured_runs": _MEASURED_RUNS,
            "percentile_method": "nearest-rank-ceiling",
            "pure_timing_gc_enabled": False,
        },
        "database": {
            "guarded": True,
            "database_name": database.name,
            "dropped": False,
            "transaction": transaction,
        },
        "fixture": _fixture_report(fixture.invariants),
        "thresholds": _thresholds(),
        "metrics": metrics,
        "failures": failures,
    }


def _git(*args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=_REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return completed.stdout.strip()


def _write_report(path: Path, report: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=_DEFAULT_OUTPUT,
        help=f"JSON evidence path (default: {_DEFAULT_OUTPUT})",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if not os.environ.get("APP_TEST_DATABASE_URL"):
        raise SystemExit("APP_TEST_DATABASE_URL is required for the guarded PostgreSQL run")

    with temporary_postgres_database() as database:
        report = asyncio.run(_run_in_database(database))
    report["database"]["dropped"] = True
    _write_report(args.output, report)
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    return 1 if report["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
