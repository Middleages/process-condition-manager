"""Phase 4 history PostgreSQL performance gate.

This worktree does not yet have the read-only history slice integrated, so the
benchmark binds directly to the approved SQL contracts and emits an explicit RED
handoff note. The same fixture and measurement helpers can later be pointed at
the repository/service layer without changing the performance harness shape.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlalchemy import event
from sqlalchemy.engine import Connection, Engine

import app.models  # noqa: F401 -- register every model with Base metadata
from tests.postgres_database import TemporaryPostgresDatabase, temporary_postgres_database

_BACKEND_ROOT = Path(__file__).resolve().parents[1]

if __package__ in {None, ""}:
    sys.path.insert(0, str(_BACKEND_ROOT))

_HISTORY_EVENT_COUNT = 100_000
_DETAIL_BATCH_SIZE = 100
_PASTE_BATCH_SIZE = 200
_SPECIAL_HISTORY_EVENT_COUNT = 4
_BASE_EVENT_COUNT = (
    _HISTORY_EVENT_COUNT - _DETAIL_BATCH_SIZE - _PASTE_BATCH_SIZE - _SPECIAL_HISTORY_EVENT_COUNT
)
_LAYER_COUNT = 100
_PARAMETER_COUNT = 200
_TIMELINE_LIMIT = 50
_DETAIL_LIMIT = 100
_CELL_HISTORY_LIMIT = 50
_WARMUP_RUNS = 1
_TIMED_RUNS = 5
_PAGE_BYTE_LIMIT = 256 * 1024
_TIMELINE_MAX_MS = 250.0
_TIMELINE_MAX_SQL = 4
_DETAIL_MAX_MS = 250.0
_DETAIL_MAX_SQL = 3
_CELL_HISTORY_MAX_MS = 150.0
_CELL_HISTORY_MAX_SQL = 3
_PASTE_OVERHEAD_MAX_RATIO = 0.20


def _config(database: TemporaryPostgresDatabase) -> Config:
    config = Config(str(_BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(_BACKEND_ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", database.sync_url)
    return config


@dataclass(frozen=True, slots=True)
class MigrationDatabase:
    database: TemporaryPostgresDatabase
    connection: Connection

    def upgrade(self, target: str) -> None:
        config = _config(self.database)
        config.attributes["connection"] = self.connection
        try:
            self.connection.commit()
            command.upgrade(config, target)
        except Exception:
            self.connection.rollback()
            raise


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
class HistoryFixture:
    project_id: int
    current_condition_id: int
    current_parameter_code: str
    deleted_condition_id: int
    deleted_parameter_code: str
    layer_key: str
    detail_batch_id: str
    paste_batch_id: str
    source_project_id: int


@contextmanager
def _sql_counter(engine: Engine) -> Iterator[list[str]]:
    statements: list[str] = []

    def _record(
        _connection: sa.Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", _record)


def _json_bytes(rows: list[dict[str, Any]]) -> int:
    return len(json.dumps(rows, ensure_ascii=False, sort_keys=True).encode("utf-8"))


def _rows_as_dicts(rows: list[Any]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def _insert_scalar(connection: Connection, sql: str, params: dict[str, object] | None = None) -> int:
    return int(connection.execute(sa.text(sql), params or {}).scalar_one())


def _prepare_database(database: TemporaryPostgresDatabase, *, target: str = "head") -> MigrationDatabase:
    engine = sa.create_engine(database.sync_url, future=True)
    connection = engine.connect()
    migration_db = MigrationDatabase(database=database, connection=connection)
    migration_db.upgrade(target)
    return migration_db


def _seed_parameters(connection: Connection, *, count: int = _PARAMETER_COUNT) -> None:
    connection.execute(
        sa.text(
            """
            INSERT INTO parameter (code, display_name, description, value_type, sort_order)
            SELECT
                'param_' || lpad(gs::text, 3, '0'),
                'Parameter ' || gs::text,
                'history perf parameter ' || gs::text,
                'text',
                gs
            FROM generate_series(1, :count) AS gs
            """
        ),
        {"count": count},
    )


def _seed_layers_and_cells(connection: Connection, *, project_id: int) -> tuple[list[str], int, int]:
    layer_keys: list[str] = []
    current_condition_id = -1
    deleted_condition_id = -1
    for index in range(_LAYER_COUNT):
        layer_key = f"L1::HIST::{index:03d}::L{index:02d}"
        layer_id = _insert_scalar(
            connection,
            """
            INSERT INTO sheet_layer (project_id, layer_key, step_seq, layer_id, sort_order)
            VALUES (:project_id, :layer_key, :step_seq, :layer_id, :sort_order)
            RETURNING id
            """,
            {
                "project_id": project_id,
                "layer_key": layer_key,
                "step_seq": f"{index:03d}",
                "layer_id": f"L{index:02d}",
                "sort_order": index,
            },
        )
        condition_id = _insert_scalar(
            connection,
            """
            INSERT INTO layer_condition (layer_id, label, condition_index, is_por)
            VALUES (:layer_id, 'base', 1, true)
            RETURNING id
            """,
            {"layer_id": layer_id},
        )
        _insert_scalar(
            connection,
            """
            INSERT INTO cell_value (condition_id, parameter_code, value_text)
            VALUES (:condition_id, 'param_000', :value_text)
            RETURNING id
            """,
            {"condition_id": condition_id, "value_text": f"seed-{index:03d}"},
        )
        if index == 0:
            current_condition_id = condition_id
        layer_keys.append(layer_key)

    deleted_layer_id = _insert_scalar(
        connection,
        """
        INSERT INTO layer_condition (layer_id, label, condition_index, is_por)
        VALUES (
            (SELECT id FROM sheet_layer WHERE project_id = :project_id AND layer_key = :layer_key),
            'deleted',
            2,
            false
        )
        RETURNING id
        """,
        {"project_id": project_id, "layer_key": layer_keys[0]},
    )
    deleted_condition_id = deleted_layer_id
    _insert_scalar(
        connection,
        """
        INSERT INTO cell_value (condition_id, parameter_code, value_text)
        VALUES (:condition_id, 'param_001', 'deleted-seed')
        RETURNING id
        """,
        {"condition_id": deleted_condition_id},
    )
    return layer_keys, current_condition_id, deleted_condition_id


def _seed_bulk_events(
    connection: Connection,
    *,
    project_id: int,
    noise_project_id: int,
    source_layer_key: str,
    current_condition_id: int,
    deleted_condition_id: int,
) -> None:
    connection.execute(
        sa.text(
            """
            WITH generated AS (
                SELECT
                    gs,
                    CASE WHEN gs % 2 = 0 THEN :project_id ELSE :noise_project_id END AS project_id,
                    CASE (gs % 8)
                        WHEN 0 THEN 'cell_update'
                        WHEN 1 THEN 'project_create'
                        WHEN 2 THEN 'backbone_copy'
                        WHEN 3 THEN 'backbone_layer_replace'
                        WHEN 4 THEN 'condition_add'
                        WHEN 5 THEN 'condition_remove'
                        WHEN 6 THEN 'por_change'
                        ELSE 'project_profile_update'
                    END AS event_type,
                    CASE (gs % 4)
                        WHEN 0 THEN 'system'
                        WHEN 1 THEN 'planner'
                        WHEN 2 THEN 'dev-admin'
                        ELSE 'qa-bot'
                    END AS actor,
                    CASE (gs % 4)
                        WHEN 0 THEN 'manual'
                        WHEN 1 THEN 'paste'
                        WHEN 2 THEN 'backbone'
                        ELSE 'system'
                    END AS origin,
                    CASE WHEN gs % 5 = 0 THEN 'batch-timeline-' || lpad((gs / 5)::text, 6, '0') END AS batch_id,
                    CASE WHEN gs % 7 = 0 THEN :noise_project_id END AS source_project_id,
                    CASE WHEN gs % 7 = 0 THEN :source_layer_key END AS source_layer_key,
                    CASE WHEN gs % 8 = 0 THEN :current_condition_id ELSE :deleted_condition_id END AS condition_id,
                    CASE
                        WHEN gs % 8 = 0 THEN 'param_000'
                        WHEN gs % 8 = 1 THEN 'param_001'
                        ELSE 'param_' || lpad((gs % :parameter_count)::text, 3, '0')
                    END AS parameter_code,
                    CASE
                        WHEN gs % 8 = 0 THEN :source_layer_key
                        WHEN gs % 8 = 1 THEN :source_layer_key
                        ELSE 'L1::HIST::' || lpad(((gs - 1) % :layer_count)::text, 3, '0')
                             || '::L' || lpad(((gs - 1) % :layer_count)::text, 2, '0')
                    END AS layer_key,
                    CASE
                        WHEN gs % 8 = 0 THEN 'manual'
                        WHEN gs % 8 = 1 THEN 'paste'
                        WHEN gs % 8 = 2 THEN 'backbone'
                        ELSE 'system'
                    END AS origin_override,
                    CASE WHEN gs % 8 IN (0, 1) THEN 'value-' || gs::text END AS value_text
                FROM generate_series(1, :count) AS gs
            )
            INSERT INTO change_event (
                project_id,
                event_type,
                actor,
                payload,
                condition_id,
                parameter_code,
                old_value,
                new_value,
                layer_key,
                batch_id,
                origin,
                source_project_id,
                source_layer_key,
                created_at
            )
            SELECT
                project_id,
                event_type,
                actor,
                CASE event_type
                    WHEN 'cell_update' THEN jsonb_build_object(
                        'batch_id', batch_id,
                        'origin', origin_override,
                        'coordinate', jsonb_build_object(
                            'condition_id', condition_id,
                            'parameter_code', parameter_code
                        )
                    )
                    WHEN 'project_create' THEN jsonb_build_object(
                        'batch_id', batch_id,
                        'backbone_project_id', source_project_id
                    )
                    WHEN 'backbone_copy' THEN jsonb_build_object(
                        'batch_id', batch_id,
                        'backbone_project_id', source_project_id
                    )
                    WHEN 'backbone_layer_replace' THEN jsonb_build_object(
                        'batch_id', batch_id,
                        'target_layer_key', layer_key,
                        'source_project_id', source_project_id,
                        'source_layer_key', source_layer_key
                    )
                    WHEN 'condition_add' THEN jsonb_build_object(
                        'layer_key', layer_key,
                        'condition_id', condition_id
                    )
                    WHEN 'condition_remove' THEN jsonb_build_object(
                        'layer_key', layer_key,
                        'condition_id', condition_id
                    )
                    WHEN 'por_change' THEN jsonb_build_object(
                        'layer_key', layer_key,
                        'new_por_condition_id', condition_id
                    )
                    ELSE jsonb_build_object(
                        'changes',
                        jsonb_build_object('comment', jsonb_build_object('old', 'old', 'new', 'new'))
                    )
                END,
                CASE WHEN event_type = 'cell_update' THEN condition_id END,
                CASE WHEN event_type = 'cell_update' THEN parameter_code END,
                CASE WHEN event_type = 'cell_update' AND origin_override = 'paste' THEN 'old' END,
                CASE WHEN event_type = 'cell_update' AND origin_override = 'paste' THEN value_text END,
                CASE
                    WHEN event_type IN (
                        'cell_update',
                        'backbone_layer_replace',
                        'condition_add',
                        'condition_remove',
                        'por_change'
                    ) THEN layer_key
                END,
                batch_id,
                CASE
                    WHEN event_type = 'cell_update' THEN origin_override
                    WHEN event_type IN ('project_create', 'backbone_copy', 'backbone_layer_replace') THEN 'backbone'
                    WHEN event_type = 'project_profile_update' THEN 'manual'
                    ELSE 'manual'
                END,
                source_project_id,
                source_layer_key,
                timestamp with time zone '2026-07-16 00:00:00+00' + make_interval(secs => gs)
            FROM generated
            """
        ),
        {
            "count": _BASE_EVENT_COUNT,
            "project_id": project_id,
            "noise_project_id": noise_project_id,
            "source_layer_key": source_layer_key,
            "current_condition_id": current_condition_id,
            "deleted_condition_id": deleted_condition_id,
            "layer_count": _LAYER_COUNT,
            "parameter_count": _PARAMETER_COUNT,
        },
    )


def _seed_special_batches(
    connection: Connection,
    *,
    project_id: int,
    layer_key: str,
    current_condition_id: int,
    deleted_condition_id: int,
) -> tuple[str, str]:
    detail_batch_id = "batch-detail-100"
    paste_batch_id = "batch-paste-200"
    connection.execute(
        sa.text(
            """
            INSERT INTO change_event (
                project_id,
                event_type,
                actor,
                payload,
                condition_id,
                parameter_code,
                old_value,
                new_value,
                layer_key,
                batch_id,
                origin,
                created_at
            )
            SELECT
                :project_id,
                'cell_update',
                'dev-admin',
                jsonb_build_object('batch_id', :detail_batch_id, 'origin', 'manual'),
                :condition_id,
                'param_000',
                '900',
                '901',
                :layer_key,
                :detail_batch_id,
                'manual',
                timestamp with time zone '2026-07-16 01:00:00+00' + make_interval(secs => gs)
            FROM generate_series(1, :count) AS gs
            """
        ),
        {
            "project_id": project_id,
            "detail_batch_id": detail_batch_id,
            "condition_id": current_condition_id,
            "layer_key": layer_key,
            "count": _DETAIL_BATCH_SIZE,
        },
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO change_event (
                project_id,
                event_type,
                actor,
                payload,
                condition_id,
                parameter_code,
                old_value,
                new_value,
                layer_key,
                batch_id,
                origin,
                created_at
            )
            SELECT
                :project_id,
                'cell_update',
                'dev-admin',
                jsonb_build_object('batch_id', :paste_batch_id, 'origin', 'paste'),
                :condition_id,
                'param_000',
                '100',
                '100',
                :layer_key,
                :paste_batch_id,
                'paste',
                timestamp with time zone '2026-07-16 02:00:00+00' + make_interval(secs => gs)
            FROM generate_series(1, :count) AS gs
            """
        ),
        {
            "project_id": project_id,
            "paste_batch_id": paste_batch_id,
            "condition_id": current_condition_id,
            "layer_key": layer_key,
            "count": _PASTE_BATCH_SIZE,
        },
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO change_event (
                project_id,
                event_type,
                actor,
                payload,
                condition_id,
                parameter_code,
                old_value,
                new_value,
                layer_key,
                origin,
                created_at
            )
            VALUES
                (
                    :project_id,
                    'cell_update',
                    'dev-admin',
                    jsonb_build_object('batch_id', 'batch-current-history', 'origin', 'manual'),
                    :current_condition_id,
                    'param_000',
                    '10',
                    '11',
                    :layer_key,
                    'manual',
                    timestamp with time zone '2026-07-16 03:00:00+00'
                ),
                (
                    :project_id,
                    'cell_update',
                    'dev-admin',
                    jsonb_build_object('batch_id', 'batch-current-history', 'origin', 'paste'),
                    :current_condition_id,
                    'param_000',
                    '11',
                    '12',
                    :layer_key,
                    'paste',
                    timestamp with time zone '2026-07-16 03:00:01+00'
                ),
                (
                    :project_id,
                    'cell_update',
                    'dev-admin',
                    jsonb_build_object('batch_id', 'batch-deleted-history', 'origin', 'manual'),
                    :deleted_condition_id,
                    'param_001',
                    '20',
                    '21',
                    :layer_key,
                    'manual',
                    timestamp with time zone '2026-07-16 03:00:02+00'
                ),
                (
                    :project_id,
                    'cell_update',
                    'dev-admin',
                    jsonb_build_object('batch_id', 'batch-deleted-history', 'origin', 'paste'),
                    :deleted_condition_id,
                    'param_001',
                    '21',
                    '22',
                    :layer_key,
                    'paste',
                    timestamp with time zone '2026-07-16 03:00:03+00'
                )
            """
        ),
        {
            "project_id": project_id,
            "current_condition_id": current_condition_id,
            "deleted_condition_id": deleted_condition_id,
            "layer_key": layer_key,
        },
    )
    connection.execute(sa.text("DELETE FROM cell_value WHERE condition_id = :id"), {"id": deleted_condition_id})
    connection.execute(sa.text("DELETE FROM layer_condition WHERE id = :id"), {"id": deleted_condition_id})
    connection.commit()
    return detail_batch_id, paste_batch_id


def _seed_history_fixture(connection: Connection) -> HistoryFixture:
    project_id = _insert_scalar(
        connection,
        """
        INSERT INTO project (line_id, process_id, part_id, name)
        VALUES ('L1', 'PROC_HISTORY', 'PART_HISTORY', 'History performance project')
        RETURNING id
        """,
    )
    noise_project_id = _insert_scalar(
        connection,
        """
        INSERT INTO project (line_id, process_id, part_id, name)
        VALUES ('L1', 'PROC_HISTORY_NOISE', 'PART_HISTORY_NOISE', 'History noise project')
        RETURNING id
        """,
    )
    _seed_parameters(connection)
    layer_keys, current_condition_id, deleted_condition_id = _seed_layers_and_cells(
        connection, project_id=project_id
    )
    _seed_bulk_events(
        connection,
        project_id=project_id,
        noise_project_id=noise_project_id,
        source_layer_key=layer_keys[0],
        current_condition_id=current_condition_id,
        deleted_condition_id=deleted_condition_id,
    )
    detail_batch_id, paste_batch_id = _seed_special_batches(
        connection,
        project_id=project_id,
        layer_key=layer_keys[0],
        current_condition_id=current_condition_id,
        deleted_condition_id=deleted_condition_id,
    )
    connection.execute(sa.text("ANALYZE"))
    connection.commit()
    return HistoryFixture(
        project_id=project_id,
        current_condition_id=current_condition_id,
        current_parameter_code="param_000",
        deleted_condition_id=deleted_condition_id,
        deleted_parameter_code="param_001",
        layer_key=layer_keys[0],
        detail_batch_id=detail_batch_id,
        paste_batch_id=paste_batch_id,
        source_project_id=noise_project_id,
    )


def _timeline_summary_sql(filter_clause: str = "", *, raw_limit: int = 1000) -> str:
    return f"""
        WITH raw AS (
            SELECT
                id,
                batch_id,
                event_type,
                origin,
                created_at
            FROM change_event
            WHERE project_id = :project_id
              {filter_clause}
            ORDER BY id DESC
            LIMIT {raw_limit}
        )
        SELECT
            CASE WHEN batch_id IS NULL THEN id::text ELSE batch_id END AS group_key,
            MAX(id) AS group_max_id,
            COUNT(*) AS member_count,
            MAX(created_at)::text AS latest_created_at,
            MAX(event_type)::text AS sample_event_type,
            MAX(origin)::text AS sample_origin
        FROM raw
        GROUP BY 1
        ORDER BY group_max_id DESC
        LIMIT :limit
    """


def _batch_detail_sql() -> str:
    return """
        SELECT
            id,
            event_type,
            actor,
            condition_id,
            parameter_code,
            old_value,
            new_value,
            layer_key,
            batch_id,
            origin,
            source_project_id,
            source_layer_key,
            created_at::text AS created_at
        FROM change_event
        WHERE project_id = :project_id
          AND batch_id = :batch_id
        ORDER BY id DESC
        LIMIT :limit
    """


def _cell_history_sql() -> str:
    return """
        SELECT
            id,
            event_type,
            actor,
            condition_id,
            parameter_code,
            old_value,
            new_value,
            layer_key,
            batch_id,
            origin,
            created_at::text AS created_at
        FROM change_event
        WHERE project_id = :project_id
          AND condition_id = :condition_id
          AND parameter_code = :parameter_code
        ORDER BY id DESC
        LIMIT :limit
    """


def _query_rows(connection: Connection, sql: str, params: dict[str, object]) -> list[dict[str, Any]]:
    rows = connection.execute(sa.text(sql), params).mappings().all()
    return _rows_as_dicts(rows)


def _measure_series(
    engine: Engine,
    connection: Connection,
    *,
    label: str,
    sql: str,
    params: dict[str, object],
    warmup_runs: int = _WARMUP_RUNS,
    timed_runs: int = _TIMED_RUNS,
) -> QueryBenchmark:
    durations: list[float] = []
    max_sql_count = 0
    max_serialized_bytes = 0
    for _ in range(warmup_runs):
        _query_rows(connection, sql, params)
    for _ in range(timed_runs):
        with _sql_counter(engine) as statements:
            started = time.perf_counter()
            rows = _query_rows(connection, sql, params)
            elapsed_ms = (time.perf_counter() - started) * 1000
        durations.append(elapsed_ms)
        max_sql_count = max(max_sql_count, len(statements))
        max_serialized_bytes = max(max_serialized_bytes, _json_bytes(rows))
    ordered = sorted(durations)
    p95_index = max(0, math.ceil(0.95 * len(ordered)) - 1)
    return QueryBenchmark(
        label=label,
        samples=timed_runs,
        p50_ms=statistics.median(ordered),
        p95_ms=ordered[p95_index],
        max_ms=max(ordered),
        max_sql_count=max_sql_count,
        max_serialized_bytes=max_serialized_bytes,
    )


def _assert_query_budget(
    benchmark: QueryBenchmark,
    *,
    max_ms: float,
    max_sql_count: int,
    max_serialized_bytes: int = _PAGE_BYTE_LIMIT,
) -> None:
    assert benchmark.p50_ms <= max_ms, f"{benchmark.label}: p50 {benchmark.p50_ms:.1f}ms > {max_ms}ms"
    assert benchmark.p95_ms <= max_ms, f"{benchmark.label}: p95 {benchmark.p95_ms:.1f}ms > {max_ms}ms"
    assert benchmark.max_ms <= max_ms, f"{benchmark.label}: max {benchmark.max_ms:.1f}ms > {max_ms}ms"
    assert benchmark.max_sql_count <= max_sql_count, (
        f"{benchmark.label}: sql {benchmark.max_sql_count} > {max_sql_count}"
    )
    assert benchmark.max_serialized_bytes <= max_serialized_bytes, (
        f"{benchmark.label}: payload {benchmark.max_serialized_bytes} > {max_serialized_bytes}"
    )


def _normalized_plan_nodes(plan: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = [plan]
    for child in plan.get("Plans", []):
        nodes.extend(_normalized_plan_nodes(child))
    return nodes


def _explain_json(connection: Connection, sql: str, params: dict[str, object]) -> dict[str, Any]:
    result = connection.execute(
        sa.text(f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}"),
        params,
    ).scalar_one()
    parsed = json.loads(result) if isinstance(result, str) else result
    return parsed[0]["Plan"]


def _assert_index_plan(
    connection: Connection,
    *,
    sql: str,
    params: dict[str, object],
    expected_index: str,
) -> dict[str, Any]:
    plan = _explain_json(connection, sql, params)
    node_types = [node.get("Node Type") for node in _normalized_plan_nodes(plan)]
    assert "Seq Scan" not in node_types, f"unexpected seq scan in plan: {node_types}"
    assert "Parallel Seq Scan" not in node_types, f"unexpected seq scan in plan: {node_types}"
    index_names = {
        node.get("Index Name")
        for node in _normalized_plan_nodes(plan)
        if node.get("Index Name")
    }
    assert expected_index in index_names, f"{expected_index} not used by {node_types}"
    return plan


def _index_definitions(connection: Connection) -> dict[str, str]:
    rows = connection.execute(
        sa.text(
            """
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = current_schema()
              AND tablename = 'change_event'
            ORDER BY indexname
            """
        )
    ).all()
    return {row[0]: row[1].lower() for row in rows}


def _build_report(
    *,
    warmup_runs: int = _WARMUP_RUNS,
    timed_runs: int = _TIMED_RUNS,
    compare_paste_overhead: bool = False,
) -> dict[str, Any]:
    red_handoff = (
        "RED handoff: production history repository/service is not integrated in this worktree; "
        "this benchmark validates the approved SQL contracts and PostgreSQL budgets directly."
    )
    with temporary_postgres_database() as database:
        migration_db = _prepare_database(database)
        try:
            fixture = _seed_history_fixture(migration_db.connection)
            engine = migration_db.connection.engine

            timeline_unfiltered = _measure_series(
                engine,
                migration_db.connection,
                label="timeline_unfiltered",
                sql=_timeline_summary_sql(),
                params={"project_id": fixture.project_id, "limit": _TIMELINE_LIMIT},
                warmup_runs=warmup_runs,
                timed_runs=timed_runs,
            )
            timeline_layer_filtered = _measure_series(
                engine,
                migration_db.connection,
                label="timeline_layer_filtered",
                sql=_timeline_summary_sql("AND layer_key = :layer_key"),
                params={
                    "project_id": fixture.project_id,
                    "layer_key": fixture.layer_key,
                    "limit": _TIMELINE_LIMIT,
                },
                warmup_runs=warmup_runs,
                timed_runs=timed_runs,
            )
            batch_detail = _measure_series(
                engine,
                migration_db.connection,
                label="batch_detail",
                sql=_batch_detail_sql(),
                params={
                    "project_id": fixture.project_id,
                    "batch_id": fixture.detail_batch_id,
                    "limit": _DETAIL_LIMIT,
                },
                warmup_runs=warmup_runs,
                timed_runs=timed_runs,
            )
            cell_history_current = _measure_series(
                engine,
                migration_db.connection,
                label="cell_history_current",
                sql=_cell_history_sql(),
                params={
                    "project_id": fixture.project_id,
                    "condition_id": fixture.current_condition_id,
                    "parameter_code": fixture.current_parameter_code,
                    "limit": _CELL_HISTORY_LIMIT,
                },
                warmup_runs=warmup_runs,
                timed_runs=timed_runs,
            )
            cell_history_deleted = _measure_series(
                engine,
                migration_db.connection,
                label="cell_history_deleted",
                sql=_cell_history_sql(),
                params={
                    "project_id": fixture.project_id,
                    "condition_id": fixture.deleted_condition_id,
                    "parameter_code": fixture.deleted_parameter_code,
                    "limit": _CELL_HISTORY_LIMIT,
                },
                warmup_runs=warmup_runs,
                timed_runs=timed_runs,
            )

            _assert_query_budget(timeline_unfiltered, max_ms=_TIMELINE_MAX_MS, max_sql_count=_TIMELINE_MAX_SQL)
            _assert_query_budget(timeline_layer_filtered, max_ms=_TIMELINE_MAX_MS, max_sql_count=_TIMELINE_MAX_SQL)
            _assert_query_budget(batch_detail, max_ms=_DETAIL_MAX_MS, max_sql_count=_DETAIL_MAX_SQL)
            _assert_query_budget(
                cell_history_current, max_ms=_CELL_HISTORY_MAX_MS, max_sql_count=_CELL_HISTORY_MAX_SQL
            )
            _assert_query_budget(
                cell_history_deleted, max_ms=_CELL_HISTORY_MAX_MS, max_sql_count=_CELL_HISTORY_MAX_SQL
            )

            plans = {
                "timeline_unfiltered": _assert_index_plan(
                    migration_db.connection,
                    sql="""
                        SELECT id
                        FROM change_event
                        WHERE project_id = :project_id
                          AND id <= :snapshot_max_id
                        ORDER BY id DESC
                        LIMIT :limit
                    """,
                    params={
                        "project_id": fixture.project_id,
                        "snapshot_max_id": 2_000_000_000,
                        "limit": _TIMELINE_LIMIT,
                    },
                    expected_index="ix_change_event_project_id_id_desc",
                ),
                "timeline_layer_filtered": _assert_index_plan(
                    migration_db.connection,
                    sql="""
                        SELECT id
                        FROM change_event
                        WHERE project_id = :project_id
                          AND layer_key = :layer_key
                        ORDER BY id DESC
                        LIMIT :limit
                    """,
                    params={
                        "project_id": fixture.project_id,
                        "layer_key": fixture.layer_key,
                        "limit": _TIMELINE_LIMIT,
                    },
                    expected_index="ix_change_event_project_layer_id_desc",
                ),
                "timeline_type_filtered": _assert_index_plan(
                    migration_db.connection,
                    sql="""
                        SELECT id
                        FROM change_event
                        WHERE project_id = :project_id
                          AND event_type = :event_type
                        ORDER BY id DESC
                        LIMIT :limit
                    """,
                    params={
                        "project_id": fixture.project_id,
                        "event_type": "cell_update",
                        "limit": _TIMELINE_LIMIT,
                    },
                    expected_index="ix_change_event_project_type_id_desc",
                ),
                "timeline_actor_filtered": _assert_index_plan(
                    migration_db.connection,
                    sql="""
                        SELECT id
                        FROM change_event
                        WHERE project_id = :project_id
                          AND actor = :actor
                        ORDER BY id DESC
                        LIMIT :limit
                    """,
                    params={
                        "project_id": fixture.project_id,
                        "actor": "dev-admin",
                        "limit": _TIMELINE_LIMIT,
                    },
                    expected_index="ix_change_event_project_actor_id_desc",
                ),
                "timeline_origin_filtered": _assert_index_plan(
                    migration_db.connection,
                    sql="""
                        SELECT id
                        FROM change_event
                        WHERE project_id = :project_id
                          AND origin = :origin
                        ORDER BY id DESC
                        LIMIT :limit
                    """,
                    params={
                        "project_id": fixture.project_id,
                        "origin": "paste",
                        "limit": _TIMELINE_LIMIT,
                    },
                    expected_index="ix_change_event_project_origin_id_desc",
                ),
                "timeline_source_filtered": _assert_index_plan(
                    migration_db.connection,
                    sql="""
                        SELECT id
                        FROM change_event
                        WHERE project_id = :project_id
                          AND source_project_id = :source_project_id
                        ORDER BY id DESC
                        LIMIT :limit
                    """,
                    params={
                        "project_id": fixture.project_id,
                        "source_project_id": fixture.source_project_id,
                        "limit": _TIMELINE_LIMIT,
                    },
                    expected_index="ix_change_event_project_source_id_desc",
                ),
                "timeline_created_filtered": _assert_index_plan(
                    migration_db.connection,
                    sql="""
                        SELECT id
                        FROM change_event
                        WHERE project_id = :project_id
                          AND created_at >= :from_time
                        ORDER BY created_at DESC, id DESC
                        LIMIT :limit
                    """,
                    params={
                        "project_id": fixture.project_id,
                        "from_time": "2026-07-16 00:00:00+00",
                        "limit": _TIMELINE_LIMIT,
                    },
                    expected_index="ix_change_event_project_created_id_desc",
                ),
                "batch_detail": _assert_index_plan(
                    migration_db.connection,
                    sql="""
                        SELECT id
                        FROM change_event
                        WHERE project_id = :project_id
                          AND batch_id = :batch_id
                        ORDER BY id DESC
                        LIMIT :limit
                    """,
                    params={
                        "project_id": fixture.project_id,
                        "batch_id": fixture.detail_batch_id,
                        "limit": _DETAIL_LIMIT,
                    },
                    expected_index="ix_change_event_project_batch_id_desc",
                ),
                "cell_history": _assert_index_plan(
                    migration_db.connection,
                    sql="""
                        SELECT id
                        FROM change_event
                        WHERE project_id = :project_id
                          AND condition_id = :condition_id
                          AND parameter_code = :parameter_code
                        ORDER BY id DESC
                        LIMIT :limit
                    """,
                    params={
                        "project_id": fixture.project_id,
                        "condition_id": fixture.current_condition_id,
                        "parameter_code": fixture.current_parameter_code,
                        "limit": _CELL_HISTORY_LIMIT,
                    },
                    expected_index="ix_change_event_project_cell_id_desc",
                ),
            }

            index_definitions = _index_definitions(migration_db.connection)
            required_index_names = {
                "ix_change_event_project_id_id_desc",
                "ix_change_event_project_type_id_desc",
                "ix_change_event_project_cell_id_desc",
                "ix_change_event_project_condition_id_desc",
                "ix_change_event_project_layer_id_desc",
                "ix_change_event_project_actor_id_desc",
                "ix_change_event_project_origin_id_desc",
                "ix_change_event_project_source_id_desc",
                "ix_change_event_project_created_id_desc",
                "ix_change_event_project_batch_id_desc",
            }
            assert required_index_names.issubset(index_definitions)

            report: dict[str, Any] = {
                "binding_mode": "sql_contracts",
                "red_handoff": red_handoff,
                "fixture": {
                    "project_id": fixture.project_id,
                    "layer_count": _LAYER_COUNT,
                    "parameter_count": _PARAMETER_COUNT,
                    "event_count": _HISTORY_EVENT_COUNT,
                    "detail_batch_size": _DETAIL_BATCH_SIZE,
                    "paste_batch_size": _PASTE_BATCH_SIZE,
                },
                "timeline_unfiltered": timeline_unfiltered,
                "timeline_layer_filtered": timeline_layer_filtered,
                "batch_detail": batch_detail,
                "cell_history_current": cell_history_current,
                "cell_history_deleted": cell_history_deleted,
                "plans": plans,
                "index_definitions": sorted(index_definitions),
            }

            if compare_paste_overhead:
                report["paste_overhead"] = _measure_paste_overhead(warmup_runs=warmup_runs, timed_runs=timed_runs)

            return report
        finally:
            migration_db.connection.close()
            migration_db.connection.engine.dispose()


def _measure_write_series(
    engine: Engine,
    connection: Connection,
    *,
    label: str,
    sql: str,
    params: dict[str, object],
    warmup_runs: int = _WARMUP_RUNS,
    timed_runs: int = _TIMED_RUNS,
) -> QueryBenchmark:
    durations: list[float] = []
    max_sql_count = 0
    max_serialized_bytes = 0
    for _ in range(warmup_runs):
        txn = connection.begin_nested()
        try:
            rows = _query_rows(connection, sql, params)
        finally:
            txn.rollback()
        max_serialized_bytes = max(max_serialized_bytes, _json_bytes(rows))
    for _ in range(timed_runs):
        with _sql_counter(engine) as statements:
            txn = connection.begin_nested()
            try:
                started = time.perf_counter()
                rows = _query_rows(connection, sql, params)
                elapsed_ms = (time.perf_counter() - started) * 1000
            finally:
                txn.rollback()
        durations.append(elapsed_ms)
        max_sql_count = max(max_sql_count, len(statements))
        max_serialized_bytes = max(max_serialized_bytes, _json_bytes(rows))
    ordered = sorted(durations)
    p95_index = max(0, math.ceil(0.95 * len(ordered)) - 1)
    return QueryBenchmark(
        label=label,
        samples=timed_runs,
        p50_ms=statistics.median(ordered),
        p95_ms=ordered[p95_index],
        max_ms=max(ordered),
        max_sql_count=max_sql_count,
        max_serialized_bytes=max_serialized_bytes,
    )


def _measure_paste_overhead(*, warmup_runs: int, timed_runs: int) -> dict[str, Any]:
    def _seed_small_fixture(migration_db: MigrationDatabase) -> tuple[int, str, int]:
        connection = migration_db.connection
        project_id = _insert_scalar(
            connection,
            """
            INSERT INTO project (line_id, process_id, part_id, name)
            VALUES ('L1', 'PROC_PASTE', 'PART_PASTE', 'Paste overhead project')
            RETURNING id
            """,
        )
        _seed_parameters(connection)
        layer_key = "L1::PASTE::000::L00"
        layer_id = _insert_scalar(
            connection,
            """
            INSERT INTO sheet_layer (project_id, layer_key, step_seq, layer_id, sort_order)
            VALUES (:project_id, :layer_key, '000', 'L00', 0)
            RETURNING id
            """,
            {"project_id": project_id, "layer_key": layer_key},
        )
        condition_id = _insert_scalar(
            connection,
            """
            INSERT INTO layer_condition (layer_id, label, condition_index, is_por)
            VALUES (:layer_id, 'base', 1, true)
            RETURNING id
            """,
            {"layer_id": layer_id},
        )
        _insert_scalar(
            connection,
            """
            INSERT INTO cell_value (condition_id, parameter_code, value_text)
            VALUES (:condition_id, 'param_000', 'seed')
            RETURNING id
            """,
            {"condition_id": condition_id},
        )
        connection.commit()
        return project_id, layer_key, condition_id

    insert_sql = """
        INSERT INTO change_event (
            project_id,
            event_type,
            actor,
            payload,
            condition_id,
            parameter_code,
            old_value,
            new_value,
            layer_key,
            batch_id,
            origin,
            created_at
        )
        SELECT
            :project_id,
            'cell_update',
            'dev-admin',
            jsonb_build_object('batch_id', :batch_id, 'origin', 'paste'),
            :condition_id,
            'param_000',
            '1',
            '2',
            :layer_key,
            :batch_id,
            'paste',
            timestamp with time zone '2026-07-16 04:00:00+00' + make_interval(secs => gs)
        FROM generate_series(1, :count) AS gs
        RETURNING id
    """

    reports: dict[str, QueryBenchmark] = {}
    for revision in ("0006", "head"):
        with temporary_postgres_database() as database:
            migration_db = _prepare_database(database)
            try:
                if revision == "0006":
                    migration_db.upgrade("0006")
                project_id, layer_key, condition_id = _seed_small_fixture(migration_db)
                reports[revision] = _measure_write_series(
                    migration_db.connection.engine,
                    migration_db.connection,
                    label=f"paste_overhead_{revision}",
                    sql=insert_sql,
                    params={
                        "project_id": project_id,
                        "batch_id": "batch-paste-overhead",
                        "condition_id": condition_id,
                        "layer_key": layer_key,
                        "count": _PASTE_BATCH_SIZE,
                    },
                    warmup_runs=warmup_runs,
                    timed_runs=timed_runs,
                )
            finally:
                migration_db.connection.close()
                migration_db.connection.engine.dispose()

    pre = reports["0006"]
    post = reports["head"]
    overhead_ratio = (post.p50_ms - pre.p50_ms) / pre.p50_ms if pre.p50_ms else 0.0
    assert overhead_ratio <= _PASTE_OVERHEAD_MAX_RATIO, (
        f"paste overhead {overhead_ratio:.3f} exceeds {_PASTE_OVERHEAD_MAX_RATIO:.2f}"
    )
    return {"pre_0007": pre, "post_0007": post, "overhead_ratio": overhead_ratio}


def _report_to_json(report: dict[str, Any]) -> str:
    return json.dumps(report, ensure_ascii=False, sort_keys=True, default=str, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compare-paste-overhead", action="store_true")
    parser.add_argument("--emit-json", action="store_true")
    parser.add_argument("--samples", type=int, default=_TIMED_RUNS)
    parser.add_argument("--warmup", type=int, default=_WARMUP_RUNS)
    args = parser.parse_args()

    report = _build_report(
        warmup_runs=args.warmup,
        timed_runs=args.samples,
        compare_paste_overhead=args.compare_paste_overhead,
    )
    if args.emit_json:
        print(_report_to_json(report))
        return

    print("=== Phase 4 history PostgreSQL performance gate ===")
    print(report["red_handoff"])
    print(f"binding_mode: {report['binding_mode']}")
    fixture = report["fixture"]
    print(
        "fixture: "
        f"project={fixture['project_id']} layers={fixture['layer_count']} "
        f"parameters={fixture['parameter_count']} events={fixture['event_count']}"
    )
    for key in (
        "timeline_unfiltered",
        "timeline_layer_filtered",
        "batch_detail",
        "cell_history_current",
        "cell_history_deleted",
    ):
        metric = report[key]
        print(
            f"{key}: p50={metric.p50_ms:.1f}ms p95={metric.p95_ms:.1f}ms "
            f"max={metric.max_ms:.1f}ms sql={metric.max_sql_count} bytes={metric.max_serialized_bytes}"
        )
    if args.compare_paste_overhead and "paste_overhead" in report:
        overhead = report["paste_overhead"]
        print(
            "paste_overhead: "
            f"ratio={overhead['overhead_ratio']:.3f} "
            f"pre={overhead['pre_0007'].p50_ms:.1f}ms "
            f"post={overhead['post_0007'].p50_ms:.1f}ms"
        )


if __name__ == "__main__":
    main()
