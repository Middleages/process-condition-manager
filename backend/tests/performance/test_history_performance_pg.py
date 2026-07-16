"""Binding performance-budget regressions for the Phase 4 history gate."""

from __future__ import annotations

import os

import pytest

from scripts.benchmark_history import (
    _BASE_EVENT_COUNT,
    _CELL_HISTORY_MAX_MS,
    _CELL_HISTORY_MAX_SQL,
    _DETAIL_BATCH_SIZE,
    _DETAIL_MAX_MS,
    _DETAIL_MAX_SQL,
    _HISTORY_EVENT_COUNT,
    _PASTE_BATCH_SIZE,
    _PAGE_BYTE_LIMIT,
    _TIMELINE_MAX_MS,
    _TIMELINE_MAX_SQL,
    QueryBenchmark,
    _assert_query_budget,
    _build_report,
)

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")


def test_history_limits_are_exact_and_inclusive() -> None:
    assert _HISTORY_EVENT_COUNT == 100_000
    assert _DETAIL_BATCH_SIZE == 100
    assert _PASTE_BATCH_SIZE == 200
    assert _BASE_EVENT_COUNT == 99_696
    assert _TIMELINE_MAX_MS == 250.0
    assert _TIMELINE_MAX_SQL == 4
    assert _DETAIL_MAX_MS == 250.0
    assert _DETAIL_MAX_SQL == 3
    assert _CELL_HISTORY_MAX_MS == 150.0
    assert _CELL_HISTORY_MAX_SQL == 3

    exact = QueryBenchmark(
        label="timeline",
        samples=5,
        p50_ms=_TIMELINE_MAX_MS,
        p95_ms=_TIMELINE_MAX_MS,
        max_ms=_TIMELINE_MAX_MS,
        max_sql_count=_TIMELINE_MAX_SQL,
        max_serialized_bytes=_PAGE_BYTE_LIMIT,
    )
    _assert_query_budget(
        exact,
        max_ms=_TIMELINE_MAX_MS,
        max_sql_count=_TIMELINE_MAX_SQL,
    )


@pytest.mark.parametrize(
    ("label", "benchmark", "max_ms", "max_sql_count"),
    [
        (
            "timeline",
            QueryBenchmark(
                label="timeline",
                samples=5,
                p50_ms=_TIMELINE_MAX_MS + 0.001,
                p95_ms=_TIMELINE_MAX_MS,
                max_ms=_TIMELINE_MAX_MS,
                max_sql_count=_TIMELINE_MAX_SQL,
                max_serialized_bytes=_PAGE_BYTE_LIMIT,
            ),
            _TIMELINE_MAX_MS,
            _TIMELINE_MAX_SQL,
        ),
        (
            "detail",
            QueryBenchmark(
                label="detail",
                samples=5,
                p50_ms=_DETAIL_MAX_MS,
                p95_ms=_DETAIL_MAX_MS,
                max_ms=_DETAIL_MAX_MS,
                max_sql_count=_DETAIL_MAX_SQL + 1,
                max_serialized_bytes=_PAGE_BYTE_LIMIT,
            ),
            _DETAIL_MAX_MS,
            _DETAIL_MAX_SQL,
        ),
        (
            "cell_history",
            QueryBenchmark(
                label="cell_history",
                samples=5,
                p50_ms=_CELL_HISTORY_MAX_MS,
                p95_ms=_CELL_HISTORY_MAX_MS,
                max_ms=_CELL_HISTORY_MAX_MS,
                max_sql_count=_CELL_HISTORY_MAX_SQL,
                max_serialized_bytes=_PAGE_BYTE_LIMIT + 1,
            ),
            _CELL_HISTORY_MAX_MS,
            _CELL_HISTORY_MAX_SQL,
        ),
    ],
)
def test_history_gate_rejects_values_just_above_each_limit(
    label: str, benchmark: QueryBenchmark, max_ms: float, max_sql_count: int
) -> None:
    with pytest.raises(AssertionError):
        _assert_query_budget(benchmark, max_ms=max_ms, max_sql_count=max_sql_count)


def test_history_report_shape_is_well_formed() -> None:
    report = _build_report(warmup_runs=0, timed_runs=1, compare_paste_overhead=False)

    assert report["binding_mode"] == "sql_contracts"
    assert "RED handoff" in report["red_handoff"]
    assert report["fixture"]["event_count"] == 100_000
    assert report["fixture"]["layer_count"] == 100
    assert report["fixture"]["parameter_count"] == 200
    assert report["timeline_unfiltered"].max_sql_count <= _TIMELINE_MAX_SQL
    assert report["timeline_layer_filtered"].max_sql_count <= _TIMELINE_MAX_SQL
    assert report["batch_detail"].max_sql_count <= _DETAIL_MAX_SQL
    assert report["cell_history_current"].max_sql_count <= _CELL_HISTORY_MAX_SQL
    assert report["cell_history_deleted"].max_sql_count <= _CELL_HISTORY_MAX_SQL
    assert "ix_change_event_project_id_id_desc" in report["index_definitions"]
