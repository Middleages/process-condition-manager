"""Binding performance-budget regressions for the representative SheetOut gate."""

import pytest

from scripts.measure_sheet_perf import (
    PERF_MAX_ELAPSED_MS,
    PERF_MAX_SERIALIZED_BYTES,
    PERF_MAX_SQL_QUERIES,
    assert_performance_limits,
)


def test_performance_limits_are_exact_and_inclusive() -> None:
    assert PERF_MAX_ELAPSED_MS == 700
    assert PERF_MAX_SERIALIZED_BYTES == 1_500_000
    assert PERF_MAX_SQL_QUERIES == 14

    assert_performance_limits(
        elapsed_ms=PERF_MAX_ELAPSED_MS,
        serialized_bytes=PERF_MAX_SERIALIZED_BYTES,
        sql_queries=PERF_MAX_SQL_QUERIES,
    )


@pytest.mark.parametrize(
    ("elapsed_ms", "serialized_bytes", "sql_queries"),
    [
        (700.001, 1_500_000, 14),
        (700, 1_500_001, 14),
        (700, 1_500_000, 15),
    ],
)
def test_performance_gate_rejects_values_just_above_each_limit(
    elapsed_ms: float, serialized_bytes: int, sql_queries: int
) -> None:
    with pytest.raises(AssertionError):
        assert_performance_limits(
            elapsed_ms=elapsed_ms,
            serialized_bytes=serialized_bytes,
            sql_queries=sql_queries,
        )
