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
    _prepare_database,
    _seed_history_fixture,
)
from tests.postgres_database import temporary_postgres_database

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL unset")


def test_history_fixture_is_exact_and_writer_shaped() -> None:
    assert _HISTORY_EVENT_COUNT == 100_000
    assert _BASE_EVENT_COUNT == 99_643
    assert _LAYER_COUNT == 100
    assert _PARAMETER_COUNT == 200
    assert _CELL_COUNT == 20_000
    assert _DETAIL_BATCH_SIZE == 100
    assert _PASTE_BATCH_SIZE == 200

    with temporary_postgres_database() as database:
        migration_db = _prepare_database(database)
        try:
            fixture = _seed_history_fixture(migration_db.connection)
            assert fixture.invariants == {
                "project_count": 1,
                "measured_event_count": 100_000,
                "total_event_count": 100_000,
                "layer_count": 100,
                "condition_count": 100,
                "parameter_count": 200,
                "cell_count": 20_000,
                "min_cells_per_condition": 200,
                "max_cells_per_condition": 200,
                "deleted_condition_count": 0,
                "writer_shape_count": 7,
                "v2_capture_count": 1,
                "v1_capture_count": 1,
            }
        finally:
            migration_db.connection.close()
            migration_db.connection.engine.dispose()
