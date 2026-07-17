"""Pure backbone diff performance gate for the 20k-cell engine."""

from __future__ import annotations

import json
import os
import subprocess
import sys

from app.domain.backbone.diff import (
    BackboneDiffCurrentCell,
    BackboneDiffCurrentCondition,
    BackboneDiffCurrentLayerSource,
    BackboneDiffCurrentParameter,
    BackboneDiffLayerInput,
)
from app.domain.backbone.snapshot import (
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
)
from app.domain.parameters.types import ValueType

_LAYER_COUNT = 100
_PARAMETER_COUNT = 200
_ITERATION_COUNT = 5
_MAX_P95_MS = 250.0
_MAX_PEAK_BYTES = 64 * 1024 * 1024


def _build_fixture(*, run_seed: int) -> tuple[BackboneDiffLayerInput, ...]:
    parameters = tuple(
        BackboneDiffCurrentParameter(
            code=f"p{i:03d}",
            value_type=(
                ValueType.NUMBER
                if i % 3 == 0
                else ValueType.TEXT
                if i % 3 == 1
                else ValueType.CHOICE
            ),
            display_name=f"Param {i:03d}",
            category_code=f"cat{i % 7:02d}",
            sort_order=i,
            active=True,
        )
        for i in range(_PARAMETER_COUNT)
    )
    columns = tuple(
        BackboneSnapshotColumn(
            parameter_code=parameter.code,
            value_type=parameter.value_type,
            display_name=parameter.display_name,
            category_code=parameter.category_code,
            sort_order=parameter.sort_order,
            active_at_capture=True,
        )
        for parameter in parameters
    )
    baseline_snapshot = BackboneSnapshot(
        capture_batch_id="0123456789abcdef0123456789abcdef",
        captured_at="2026-07-17T00:00:00Z",
        source=BackboneSnapshotSource(
            project_id=1,
            sheet_layer_id=1,
            layer_key="layer",
            step_seq="1",
            layer_id="layer-id",
        ),
        columns=columns,
        conditions=(
            BackboneSnapshotCondition(
                source_condition_id=1,
                label="baseline",
                condition_index=0,
                is_por=False,
                cells=tuple(
                    BackboneSnapshotCell(
                        parameter_code=parameter.code,
                        value=(
                            f"{i}.00"
                            if parameter.value_type is ValueType.NUMBER
                            else f"baseline-{i:03d}"
                        ),
                    )
                    for i, parameter in enumerate(parameters)
                ),
            ),
        ),
    )
    layers: list[BackboneDiffLayerInput] = []
    for layer_idx in range(_LAYER_COUNT):
        current_cells = []
        for i, parameter in enumerate(parameters):
            if (i + layer_idx + run_seed) % 10 == 0:
                current_value = None
            elif (i + run_seed) % 10 in (1, 2):
                current_value = (
                    f"{i + layer_idx + run_seed}.50"
                    if parameter.value_type is ValueType.NUMBER
                    else (
                        f"choice-{(i + run_seed) % 5}"
                        if parameter.value_type is ValueType.CHOICE
                        else f"v-{run_seed}-{layer_idx}-{i}"
                    )
                )
            else:
                current_value = (
                    f"{i}.00"
                    if parameter.value_type is ValueType.NUMBER
                    else f"choice-{i % 4}"
                    if parameter.value_type is ValueType.CHOICE
                    else f"baseline-{i:03d}"
                )
            current_cells.append(
                BackboneDiffCurrentCell(
                    parameter_code=parameter.code,
                    value=current_value,
                )
            )
        layers.append(
            BackboneDiffLayerInput(
                layer_key=f"layer-{layer_idx:03d}",
                layer_sort_order=layer_idx,
                current_source=BackboneDiffCurrentLayerSource(
                    project_id=1,
                    sheet_layer_id=1,
                    layer_key=f"layer-{layer_idx:03d}",
                    step_seq=str(layer_idx + 1),
                    layer_id=f"layer-id-{layer_idx:03d}",
                    sort_order=layer_idx,
                    source_project_id=1,
                    source_layer_key="layer",
                ),
                baseline_snapshot=baseline_snapshot,
                current_conditions=(
                    BackboneDiffCurrentCondition(
                        id=run_seed * 1000 + layer_idx + 1,
                        source_condition_id=1,
                        label="baseline",
                        condition_index=0,
                        is_por=False,
                        cells=tuple(current_cells),
                    ),
                ),
                current_parameters=parameters,
            )
        )
    return tuple(layers)


def test_backbone_diff_pure_engine_meets_20k_gate() -> None:
    script = """
from __future__ import annotations

import gc
import json
import statistics
import time
import tracemalloc

from tests.performance.test_backbone_diff_performance_pure import _build_fixture
from app.domain.backbone.diff import compare_backbone

graphs = [_build_fixture(run_seed=seed) for seed in range(6)]
result = compare_backbone(graphs[0])
gc.collect()

durations_ms = []
basis_hashes = [result.basis_hash]
gc_was_enabled = gc.isenabled()
gc.disable()
try:
    for graph in graphs[1:]:
        started = time.perf_counter()
        result = compare_backbone(graph)
        durations_ms.append((time.perf_counter() - started) * 1000)
        basis_hashes.append(result.basis_hash)
finally:
    if gc_was_enabled:
        gc.enable()

tracemalloc.start()
try:
    gc.collect()
    result = compare_backbone(graphs[-1])
    current_bytes, peak_bytes = tracemalloc.get_traced_memory()
finally:
    tracemalloc.stop()

print(
    json.dumps(
        {
            "layer_count": len(result.layer_results),
            "matched_row_count": result.layer_results[0].matched_row_count,
            "item_count": result.layer_results[0].item_count,
            "sample_count": len(durations_ms),
            "p50_ms": statistics.median(durations_ms),
            "p95_ms": statistics.quantiles(durations_ms, n=20, method="inclusive")[18],
            "max_ms": max(durations_ms),
            "basis_hashes": basis_hashes,
            "peak_bytes": peak_bytes,
            "current_bytes": current_bytes,
        }
    )
)
"""
    env = os.environ.copy()
    env.pop("COVERAGE_FILE", None)
    env.pop("COVERAGE_PROCESS_START", None)
    env.pop("COVERAGE_RCFILE", None)
    completed = subprocess.run(
        [sys.executable, "-c", script],
        check=True,
        env=env,
        capture_output=True,
        text=True,
    )
    metrics = json.loads(completed.stdout)

    assert metrics["layer_count"] == _LAYER_COUNT
    assert metrics["matched_row_count"] == 1
    assert metrics["item_count"] == _PARAMETER_COUNT
    assert metrics["sample_count"] == _ITERATION_COUNT
    assert len(set(metrics["basis_hashes"])) == _ITERATION_COUNT + 1
    assert metrics["p95_ms"] <= _MAX_P95_MS
    assert metrics["peak_bytes"] <= _MAX_PEAK_BYTES
    assert metrics["current_bytes"] <= metrics["peak_bytes"]
