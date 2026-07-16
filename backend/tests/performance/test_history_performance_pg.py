"""Guarded production-bound PostgreSQL performance gate for Phase 4 history."""

from __future__ import annotations

import os

import pytest

from scripts.benchmark_history import (
    _BASE_EVENT_COUNT,
    _CELL_COUNT,
    _DETAIL_BATCH_SIZE,
    _HISTORY_EVENT_COUNT,
    _LAYER_COUNT,
    _PARAMETER_COUNT,
    _PASTE_BATCH_SIZE,
    _TIMED_RUNS,
    _WARMUP_RUNS,
    QueryBenchmark,
    _build_report,
)

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL unset")


def test_history_contract_constants_are_exact() -> None:
    assert _HISTORY_EVENT_COUNT == 100_000
    assert _BASE_EVENT_COUNT == 99_643
    assert _LAYER_COUNT == 100
    assert _PARAMETER_COUNT == 200
    assert _CELL_COUNT == 20_000
    assert _DETAIL_BATCH_SIZE == 100
    assert _PASTE_BATCH_SIZE == 200
    assert _WARMUP_RUNS == 1
    assert _TIMED_RUNS == 5


@pytest.mark.asyncio
async def test_history_production_service_repository_gate() -> None:
    report = await _build_report(compare_paste_overhead=True)

    assert report["binding_mode"] == "production_service_repository"
    fixture = report["fixture"]
    assert fixture["project_count"] == 1
    assert fixture["measured_event_count"] == 100_000
    assert fixture["total_event_count"] == 100_000
    assert fixture["layer_count"] == 100
    assert fixture["condition_count"] == 100
    assert fixture["parameter_count"] == 200
    assert fixture["cell_count"] == 20_000
    assert fixture["min_cells_per_condition"] == 200
    assert fixture["max_cells_per_condition"] == 200
    assert fixture["deleted_condition_count"] == 0
    assert fixture["v1_capture_count"] == 1
    assert fixture["v2_capture_count"] == 1

    for label in (
        "timeline_unfiltered",
        "timeline_layer_filtered",
        "batch_detail",
        "cell_history_current",
        "cell_history_deleted",
    ):
        metric = report[label]
        assert isinstance(metric, QueryBenchmark)
        assert metric.samples == 5
        assert len(metric.sql_counts) == 5
        assert len(metric.serialized_bytes) == 5

    assert "paste_overhead" in report
    report_failures = report["failures"]
    assert report_failures == [], "\n".join(report_failures)
