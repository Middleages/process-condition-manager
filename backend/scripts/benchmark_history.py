"""Production-bound PostgreSQL performance gate for Phase 4 history."""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import sys
import time
from collections.abc import Awaitable, Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from pydantic import BaseModel
from sqlalchemy import event, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models  # noqa: F401 -- register all production models for migrations
from app.domain.backbone.snapshot import (
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
    serialize_backbone_snapshot,
)
from app.domain.parameters.types import ValueType
from app.features.history.cursor import (
    HistoryDetailScope,
    HistoryMemberFilterScope,
    encode_history_detail_scope,
)
from app.features.history.repository import HistoryRepository
from app.features.history.schema import (
    HistoryCellHistoryQueryIn,
    HistoryDetailQueryIn,
    HistoryTimelineQueryIn,
)
from app.features.history.service import HistoryService
from app.models.project import ChangeEvent
from tests.postgres_database import TemporaryPostgresDatabase, temporary_postgres_database

_HISTORY_EVENT_COUNT = 100_000
_LAYER_COUNT = 100
_PARAMETER_COUNT = 200
_CELL_COUNT = _LAYER_COUNT * _PARAMETER_COUNT
_DETAIL_BATCH_SIZE = 100
_PASTE_BATCH_SIZE = 200
_DELETED_HISTORY_SIZE = 50
_SPECIAL_EVENT_COUNT = 357
_BASE_EVENT_COUNT = _HISTORY_EVENT_COUNT - _SPECIAL_EVENT_COUNT
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
_PASTE_OVERHEAD_MAX_RATIO = 0.20
_TARGET_PARAMETER_CODE = "param_0007"
_REQUIRED_INDEXES = {
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


@dataclass(frozen=True, slots=True)
class MigrationDatabase:
    database: TemporaryPostgresDatabase
    connection: Connection

    def upgrade(self, target: str) -> None:
        config = Config(str(_BACKEND_ROOT / "alembic.ini"))
        config.set_main_option("script_location", str(_BACKEND_ROOT / "alembic"))
        config.set_main_option("sqlalchemy.url", self.database.sync_url)
        config.attributes["connection"] = self.connection
        self.connection.commit()
        command.upgrade(config, target)


@dataclass(frozen=True, slots=True)
class HistoryFixture:
    project_id: int
    current_condition_id: int
    deleted_condition_id: int
    current_layer_key: str
    source_layer_key: str
    detail_batch_id: str
    paste_batch_id: str
    v1_capture_batch_id: str
    v2_capture_batch_id: str
    max_event_id: int
    period_from: datetime
    invariants: Mapping[str, int]


@dataclass(frozen=True, slots=True)
class QueryBenchmark:
    label: str
    samples_ms: tuple[float, ...]
    sql_counts: tuple[int, ...]
    serialized_bytes: tuple[int, ...]
    p50_ms: float
    p95_ms: float
    max_ms: float
    max_sql_count: int
    max_serialized_bytes: int

    @property
    def samples(self) -> int:
        return len(self.samples_ms)


@dataclass(frozen=True, slots=True)
class PlanEvidence:
    label: str
    expected_index: str
    used_indexes: tuple[str, ...]
    node_types: tuple[str, ...]
    change_event_seq_scans: tuple[str, ...]
    plan: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class WriteBenchmark:
    label: str
    samples_ms: tuple[float, ...]
    p50_ms: float
    p95_ms: float
    max_ms: float


def _prepare_database(
    database: TemporaryPostgresDatabase, *, target: str = "head"
) -> MigrationDatabase:
    engine = sa.create_engine(database.sync_url, future=True)
    connection = engine.connect()
    migration_db = MigrationDatabase(database=database, connection=connection)
    migration_db.upgrade(target)
    return migration_db


def _scalar(connection: Connection, sql: str, params: Mapping[str, object] | None = None) -> int:
    return int(connection.execute(sa.text(sql), params or {}).scalar_one())


def _seed_parameters(connection: Connection) -> None:
    connection.execute(
        sa.text(
            """
            INSERT INTO parameter (code, display_name, value_type, sort_order, is_active)
            SELECT
                'param_' || lpad(gs::text, 4, '0'),
                'Parameter ' || lpad(gs::text, 4, '0'),
                'text',
                gs,
                CASE WHEN gs = 7 THEN false ELSE true END
            FROM generate_series(0, :last_parameter) AS gs
            """
        ),
        {"last_parameter": _PARAMETER_COUNT - 1},
    )


def _seed_grid(connection: Connection, project_id: int) -> tuple[int, int, str, str]:
    connection.execute(
        sa.text(
            """
            INSERT INTO sheet_layer (
                project_id, layer_key, step_seq, layer_id, sort_order,
                source_project_id, source_layer_key
            )
            SELECT
                :project_id,
                'L1::HIST::' || lpad(gs::text, 3, '0') || '::L' || lpad(gs::text, 2, '0'),
                lpad(gs::text, 3, '0'),
                'L' || lpad(gs::text, 2, '0'),
                gs,
                :project_id,
                'L1::HIST::' || lpad(((gs + 1) % :layer_count)::text, 3, '0')
                    || '::L' || lpad(((gs + 1) % :layer_count)::text, 2, '0')
            FROM generate_series(0, :last_layer) AS gs
            """
        ),
        {
            "project_id": project_id,
            "layer_count": _LAYER_COUNT,
            "last_layer": _LAYER_COUNT - 1,
        },
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO layer_condition (
                layer_id, label, condition_index, is_por, source_condition_id
            )
            SELECT id, 'base', 0, true, 7000 + sort_order
            FROM sheet_layer
            WHERE project_id = :project_id
            ORDER BY sort_order
            """
        ),
        {"project_id": project_id},
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO cell_value (condition_id, parameter_code, value_text)
            SELECT condition.id, parameter.code, 'seed-' || parameter.code
            FROM layer_condition AS condition
            JOIN sheet_layer AS layer ON layer.id = condition.layer_id
            CROSS JOIN parameter
            WHERE layer.project_id = :project_id
            """
        ),
        {"project_id": project_id},
    )
    current_layer_key = "L1::HIST::007::L07"
    source_layer_key = "L1::HIST::008::L08"
    current_condition_id = _scalar(
        connection,
        """
        SELECT condition.id
        FROM layer_condition AS condition
        JOIN sheet_layer AS layer ON layer.id = condition.layer_id
        WHERE layer.project_id = :project_id AND layer.layer_key = :layer_key
        """,
        {"project_id": project_id, "layer_key": current_layer_key},
    )
    deleted_condition_id = _scalar(
        connection,
        """
        INSERT INTO layer_condition (
            layer_id, label, condition_index, is_por, source_condition_id
        )
        VALUES (
            (SELECT id FROM sheet_layer
             WHERE project_id = :project_id AND layer_key = :layer_key),
            'deleted', 1, false, 990007
        )
        RETURNING id
        """,
        {"project_id": project_id, "layer_key": current_layer_key},
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO cell_value (condition_id, parameter_code, value_text)
            SELECT :condition_id, code, 'deleted-' || code FROM parameter
            """
        ),
        {"condition_id": deleted_condition_id},
    )
    return (
        current_condition_id,
        deleted_condition_id,
        current_layer_key,
        source_layer_key,
    )


def _capture_snapshot(
    *, project_id: int, source_layer_id: int, source_layer_key: str
) -> dict[str, Any]:
    return serialize_backbone_snapshot(
        BackboneSnapshot(
            capture_batch_id="0123456789abcdef0123456789abcdef",
            captured_at=datetime(2026, 7, 16, 5, 0, tzinfo=UTC),
            source=BackboneSnapshotSource(
                project_id=project_id,
                sheet_layer_id=source_layer_id,
                layer_key=source_layer_key,
                step_seq="008",
                layer_id="L08",
            ),
            columns=tuple(
                BackboneSnapshotColumn(
                    parameter_code=f"param_{index:04d}",
                    value_type=ValueType.TEXT,
                    display_name=f"Parameter {index:04d}",
                    category_code=None,
                    sort_order=index,
                    active_at_capture=index != 7,
                )
                for index in range(_PARAMETER_COUNT)
            ),
            conditions=(
                BackboneSnapshotCondition(
                    source_condition_id=7007,
                    label="base",
                    condition_index=0,
                    is_por=True,
                    cells=tuple(
                        BackboneSnapshotCell(
                            parameter_code=f"param_{index:04d}",
                            value=f"captured-{index:04d}",
                        )
                        for index in range(_PARAMETER_COUNT)
                    ),
                ),
            ),
        )
    )


def _insert_json_event(
    connection: Connection,
    *,
    project_id: int,
    event_type: str,
    actor: str,
    payload: Mapping[str, Any],
    created_at: datetime,
    condition_id: int | None = None,
    parameter_code: str | None = None,
    old_value: str | None = None,
    new_value: str | None = None,
    layer_key: str | None = None,
    batch_id: str | None = None,
    origin: str | None = None,
    source_project_id: int | None = None,
    source_layer_key: str | None = None,
) -> int:
    return _scalar(
        connection,
        """
        INSERT INTO change_event (
            project_id, event_type, actor, payload, condition_id, parameter_code,
            old_value, new_value, layer_key, batch_id, origin, source_project_id,
            source_layer_key, created_at
        )
        VALUES (
            :project_id, :event_type, :actor, CAST(:payload AS jsonb), :condition_id,
            :parameter_code, :old_value, :new_value, :layer_key, :batch_id, :origin,
            :source_project_id, :source_layer_key, :created_at
        )
        RETURNING id
        """,
        {
            "project_id": project_id,
            "event_type": event_type,
            "actor": actor,
            "payload": json.dumps(payload, sort_keys=True),
            "condition_id": condition_id,
            "parameter_code": parameter_code,
            "old_value": old_value,
            "new_value": new_value,
            "layer_key": layer_key,
            "batch_id": batch_id,
            "origin": origin,
            "source_project_id": source_project_id,
            "source_layer_key": source_layer_key,
            "created_at": created_at,
        },
    )


def _seed_bulk_events(connection: Connection, *, project_id: int) -> None:
    connection.execute(
        sa.text(
            """
            WITH generated AS (
                SELECT
                    gs,
                    (gs % :layer_count)::integer AS layer_no,
                    (gs % :parameter_count)::integer AS parameter_no,
                    CASE
                        WHEN gs % 10 < 6 THEN 'cell_update'
                        WHEN gs % 10 = 6 THEN 'condition_add'
                        WHEN gs % 10 = 7 THEN 'condition_remove'
                        WHEN gs % 10 = 8 THEN 'por_change'
                        ELSE 'project_profile_update'
                    END AS event_type
                FROM generate_series(1, :event_count) AS gs
            ), shaped AS (
                SELECT
                    generated.*,
                    layer.layer_key,
                    condition.id AS condition_id,
                    'param_' || lpad(parameter_no::text, 4, '0') AS parameter_code,
                    CASE WHEN gs % 997 = 0 THEN 'qa-bot' ELSE 'dev-admin' END AS actor,
                    CASE WHEN gs % 4 = 0 THEN 'paste' ELSE 'manual' END AS cell_origin
                FROM generated
                JOIN sheet_layer AS layer
                  ON layer.project_id = :project_id AND layer.sort_order = generated.layer_no
                JOIN layer_condition AS condition
                  ON condition.layer_id = layer.id AND condition.condition_index = 0
            )
            INSERT INTO change_event (
                project_id, event_type, actor, payload, condition_id, parameter_code,
                old_value, new_value, layer_key, batch_id, origin, source_project_id,
                source_layer_key, created_at
            )
            SELECT
                :project_id,
                event_type,
                actor,
                CASE event_type
                    WHEN 'cell_update' THEN jsonb_build_object(
                        'batch_id', 'bulk-' || cell_origin || '-' || lpad((gs / 20)::text, 6, '0'),
                        'origin', cell_origin
                    )
                    WHEN 'condition_add' THEN jsonb_build_object(
                        'layer_key', layer_key,
                        'condition_id', condition_id,
                        'source_condition_id', NULL,
                        'snapshot', jsonb_build_object(
                            'label', 'base', 'condition_index', 0, 'is_por', true,
                            'cells', jsonb_build_object(parameter_code, 'value-' || gs::text)
                        )
                    )
                    WHEN 'condition_remove' THEN jsonb_build_object(
                        'layer_key', layer_key,
                        'condition_id', condition_id,
                        'snapshot', jsonb_build_object(
                            'label', 'base', 'condition_index', 0, 'is_por', true,
                            'cells', jsonb_build_object(parameter_code, 'value-' || gs::text)
                        )
                    )
                    WHEN 'por_change' THEN jsonb_build_object(
                        'layer_key', layer_key,
                        'old_por_condition_id', NULL,
                        'new_por_condition_id', condition_id
                    )
                    ELSE jsonb_build_object(
                        'changes', jsonb_build_object(
                            'comment', jsonb_build_object('old', 'old', 'new', 'new')
                        )
                    )
                END,
                CASE WHEN event_type <> 'project_profile_update' THEN condition_id END,
                CASE WHEN event_type = 'cell_update' THEN parameter_code END,
                CASE WHEN event_type = 'cell_update' THEN 'old-' || gs::text END,
                CASE WHEN event_type = 'cell_update' THEN 'new-' || gs::text END,
                CASE WHEN event_type <> 'project_profile_update' THEN layer_key END,
                CASE WHEN event_type = 'cell_update'
                    THEN 'bulk-' || cell_origin || '-' || lpad((gs / 20)::text, 6, '0')
                END,
                CASE WHEN event_type = 'cell_update' THEN cell_origin ELSE 'manual' END,
                CASE WHEN gs % 101 = 0 THEN :project_id END,
                CASE WHEN gs % 101 = 0 THEN layer_key END,
                timestamp with time zone '2026-07-16 00:00:00+00'
                    + make_interval(secs => gs)
            FROM shaped
            """
        ),
        {
            "project_id": project_id,
            "event_count": _BASE_EVENT_COUNT,
            "layer_count": _LAYER_COUNT,
            "parameter_count": _PARAMETER_COUNT,
        },
    )


def _seed_special_events(
    connection: Connection,
    *,
    project_id: int,
    current_condition_id: int,
    deleted_condition_id: int,
    layer_key: str,
    source_layer_key: str,
    snapshot: Mapping[str, Any],
) -> tuple[str, str, str, str]:
    base_time = datetime(2026, 7, 20, 0, 0, tzinfo=UTC)
    detail_batch_id = "batch-detail-100"
    paste_batch_id = "batch-paste-200"
    v1_batch_id = "batch-capture-v1"
    v2_batch_id = "batch-capture-v2"
    deleted_snapshot = {
        "label": "deleted",
        "condition_index": 1,
        "is_por": False,
        "cells": {f"param_{index:04d}": f"deleted-{index:04d}" for index in range(200)},
    }
    _insert_json_event(
        connection,
        project_id=project_id,
        event_type="condition_add",
        actor="dev-admin",
        payload={
            "layer_key": layer_key,
            "condition_id": deleted_condition_id,
            "source_condition_id": None,
            "snapshot": deleted_snapshot,
        },
        condition_id=deleted_condition_id,
        layer_key=layer_key,
        origin="manual",
        created_at=base_time,
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO change_event (
                project_id, event_type, actor, payload, condition_id, parameter_code,
                old_value, new_value, layer_key, batch_id, origin, created_at
            )
            SELECT
                :project_id, 'cell_update', 'dev-admin',
                jsonb_build_object('batch_id', 'batch-deleted-history', 'origin', 'manual'),
                :condition_id, :parameter_code, 'deleted-old-' || gs::text,
                'deleted-new-' || gs::text, :layer_key, 'batch-deleted-history',
                'manual', :created_at + make_interval(secs => gs)
            FROM generate_series(1, :count) AS gs
            """
        ),
        {
            "project_id": project_id,
            "condition_id": deleted_condition_id,
            "parameter_code": _TARGET_PARAMETER_CODE,
            "layer_key": layer_key,
            "created_at": base_time,
            "count": _DELETED_HISTORY_SIZE,
        },
    )
    _insert_json_event(
        connection,
        project_id=project_id,
        event_type="condition_remove",
        actor="dev-admin",
        payload={
            "layer_key": layer_key,
            "condition_id": deleted_condition_id,
            "snapshot": deleted_snapshot,
        },
        condition_id=deleted_condition_id,
        layer_key=layer_key,
        origin="manual",
        created_at=base_time + timedelta(seconds=51),
    )
    _insert_json_event(
        connection,
        project_id=project_id,
        event_type="por_change",
        actor="dev-admin",
        payload={
            "layer_key": layer_key,
            "old_por_condition_id": None,
            "new_por_condition_id": current_condition_id,
        },
        condition_id=current_condition_id,
        layer_key=layer_key,
        origin="manual",
        created_at=base_time + timedelta(seconds=52),
    )
    _insert_json_event(
        connection,
        project_id=project_id,
        event_type="project_profile_update",
        actor="dev-admin",
        payload={"changes": {"comment": {"old": None, "new": "history benchmark"}}},
        origin="manual",
        created_at=base_time + timedelta(seconds=53),
    )
    capture_detail = [
        {
            "target_condition_id": current_condition_id,
            "source_condition_id": 7007,
            "label": "base",
            "condition_index": 0,
            "is_por": True,
            "cell_count": _PARAMETER_COUNT,
        }
    ]
    common_capture = {
        "captured_at": "2026-07-20T00:00:54Z",
        "target_layer_key": layer_key,
        "source_project_id": project_id,
        "source_layer_key": source_layer_key,
        "capture": snapshot,
        "detail": capture_detail,
    }
    _insert_json_event(
        connection,
        project_id=project_id,
        event_type="backbone_layer_replace",
        actor="dev-admin",
        payload={"batch_id": v1_batch_id, **common_capture},
        layer_key=layer_key,
        batch_id=v1_batch_id,
        origin="backbone",
        source_project_id=project_id,
        source_layer_key=source_layer_key,
        created_at=base_time + timedelta(seconds=54),
    )
    _insert_json_event(
        connection,
        project_id=project_id,
        event_type="backbone_layer_replace",
        actor="dev-admin",
        payload={
            "payload_schema_version": 2,
            "batch_id": v2_batch_id,
            "before": {"condition_count": 1, "cell_count": 200},
            "after": {"condition_count": 1, "cell_count": 200},
            **common_capture,
        },
        layer_key=layer_key,
        batch_id=v2_batch_id,
        origin="backbone",
        source_project_id=project_id,
        source_layer_key=source_layer_key,
        created_at=base_time + timedelta(seconds=55),
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO change_event (
                project_id, event_type, actor, payload, condition_id, parameter_code,
                old_value, new_value, layer_key, batch_id, origin, created_at
            )
            SELECT
                :project_id, 'cell_update', 'dev-admin',
                jsonb_build_object('batch_id', :batch_id, 'origin', 'manual'),
                :condition_id, :parameter_code, 'detail-old-' || gs::text,
                'detail-new-' || gs::text, :layer_key, :batch_id, 'manual',
                :created_at + make_interval(secs => gs)
            FROM generate_series(1, :count) AS gs
            """
        ),
        {
            "project_id": project_id,
            "batch_id": detail_batch_id,
            "condition_id": current_condition_id,
            "parameter_code": _TARGET_PARAMETER_CODE,
            "layer_key": layer_key,
            "created_at": base_time + timedelta(seconds=55),
            "count": _DETAIL_BATCH_SIZE,
        },
    )
    paste_condition_id = _scalar(
        connection,
        """
        SELECT condition.id
        FROM layer_condition AS condition
        JOIN sheet_layer AS layer ON layer.id = condition.layer_id
        WHERE layer.project_id = :project_id AND layer.layer_key = :source_layer_key
        """,
        {"project_id": project_id, "source_layer_key": source_layer_key},
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO change_event (
                project_id, event_type, actor, payload, condition_id, parameter_code,
                old_value, new_value, layer_key, batch_id, origin, created_at
            )
            SELECT
                :project_id, 'cell_update', 'dev-admin',
                jsonb_build_object('batch_id', :batch_id, 'origin', 'paste'),
                :condition_id, parameter.code, 'paste-old-' || parameter.code,
                'paste-new-' || parameter.code, :layer_key, :batch_id, 'paste',
                :created_at + make_interval(secs => parameter.sort_order)
            FROM parameter ORDER BY parameter.sort_order
            """
        ),
        {
            "project_id": project_id,
            "batch_id": paste_batch_id,
            "condition_id": paste_condition_id,
            "layer_key": source_layer_key,
            "created_at": base_time + timedelta(seconds=155),
        },
    )
    return detail_batch_id, paste_batch_id, v1_batch_id, v2_batch_id


def _fixture_invariants(
    connection: Connection, *, project_id: int, deleted_condition_id: int
) -> dict[str, int]:
    values = {
        "project_count": _scalar(connection, "SELECT count(*) FROM project"),
        "measured_event_count": _scalar(
            connection,
            "SELECT count(*) FROM change_event WHERE project_id = :project_id",
            {"project_id": project_id},
        ),
        "total_event_count": _scalar(connection, "SELECT count(*) FROM change_event"),
        "layer_count": _scalar(
            connection,
            "SELECT count(*) FROM sheet_layer WHERE project_id = :project_id",
            {"project_id": project_id},
        ),
        "condition_count": _scalar(
            connection,
            """
            SELECT count(*) FROM layer_condition AS condition
            JOIN sheet_layer AS layer ON layer.id = condition.layer_id
            WHERE layer.project_id = :project_id
            """,
            {"project_id": project_id},
        ),
        "parameter_count": _scalar(connection, "SELECT count(*) FROM parameter"),
        "cell_count": _scalar(
            connection,
            """
            SELECT count(*) FROM cell_value AS cell
            JOIN layer_condition AS condition ON condition.id = cell.condition_id
            JOIN sheet_layer AS layer ON layer.id = condition.layer_id
            WHERE layer.project_id = :project_id
            """,
            {"project_id": project_id},
        ),
        "min_cells_per_condition": _scalar(
            connection,
            """
            SELECT min(cell_count) FROM (
                SELECT condition.id, count(cell.id) AS cell_count
                FROM layer_condition AS condition
                JOIN sheet_layer AS layer ON layer.id = condition.layer_id
                JOIN cell_value AS cell ON cell.condition_id = condition.id
                WHERE layer.project_id = :project_id
                GROUP BY condition.id
            ) AS counts
            """,
            {"project_id": project_id},
        ),
        "max_cells_per_condition": _scalar(
            connection,
            """
            SELECT max(cell_count) FROM (
                SELECT condition.id, count(cell.id) AS cell_count
                FROM layer_condition AS condition
                JOIN sheet_layer AS layer ON layer.id = condition.layer_id
                JOIN cell_value AS cell ON cell.condition_id = condition.id
                WHERE layer.project_id = :project_id
                GROUP BY condition.id
            ) AS counts
            """,
            {"project_id": project_id},
        ),
        "deleted_condition_count": _scalar(
            connection,
            "SELECT count(*) FROM layer_condition WHERE id = :condition_id",
            {"condition_id": deleted_condition_id},
        ),
        "writer_shape_count": _scalar(
            connection,
            """
            SELECT count(DISTINCT event_type) FROM change_event
            WHERE project_id = :project_id
              AND event_type IN (
                'project_create', 'cell_update', 'condition_add', 'condition_remove',
                'por_change', 'project_profile_update', 'backbone_layer_replace'
              )
            """,
            {"project_id": project_id},
        ),
        "v2_capture_count": _scalar(
            connection,
            """
            SELECT count(*) FROM change_event
            WHERE project_id = :project_id
              AND event_type IN ('backbone_copy', 'backbone_layer_replace')
              AND payload->>'payload_schema_version' = '2'
              AND jsonb_typeof(payload->'capture') = 'object'
              AND jsonb_typeof(payload->'detail') = 'array'
              AND payload->>'batch_id' = batch_id
            """,
            {"project_id": project_id},
        ),
        "v1_capture_count": _scalar(
            connection,
            """
            SELECT count(*) FROM change_event
            WHERE project_id = :project_id
              AND event_type IN ('backbone_copy', 'backbone_layer_replace')
              AND NOT (payload ? 'payload_schema_version')
            """,
            {"project_id": project_id},
        ),
    }
    expected = {
        "project_count": 1,
        "measured_event_count": _HISTORY_EVENT_COUNT,
        "total_event_count": _HISTORY_EVENT_COUNT,
        "layer_count": _LAYER_COUNT,
        "condition_count": _LAYER_COUNT,
        "parameter_count": _PARAMETER_COUNT,
        "cell_count": _CELL_COUNT,
        "min_cells_per_condition": _PARAMETER_COUNT,
        "max_cells_per_condition": _PARAMETER_COUNT,
        "deleted_condition_count": 0,
        "writer_shape_count": 7,
        "v2_capture_count": 1,
        "v1_capture_count": 1,
    }
    assert values == expected, f"fixture invariant mismatch: {values!r}"
    return values


def _seed_history_fixture(connection: Connection) -> HistoryFixture:
    project_id = _scalar(
        connection,
        """
        INSERT INTO project (line_id, process_id, part_id, name)
        VALUES ('L1', 'PROC_HISTORY_PERF', 'PART_HISTORY_PERF', 'History performance')
        RETURNING id
        """,
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO project_profile (
                project_id, process_name, device_type_code, project_category_code, comment
            ) VALUES (:project_id, 'History performance', 'DEFAULT', 'DEFAULT', 'seed')
            """
        ),
        {"project_id": project_id},
    )
    _seed_parameters(connection)
    current_id, deleted_id, layer_key, source_layer_key = _seed_grid(
        connection, project_id
    )
    source_layer_id = _scalar(
        connection,
        "SELECT id FROM sheet_layer WHERE project_id=:project_id AND layer_key=:layer_key",
        {"project_id": project_id, "layer_key": source_layer_key},
    )
    snapshot = _capture_snapshot(
        project_id=project_id,
        source_layer_id=source_layer_id,
        source_layer_key=source_layer_key,
    )
    connection.execute(
        sa.text(
            """
            UPDATE sheet_layer SET backbone_snapshot = CAST(:snapshot AS jsonb)
            WHERE project_id = :project_id AND layer_key = :layer_key
            """
        ),
        {
            "snapshot": json.dumps(snapshot, sort_keys=True),
            "project_id": project_id,
            "layer_key": layer_key,
        },
    )
    _insert_json_event(
        connection,
        project_id=project_id,
        event_type="project_create",
        actor="system",
        payload={
            "payload_schema_version": 2,
            "batch_id": "project-create-batch",
            "captured_at": "2026-07-16T00:00:00Z",
            "identity": {
                "line_id": "L1",
                "process_id": "PROC_HISTORY_PERF",
                "part_id": "PART_HISTORY_PERF",
                "name": "History performance",
            },
            "metadata_provider": "benchmark",
            "backbone_project_id": project_id,
            "profile_seed": {},
            "profile_final": {"process_name": "History performance"},
        },
        batch_id="project-create-batch",
        origin="system",
        source_project_id=project_id,
        created_at=datetime(2026, 7, 16, 0, 0, tzinfo=UTC),
    )
    _seed_bulk_events(connection, project_id=project_id)
    detail_batch, paste_batch, v1_batch, v2_batch = _seed_special_events(
        connection,
        project_id=project_id,
        current_condition_id=current_id,
        deleted_condition_id=deleted_id,
        layer_key=layer_key,
        source_layer_key=source_layer_key,
        snapshot=snapshot,
    )
    connection.execute(
        sa.text("DELETE FROM layer_condition WHERE id = :condition_id"),
        {"condition_id": deleted_id},
    )
    connection.commit()
    connection.execute(sa.text("ANALYZE"))
    connection.commit()
    invariants = _fixture_invariants(
        connection, project_id=project_id, deleted_condition_id=deleted_id
    )
    max_event_id = _scalar(
        connection,
        "SELECT max(id) FROM change_event WHERE project_id = :project_id",
        {"project_id": project_id},
    )
    return HistoryFixture(
        project_id=project_id,
        current_condition_id=current_id,
        deleted_condition_id=deleted_id,
        current_layer_key=layer_key,
        source_layer_key=source_layer_key,
        detail_batch_id=detail_batch,
        paste_batch_id=paste_batch,
        v1_capture_batch_id=v1_batch,
        v2_capture_batch_id=v2_batch,
        max_event_id=max_event_id,
        period_from=datetime(2026, 7, 20, 0, 0, tzinfo=UTC),
        invariants=invariants,
    )


# The production measurement and plan gate are appended below this fixture builder.
