"""Production-bound PostgreSQL performance gate for Phase 4 history."""

# ruff: noqa: E402 -- direct script execution must add backend/ before app imports.

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
from alembic.config import Config
from pydantic import BaseModel
from sqlalchemy import event
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models  # noqa: F401 -- register all production models for migrations
from alembic import command
from app.domain.backbone.snapshot import (
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
    serialize_backbone_snapshot,
)
from app.domain.parameters.types import ValueType
from app.features.cells.repository import CellRepository
from app.features.cells.schema import CellsPatchIn, CellUpdateIn
from app.features.cells.service import CellService
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
from app.models.project import ChangeEvent, ChangeEventType
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
_RETIRED_INDEXES = {
    "ix_change_event_project_id",
    "ix_change_event_event_type",
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
            # SQLAlchemy persists the enum member name (for example
            # ``CELL_UPDATE``), not the StrEnum value.  The bulk fixture uses
            # raw SQL for setup speed, so mirror the real writer encoding.
            "event_type": ChangeEventType(event_type).name,
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
                        WHEN gs % 10 < 6 THEN 'CELL_UPDATE'
                        WHEN gs % 10 = 6 THEN 'CONDITION_ADD'
                        WHEN gs % 10 = 7 THEN 'CONDITION_REMOVE'
                        WHEN gs % 10 = 8 THEN 'POR_CHANGE'
                        ELSE 'PROJECT_PROFILE_UPDATE'
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
                    WHEN 'CELL_UPDATE' THEN jsonb_build_object(
                        'batch_id', 'bulk-' || cell_origin || '-' || lpad((gs / 20)::text, 6, '0'),
                        'origin', cell_origin
                    )
                    WHEN 'CONDITION_ADD' THEN jsonb_build_object(
                        'layer_key', layer_key,
                        'condition_id', condition_id,
                        'source_condition_id', NULL,
                        'snapshot', jsonb_build_object(
                            'label', 'base', 'condition_index', 0, 'is_por', true,
                            'cells', jsonb_build_object(parameter_code, 'value-' || gs::text)
                        )
                    )
                    WHEN 'CONDITION_REMOVE' THEN jsonb_build_object(
                        'layer_key', layer_key,
                        'condition_id', condition_id,
                        'snapshot', jsonb_build_object(
                            'label', 'base', 'condition_index', 0, 'is_por', true,
                            'cells', jsonb_build_object(parameter_code, 'value-' || gs::text)
                        )
                    )
                    WHEN 'POR_CHANGE' THEN jsonb_build_object(
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
                CASE WHEN event_type <> 'PROJECT_PROFILE_UPDATE' THEN condition_id END,
                CASE WHEN event_type = 'CELL_UPDATE' THEN parameter_code END,
                CASE WHEN event_type = 'CELL_UPDATE' THEN 'old-' || gs::text END,
                CASE WHEN event_type = 'CELL_UPDATE' THEN 'new-' || gs::text END,
                CASE WHEN event_type <> 'PROJECT_PROFILE_UPDATE' THEN layer_key END,
                CASE WHEN event_type = 'CELL_UPDATE'
                    THEN 'bulk-' || cell_origin || '-' || lpad((gs / 20)::text, 6, '0')
                END,
                CASE WHEN event_type = 'CELL_UPDATE' THEN cell_origin ELSE 'manual' END,
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
                :project_id, 'CELL_UPDATE', 'dev-admin',
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
                :project_id, 'CELL_UPDATE', 'dev-admin',
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
                :project_id, 'CELL_UPDATE', 'dev-admin',
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
                'PROJECT_CREATE', 'CELL_UPDATE', 'CONDITION_ADD', 'CONDITION_REMOVE',
                'POR_CHANGE', 'PROJECT_PROFILE_UPDATE', 'BACKBONE_LAYER_REPLACE'
              )
            """,
            {"project_id": project_id},
        ),
        "v2_capture_count": _scalar(
            connection,
            """
            SELECT count(*) FROM change_event
            WHERE project_id = :project_id
              AND event_type IN ('BACKBONE_COPY', 'BACKBONE_LAYER_REPLACE')
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
              AND event_type IN ('BACKBONE_COPY', 'BACKBONE_LAYER_REPLACE')
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
    current_id, deleted_id, layer_key, source_layer_key = _seed_grid(connection, project_id)
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
    # Measure a steady-state query plan, not heap visibility work or a checkpoint
    # caused by the 100k-row fixture itself.  ANALYZE alone leaves every freshly
    # inserted page outside the visibility map, making index-only plans depend on
    # when the shared CI runner happens to schedule autovacuum/checkpoint I/O.
    # VACUUM must run outside a transaction; the benchmark database owner is the
    # disposable test-database owner in both local integration and CI.
    with connection.engine.connect().execution_options(
        isolation_level="AUTOCOMMIT"
    ) as maintenance_connection:
        maintenance_connection.execute(sa.text("VACUUM (ANALYZE)"))
        maintenance_connection.execute(sa.text("CHECKPOINT"))
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


@contextmanager
def _sql_counter(engine: AsyncEngine) -> Iterator[list[str]]:
    statements: list[str] = []

    def _record(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _record)
    try:
        yield statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _record)


async def _timeline_request(
    factory: async_sessionmaker[AsyncSession],
    fixture: HistoryFixture,
    query: HistoryTimelineQueryIn,
) -> BaseModel:
    async with factory() as session:
        return await HistoryService(HistoryRepository(session)).list_events(
            fixture.project_id, query
        )


async def _detail_request(
    factory: async_sessionmaker[AsyncSession],
    fixture: HistoryFixture,
    query: HistoryDetailQueryIn,
) -> BaseModel:
    async with factory() as session:
        return await HistoryService(HistoryRepository(session)).get_batch(
            fixture.project_id, fixture.detail_batch_id, query
        )


async def _cell_request(
    factory: async_sessionmaker[AsyncSession],
    fixture: HistoryFixture,
    query: HistoryCellHistoryQueryIn,
) -> BaseModel:
    async with factory() as session:
        return await HistoryService(HistoryRepository(session)).get_cell_history(
            fixture.project_id, query
        )


async def _measure_series(
    engine: AsyncEngine,
    *,
    label: str,
    request: Callable[[], Awaitable[BaseModel]],
    warmup_runs: int = _WARMUP_RUNS,
    timed_runs: int = _TIMED_RUNS,
) -> QueryBenchmark:
    for _ in range(warmup_runs):
        response = await request()
        response.model_dump_json()

    samples: list[float] = []
    sql_counts: list[int] = []
    serialized_bytes: list[int] = []
    for _ in range(timed_runs):
        with _sql_counter(engine) as statements:
            started = time.perf_counter()
            response = await request()
            envelope = response.model_dump_json().encode("utf-8")
            elapsed_ms = (time.perf_counter() - started) * 1000
        samples.append(elapsed_ms)
        sql_counts.append(len(statements))
        serialized_bytes.append(len(envelope))

    ordered = sorted(samples)
    p95_index = max(0, math.ceil(0.95 * len(ordered)) - 1)
    return QueryBenchmark(
        label=label,
        samples_ms=tuple(round(value, 3) for value in samples),
        sql_counts=tuple(sql_counts),
        serialized_bytes=tuple(serialized_bytes),
        p50_ms=statistics.median(ordered),
        p95_ms=ordered[p95_index],
        max_ms=max(ordered),
        max_sql_count=max(sql_counts),
        max_serialized_bytes=max(serialized_bytes),
    )


def _query_budget_failures(
    benchmark: QueryBenchmark,
    *,
    max_p95_ms: float,
    max_sql_count: int | None,
    max_serialized_bytes: int | None,
) -> list[str]:
    failures: list[str] = []
    if benchmark.p95_ms > max_p95_ms:
        failures.append(f"{benchmark.label}.p95_ms: {benchmark.p95_ms:.3f} > {max_p95_ms:.3f}")
    if max_sql_count is not None and benchmark.max_sql_count > max_sql_count:
        failures.append(f"{benchmark.label}.sql_count: {benchmark.max_sql_count} > {max_sql_count}")
    if max_serialized_bytes is not None and benchmark.max_serialized_bytes > max_serialized_bytes:
        failures.append(
            f"{benchmark.label}.serialized_bytes: "
            f"{benchmark.max_serialized_bytes} > {max_serialized_bytes}"
        )
    return failures


def _assert_query_budget(
    benchmark: QueryBenchmark,
    *,
    max_p95_ms: float,
    max_sql_count: int | None,
    max_serialized_bytes: int | None = _PAGE_BYTE_LIMIT,
) -> None:
    failures = _query_budget_failures(
        benchmark,
        max_p95_ms=max_p95_ms,
        max_sql_count=max_sql_count,
        max_serialized_bytes=max_serialized_bytes,
    )
    assert not failures, "\n".join(failures)


def _plan_nodes(plan: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    nodes = [plan]
    children = plan.get("Plans")
    if isinstance(children, list):
        for child in children:
            if isinstance(child, Mapping):
                nodes.extend(_plan_nodes(child))
    return nodes


async def _explain_statement(
    session: AsyncSession,
    *,
    label: str,
    statement: Any,
    expected_index: str,
) -> PlanEvidence:
    compiled = statement.compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    )
    raw = (
        await session.execute(sa.text(f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {compiled}"))
    ).scalar_one()
    decoded = json.loads(raw) if isinstance(raw, str) else raw
    root = decoded[0]["Plan"]
    nodes = _plan_nodes(root)
    indexes = tuple(
        sorted(
            {
                str(index_name)
                for node in nodes
                if (index_name := node.get("Index Name")) is not None
            }
        )
    )
    node_types = tuple(
        str(node.get("Node Type", "unknown"))
        + (f":{node['Relation Name']}" if node.get("Relation Name") is not None else "")
        for node in nodes
    )
    seq_scans = tuple(
        node_type
        for node_type in node_types
        if node_type in {"Seq Scan:change_event", "Parallel Seq Scan:change_event"}
    )
    return PlanEvidence(
        label=label,
        expected_index=expected_index,
        used_indexes=indexes,
        node_types=node_types,
        change_event_seq_scans=seq_scans,
        plan=root,
    )


def _plan_failures(evidence: PlanEvidence) -> list[str]:
    failures: list[str] = []
    if evidence.expected_index not in evidence.used_indexes:
        failures.append(
            f"{evidence.label}.index: expected {evidence.expected_index}; "
            f"used={list(evidence.used_indexes)!r}; "
            f"nodes={list(evidence.node_types)!r}"
        )
    if evidence.change_event_seq_scans:
        failures.append(
            f"{evidence.label}.change_event_seq_scan: {list(evidence.change_event_seq_scans)!r}"
        )
    return failures


def _retired_index_failures(index_names: set[str]) -> list[str]:
    retired_indexes = sorted(_RETIRED_INDEXES & index_names)
    if not retired_indexes:
        return []
    return [f"index_definitions.retired_legacy_present: {retired_indexes!r}"]


async def _collect_plan_evidence(
    factory: async_sessionmaker[AsyncSession], fixture: HistoryFixture
) -> tuple[dict[str, PlanEvidence], set[str]]:
    async with factory() as session:
        repo = HistoryRepository(session)
        timeline_scopes = {
            "timeline_unfiltered": (
                HistoryMemberFilterScope(),
                "ix_change_event_project_id_id_desc",
            ),
            "timeline_layer_filtered": (
                HistoryMemberFilterScope(layer_keys=(fixture.current_layer_key,)),
                "ix_change_event_project_layer_id_desc",
            ),
            "timeline_type_filtered": (
                HistoryMemberFilterScope(event_types=("backbone_layer_replace",)),
                "ix_change_event_project_type_id_desc",
            ),
            "timeline_actor_filtered": (
                HistoryMemberFilterScope(actors=("qa-bot",)),
                "ix_change_event_project_actor_id_desc",
            ),
            "timeline_origin_filtered": (
                HistoryMemberFilterScope(origins=("backbone",)),
                "ix_change_event_project_origin_id_desc",
            ),
            "timeline_source_filtered": (
                HistoryMemberFilterScope(source_project_ids=(fixture.project_id,)),
                "ix_change_event_project_source_id_desc",
            ),
            "timeline_period_filtered": (
                HistoryMemberFilterScope(created_from=fixture.period_from),
                "ix_change_event_project_created_id_desc",
            ),
        }
        plans: dict[str, PlanEvidence] = {}
        for label, (scope, expected_index) in timeline_scopes.items():
            statement = repo._timeline_summary_stmt(
                fixture.project_id,
                member_filters=scope,
                snapshot_max_event_id=fixture.max_event_id,
                before_group_max_id=None,
                limit=_TIMELINE_LIMIT + 1,
            )
            plans[label] = await _explain_statement(
                session,
                label=label,
                statement=statement,
                expected_index=expected_index,
            )

        batch_statement = (
            repo._event_row_stmt(
                fixture.project_id,
                snapshot_max_event_id=None,
                with_payload=False,
            )
            .where(
                ChangeEvent.batch_id == fixture.detail_batch_id,
                ChangeEvent.event_type == "cell_update",
            )
            .order_by(ChangeEvent.id.desc())
            .limit(_DETAIL_LIMIT + 1)
        )
        plans["batch_detail"] = await _explain_statement(
            session,
            label="batch_detail",
            statement=batch_statement,
            expected_index="ix_change_event_project_batch_id_desc",
        )
        cell_statement = (
            repo._event_row_stmt(
                fixture.project_id,
                snapshot_max_event_id=None,
                with_payload=True,
            )
            .where(
                ChangeEvent.condition_id == fixture.current_condition_id,
                ChangeEvent.parameter_code == _TARGET_PARAMETER_CODE,
                ChangeEvent.event_type == "cell_update",
            )
            .order_by(ChangeEvent.id.desc())
            .limit(_CELL_HISTORY_LIMIT + 1)
        )
        plans["cell_history"] = await _explain_statement(
            session,
            label="cell_history",
            statement=cell_statement,
            expected_index="ix_change_event_project_cell_id_desc",
        )
        index_rows = (
            await session.execute(
                sa.text(
                    """
                    SELECT indexname FROM pg_indexes
                    WHERE schemaname = current_schema()
                      AND tablename = 'change_event'
                    """
                )
            )
        ).scalars()
        return plans, {str(name) for name in index_rows}


def _seed_overhead_fixture(connection: Connection) -> tuple[int, int]:
    project_id = _scalar(
        connection,
        """
        INSERT INTO project (line_id, process_id, part_id, name)
        VALUES ('L1', 'PROC_OVERHEAD', 'PART_OVERHEAD', 'History overhead')
        RETURNING id
        """,
    )
    _seed_parameters(connection)
    layer_key = "L1::OVERHEAD::000::L00"
    layer_id = _scalar(
        connection,
        """
        INSERT INTO sheet_layer (project_id, layer_key, step_seq, layer_id, sort_order)
        VALUES (:project_id, :layer_key, '000', 'L00', 0)
        RETURNING id
        """,
        {"project_id": project_id, "layer_key": layer_key},
    )
    condition_id = _scalar(
        connection,
        """
        INSERT INTO layer_condition (layer_id, label, condition_index, is_por)
        VALUES (:layer_id, 'base', 0, true)
        RETURNING id
        """,
        {"layer_id": layer_id},
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO cell_value (condition_id, parameter_code, value_text)
            SELECT :condition_id, code, 'old-' || code FROM parameter
            """
        ),
        {"condition_id": condition_id},
    )
    connection.commit()
    return project_id, condition_id


async def _measure_write_series(
    database_url: str,
    *,
    label: str,
    project_id: int,
    condition_id: int,
    warmup_runs: int,
    timed_runs: int,
) -> WriteBenchmark:
    engine = create_async_engine(database_url)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    request = CellsPatchIn(
        cells=[
            CellUpdateIn(
                condition_id=condition_id,
                parameter_code=f"param_{index:04d}",
                value=f"new-param_{index:04d}",
            )
            for index in range(_PASTE_BATCH_SIZE)
        ],
        origin="paste",
    )

    async def run_once() -> float:
        async with factory() as session:
            started = time.perf_counter()
            response = await CellService(CellRepository(session)).patch_cells(
                project_id,
                request,
                actor="dev-admin",
            )
            elapsed = (time.perf_counter() - started) * 1000
            assert len(response.cells) == _PASTE_BATCH_SIZE
            # Flush/index maintenance is complete. Roll back after timing so every
            # sample starts from the exact same 200 current values.
            await session.rollback()
            return elapsed

    try:
        for _ in range(warmup_runs):
            await run_once()
        samples = [await run_once() for _ in range(timed_runs)]
        ordered = sorted(samples)
        p95_index = max(0, math.ceil(0.95 * len(ordered)) - 1)
        return WriteBenchmark(
            label=label,
            samples_ms=tuple(round(value, 3) for value in samples),
            p50_ms=statistics.median(ordered),
            p95_ms=ordered[p95_index],
            max_ms=max(ordered),
        )
    finally:
        await engine.dispose()


async def _measure_paste_overhead(
    *, warmup_runs: int, timed_runs: int
) -> tuple[dict[str, Any], list[str]]:
    results: dict[str, WriteBenchmark] = {}
    for revision in ("0006", "head"):
        with temporary_postgres_database() as database:
            migration_db = _prepare_database(database, target=revision)
            try:
                project_id, condition_id = _seed_overhead_fixture(migration_db.connection)
                database_url = database.async_url
            finally:
                migration_db.connection.close()
                migration_db.connection.engine.dispose()
            results[revision] = await _measure_write_series(
                database_url,
                label=f"paste_overhead_{revision}",
                project_id=project_id,
                condition_id=condition_id,
                warmup_runs=warmup_runs,
                timed_runs=timed_runs,
            )
    pre = results["0006"]
    post = results["head"]
    ratio = (post.p50_ms - pre.p50_ms) / pre.p50_ms if pre.p50_ms else math.inf
    failures = []
    if ratio > _PASTE_OVERHEAD_MAX_RATIO:
        failures.append(
            f"paste_overhead.ratio: {ratio:.6f} > {_PASTE_OVERHEAD_MAX_RATIO:.6f}; "
            f"pre_samples={list(pre.samples_ms)!r}; "
            f"post_samples={list(post.samples_ms)!r}"
        )
    return {
        "pre_0007": pre,
        "post_0007": post,
        "overhead_ratio": ratio,
        "limit_ratio": _PASTE_OVERHEAD_MAX_RATIO,
    }, failures


async def _build_report(
    *,
    warmup_runs: int = _WARMUP_RUNS,
    timed_runs: int = _TIMED_RUNS,
    compare_paste_overhead: bool = False,
) -> dict[str, Any]:
    failures: list[str] = []
    with temporary_postgres_database() as database:
        migration_db = _prepare_database(database)
        try:
            fixture = _seed_history_fixture(migration_db.connection)
            postgres_version = str(
                migration_db.connection.execute(sa.text("SELECT version()")).scalar_one()
            )
        finally:
            migration_db.connection.close()
            migration_db.connection.engine.dispose()

        async_engine = create_async_engine(database.async_url)
        factory = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
        try:
            timeline_query = HistoryTimelineQueryIn(limit=_TIMELINE_LIMIT)
            filtered_query = HistoryTimelineQueryIn(
                limit=_TIMELINE_LIMIT,
                layer_key=fixture.current_layer_key,
            )
            detail_scope = encode_history_detail_scope(
                HistoryDetailScope(
                    project_id=fixture.project_id,
                    batch_id=fixture.detail_batch_id,
                )
            )
            detail_query = HistoryDetailQueryIn(
                scope=detail_scope,
                limit=_DETAIL_LIMIT,
            )
            current_query = HistoryCellHistoryQueryIn(
                condition_id=fixture.current_condition_id,
                parameter_code=_TARGET_PARAMETER_CODE,
                limit=_CELL_HISTORY_LIMIT,
            )
            deleted_query = HistoryCellHistoryQueryIn(
                condition_id=fixture.deleted_condition_id,
                parameter_code=_TARGET_PARAMETER_CODE,
                limit=_CELL_HISTORY_LIMIT,
            )
            timeline_unfiltered = await _measure_series(
                async_engine,
                label="timeline_unfiltered",
                request=lambda: _timeline_request(factory, fixture, timeline_query),
                warmup_runs=warmup_runs,
                timed_runs=timed_runs,
            )
            timeline_layer_filtered = await _measure_series(
                async_engine,
                label="timeline_layer_filtered",
                request=lambda: _timeline_request(factory, fixture, filtered_query),
                warmup_runs=warmup_runs,
                timed_runs=timed_runs,
            )
            batch_detail = await _measure_series(
                async_engine,
                label="batch_detail",
                request=lambda: _detail_request(factory, fixture, detail_query),
                warmup_runs=warmup_runs,
                timed_runs=timed_runs,
            )
            cell_history_current = await _measure_series(
                async_engine,
                label="cell_history_current",
                request=lambda: _cell_request(factory, fixture, current_query),
                warmup_runs=warmup_runs,
                timed_runs=timed_runs,
            )
            cell_history_deleted = await _measure_series(
                async_engine,
                label="cell_history_deleted",
                request=lambda: _cell_request(factory, fixture, deleted_query),
                warmup_runs=warmup_runs,
                timed_runs=timed_runs,
            )
            plans, index_names = await _collect_plan_evidence(factory, fixture)
        finally:
            await async_engine.dispose()

    failures.extend(
        _query_budget_failures(
            timeline_unfiltered,
            max_p95_ms=_TIMELINE_MAX_MS,
            max_sql_count=_TIMELINE_MAX_SQL,
            max_serialized_bytes=_PAGE_BYTE_LIMIT,
        )
    )
    failures.extend(
        _query_budget_failures(
            timeline_layer_filtered,
            max_p95_ms=_TIMELINE_MAX_MS,
            max_sql_count=_TIMELINE_MAX_SQL,
            max_serialized_bytes=_PAGE_BYTE_LIMIT,
        )
    )
    failures.extend(
        _query_budget_failures(
            batch_detail,
            max_p95_ms=_DETAIL_MAX_MS,
            max_sql_count=_DETAIL_MAX_SQL,
            max_serialized_bytes=_PAGE_BYTE_LIMIT,
        )
    )
    for benchmark in (cell_history_current, cell_history_deleted):
        failures.extend(
            _query_budget_failures(
                benchmark,
                max_p95_ms=_CELL_HISTORY_MAX_MS,
                max_sql_count=None,
                max_serialized_bytes=None,
            )
        )
    missing_indexes = sorted(_REQUIRED_INDEXES - index_names)
    if missing_indexes:
        failures.append(f"index_definitions.missing: {missing_indexes!r}")
    failures.extend(_retired_index_failures(index_names))
    for plan in plans.values():
        failures.extend(_plan_failures(plan))

    report: dict[str, Any] = {
        "binding_mode": "production_service_repository",
        "environment": {
            "python": sys.version.split()[0],
            "postgres": postgres_version,
            "warmup_runs": warmup_runs,
            "timed_runs": timed_runs,
        },
        "fixture": {
            "project_id": fixture.project_id,
            **dict(fixture.invariants),
            "detail_batch_size": _DETAIL_BATCH_SIZE,
            "paste_batch_size": _PASTE_BATCH_SIZE,
        },
        "timeline_unfiltered": timeline_unfiltered,
        "timeline_layer_filtered": timeline_layer_filtered,
        "batch_detail": batch_detail,
        "cell_history_current": cell_history_current,
        "cell_history_deleted": cell_history_deleted,
        "plans": plans,
        "index_definitions": sorted(index_names),
        "failures": failures,
    }
    if compare_paste_overhead:
        overhead, overhead_failures = await _measure_paste_overhead(
            warmup_runs=warmup_runs,
            timed_runs=timed_runs,
        )
        report["paste_overhead"] = overhead
        failures.extend(overhead_failures)
    return report


def _json_default(value: object) -> object:
    if isinstance(value, QueryBenchmark | PlanEvidence | WriteBenchmark):
        return asdict(value)
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"cannot serialize {type(value).__name__}")


def _report_to_json(report: Mapping[str, Any]) -> str:
    return json.dumps(
        report,
        default=_json_default,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )


def _print_text_report(report: Mapping[str, Any]) -> None:
    print("=== Phase 4 history PostgreSQL production gate ===")
    print(f"binding_mode: {report['binding_mode']}")
    fixture = report["fixture"]
    assert isinstance(fixture, Mapping)
    print(
        "fixture: "
        f"projects={fixture['project_count']} layers={fixture['layer_count']} "
        f"parameters={fixture['parameter_count']} cells={fixture['cell_count']} "
        f"events={fixture['measured_event_count']}"
    )
    for label in (
        "timeline_unfiltered",
        "timeline_layer_filtered",
        "batch_detail",
        "cell_history_current",
        "cell_history_deleted",
    ):
        metric = report[label]
        assert isinstance(metric, QueryBenchmark)
        print(
            f"{label}: samples={list(metric.samples_ms)!r} "
            f"p50={metric.p50_ms:.3f}ms p95={metric.p95_ms:.3f}ms "
            f"max={metric.max_ms:.3f}ms sql={list(metric.sql_counts)!r} "
            f"bytes={metric.max_serialized_bytes}"
        )
    overhead = report.get("paste_overhead")
    if isinstance(overhead, Mapping):
        print(
            "paste_overhead: "
            f"ratio={float(overhead['overhead_ratio']):.6f} "
            f"limit={float(overhead['limit_ratio']):.6f}"
        )
    report_failures = report["failures"]
    assert isinstance(report_failures, list)
    if report_failures:
        print("FAILURES:")
        for failure in report_failures:
            print(f"- {failure}")
    else:
        print("PASS: all budgets and plan gates satisfied")


async def _main_async() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compare-paste-overhead", action="store_true")
    parser.add_argument("--emit-json", action="store_true")
    parser.add_argument("--samples", type=int, default=_TIMED_RUNS)
    parser.add_argument("--warmup", type=int, default=_WARMUP_RUNS)
    args = parser.parse_args()
    if args.samples != _TIMED_RUNS or args.warmup != _WARMUP_RUNS:
        raise SystemExit("the binding gate requires exactly --warmup 1 --samples 5")
    report = await _build_report(
        warmup_runs=args.warmup,
        timed_runs=args.samples,
        compare_paste_overhead=args.compare_paste_overhead,
    )
    if args.emit_json:
        print(_report_to_json(report))
    else:
        _print_text_report(report)
    return 1 if report["failures"] else 0


def main() -> None:
    raise SystemExit(asyncio.run(_main_async()))


if __name__ == "__main__":
    main()
