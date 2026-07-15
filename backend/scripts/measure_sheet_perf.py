"""Bounded SheetOut query/payload measurement for a 200-column, 100-layer sheet."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 -- register every table with Base.metadata
from app.core.db import Base
from app.features.sheets.repository import SheetRepository
from app.features.sheets.service import SheetService
from scripts.seed_dev import seed_managed_choices, seed_parameters, seed_project

_NUM_LAYERS = 100
_NUM_PARAMETERS = 200
PERF_MAX_ELAPSED_MS = 700
PERF_MAX_SERIALIZED_BYTES = 1_500_000
PERF_MAX_SQL_QUERIES = 14


def _option_array_count(value: Any) -> int:
    if isinstance(value, dict):
        return sum(
            (len(item) if key in {"options", "choice_options"} and isinstance(item, list) else 0)
            + _option_array_count(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return sum(_option_array_count(item) for item in value)
    return 0


def assert_performance_limits(
    *, elapsed_ms: float, serialized_bytes: int, sql_queries: int
) -> None:
    """Enforce the binding, inclusive performance budgets."""

    assert elapsed_ms <= PERF_MAX_ELAPSED_MS, (
        f"elapsed {elapsed_ms:.1f}ms exceeds {PERF_MAX_ELAPSED_MS}ms"
    )
    assert serialized_bytes <= PERF_MAX_SERIALIZED_BYTES, (
        f"payload {serialized_bytes} bytes exceeds {PERF_MAX_SERIALIZED_BYTES} bytes"
    )
    assert sql_queries <= PERF_MAX_SQL_QUERIES, (
        f"query count {sql_queries} exceeds {PERF_MAX_SQL_QUERIES}"
    )


async def measure() -> None:
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    statements: list[str] = []

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def _record_query(_connection, _cursor, statement, _parameters, _context, _many) -> None:
        statements.append(statement)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        await seed_managed_choices(session, create_fixed_sets=True)
        codes = await seed_parameters(session, count=_NUM_PARAMETERS, category_count=5)
        project_id = await seed_project(
            session,
            parameter_codes=codes,
            num_layers=_NUM_LAYERS,
            multi_condition_every=0,
            fill_ratio=1.0,
        )
        await session.commit()

    async with session_factory() as session:
        await SheetService(SheetRepository(session)).get_sheet(project_id, user_id="perf-warmup")

    statements.clear()
    async with session_factory() as session:
        start = time.perf_counter()
        sheet = await SheetService(SheetRepository(session)).get_sheet(
            project_id, user_id="perf"
        )
        payload = sheet.model_dump_json()
        elapsed_ms = (time.perf_counter() - start) * 1000

    await engine.dispose()

    size_bytes = len(payload.encode("utf-8"))
    layer_count = len({row.layer_key for row in sheet.rows})
    choice_columns = [
        column for column in sheet.columns if column.choice_set_code is not None
    ]
    distinct_choice_sets = {
        column.choice_set_code for column in choice_columns
    }
    option_arrays = _option_array_count(sheet.model_dump(mode="json"))

    assert len(sheet.columns) == _NUM_PARAMETERS
    assert layer_count == _NUM_LAYERS
    assert distinct_choice_sets == {"equipment_mode"}
    assert len(choice_columns) > 1
    assert option_arrays == 0
    choice_option_queries = sum(
        "choice_option" in statement.lower() and "select" in statement.lower()
        for statement in statements
    )
    # Task 5's shared validation basis needs complete active/inactive identities,
    # but selectin loading must still fetch a shared set in one bounded query.
    assert choice_option_queries == 1
    assert_performance_limits(
        elapsed_ms=elapsed_ms,
        serialized_bytes=size_bytes,
        sql_queries=len(statements),
    )

    print("=== SheetOut managed-choice performance ===")
    print(f"distinct choice sets: {len(distinct_choice_sets)}")
    print(f"choice options in SheetOut payload (must be 0): {option_arrays}")
    print(f"columns sharing the large set: {len(choice_columns)}")
    print(f"choice-option basis queries (must be 1): {choice_option_queries}")
    print(f"serialized bytes: {size_bytes}")
    print(f"elapsed milliseconds: {elapsed_ms:.1f}")
    print(f"SQL queries (must be <= {PERF_MAX_SQL_QUERIES}): {len(statements)}")


if __name__ == "__main__":
    asyncio.run(measure())
