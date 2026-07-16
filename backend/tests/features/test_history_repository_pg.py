"""Repository seams for bounded Phase 4 history reads."""

from __future__ import annotations

import inspect
import os
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import delete, event, update
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

import app.features.history.repository as history_repository_module
import app.models  # noqa: F401 -- register every model for metadata.create_all
from app.core.db import Base
from app.core.errors import ConflictError
from app.domain.backbone.snapshot import (
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
    serialize_backbone_snapshot,
)
from app.domain.parameters.types import ValueType
from app.features.history.cursor import HistoryMemberFilterScope
from app.features.history.projection import HistoryEventRow
from app.features.history.repository import (
    HistoryRepository,
    HistoryTimelineGroupRow,
)
from app.models.project import (
    CellValue,
    ChangeEvent,
    ChangeEventType,
    LayerCondition,
    Project,
    ProjectStatus,
    SheetLayer,
)
from tests.factories import make_project_profile
from tests.postgres_database import temporary_postgres_database

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")


@dataclass(slots=True)
class SmallHistoryFixture:
    project_id: int
    current_condition_id: int
    current_parameter_code: str
    deleted_condition_id: int
    deleted_parameter_code: str
    current_layer_key: str
    deleted_layer_key: str
    batch_copy_id: str
    batch_detail_id: str
    batch_deleted_id: str
    remove_event_id: int
    current_event_ids: tuple[int, ...]
    batch_detail_event_ids: tuple[int, ...]
    deleted_event_ids: tuple[int, ...]
    snapshot_max_event_id: int


@dataclass(slots=True)
class LargeHistoryFixture:
    project_id: int
    layer_a_key: str
    layer_b_key: str
    condition_a_id: int
    condition_b_id: int
    snapshot_max_event_id: int
    batch_id: str
    batch_event_ids: tuple[int, ...]
    noise_event_ids: tuple[int, ...]


@dataclass(slots=True)
class CaptureHistoryFixture:
    project_id: int
    layer_key: str
    condition_id: int
    parameter_code: str
    valid_batch_id: str
    legacy_batch_id: str
    bool_batch_id: str
    wrong_batch_id: str
    corrupt_batch_id: str
    valid_event_ids: tuple[int, ...]
    legacy_event_id: int
    snapshot_max_event_id: int


@dataclass(slots=True)
class DeletedProofFixture:
    project_id: int
    condition_id: int
    parameter_code: str
    layer_key: str
    remove_event_id: int


@pytest.fixture
async def sqlite_engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
        await engine.dispose()


@pytest.fixture
def sqlite_factory(sqlite_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(sqlite_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture
async def pg_engine() -> AsyncIterator[AsyncEngine]:
    assert _PG_URL is not None
    with temporary_postgres_database() as database:
        engine = create_async_engine(database.async_url)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        try:
            yield engine
        finally:
            await engine.dispose()


@pytest.fixture
def pg_factory(pg_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)


def _dt(second: int) -> datetime:
    base = datetime(2026, 7, 16, 1, 0, 0, tzinfo=UTC)
    return base + timedelta(seconds=second)


def _row(
    event_id: int,
    event_type: str,
    *,
    schema_version: int = 2,
    deleted: bool = False,
    **overrides: Any,
) -> HistoryEventRow:
    base: dict[str, Any] = dict(
        event_id=event_id,
        event_type=event_type,
        actor=f"actor-{event_id}",
        created_at=datetime(2026, 7, 16, 8, 0, event_id % 60, tzinfo=UTC),
        batch_id=f"batch-{event_id}",
        origin="manual",
        layer_key=f"L{event_id % 4}",
        layer_sort_order=None,
        condition_id=100 + event_id,
        condition_index=None,
        source_condition_id=None,
        source_condition_index=None,
        parameter_code=f"param_{event_id}",
        parameter_sort_order=None,
        old_value=None,
        new_value=None,
        source_project_id=300 + event_id,
        source_layer_key=f"SRC-{event_id}",
        schema_version=schema_version,
        deleted=deleted,
        detail={"raw": {"should": "not leak"}, "extra": event_id},
        capture={"raw": {"should": "not leak"}, "extra": event_id},
    )
    base.update(overrides)
    return HistoryEventRow(**base)


def _capture_snapshot() -> dict[str, Any]:
    snapshot = BackboneSnapshot(
        capture_batch_id="0123456789abcdef0123456789abcdef",
        captured_at=datetime(2026, 7, 16, 1, 0, 1, tzinfo=UTC),
        source=BackboneSnapshotSource(
            project_id=301,
            sheet_layer_id=401,
            layer_key="SRC-L1",
            step_seq="STEP-1",
            layer_id="LID-1",
        ),
        columns=(
            BackboneSnapshotColumn(
                parameter_code="beta",
                value_type=ValueType.TEXT,
                display_name="Beta",
                category_code=None,
                sort_order=1,
                active_at_capture=True,
            ),
            BackboneSnapshotColumn(
                parameter_code="alpha",
                value_type=ValueType.TEXT,
                display_name="Alpha",
                category_code=None,
                sort_order=0,
                active_at_capture=True,
            ),
        ),
        conditions=(
            BackboneSnapshotCondition(
                source_condition_id=7,
                label="C7",
                condition_index=2,
                is_por=False,
                cells=(
                    BackboneSnapshotCell(parameter_code="alpha", value="a7"),
                    BackboneSnapshotCell(parameter_code="beta", value="b7"),
                ),
            ),
            BackboneSnapshotCondition(
                source_condition_id=3,
                label="C3",
                condition_index=1,
                is_por=True,
                cells=(BackboneSnapshotCell(parameter_code="alpha", value="a3"),),
            ),
        ),
    )
    return serialize_backbone_snapshot(snapshot)


def _capture_detail() -> list[dict[str, Any]]:
    return [
        {
            "target_condition_id": 501,
            "source_condition_id": 3,
            "label": "C3",
            "condition_index": 1,
            "is_por": True,
            "cell_count": 1,
        },
        {
            "target_condition_id": 502,
            "source_condition_id": 7,
            "label": "C7",
            "condition_index": 2,
            "is_por": False,
            "cell_count": 2,
        },
    ]


def _baseline_snapshot(
    *,
    project_id: int,
    layer_key: str,
    source_condition_id: int,
    parameter_code: str,
    value: str,
) -> dict[str, Any]:
    snapshot = BackboneSnapshot(
        capture_batch_id="0123456789abcdef0123456789abcdef",
        captured_at=datetime(2026, 7, 16, 1, 0, 1, tzinfo=UTC),
        source=BackboneSnapshotSource(
            project_id=project_id,
            sheet_layer_id=401,
            layer_key=layer_key,
            step_seq="010",
            layer_id="ACT",
        ),
        columns=(
            BackboneSnapshotColumn(
                parameter_code=parameter_code,
                value_type=ValueType.TEXT,
                display_name=parameter_code,
                category_code=None,
                sort_order=0,
                active_at_capture=True,
            ),
        ),
        conditions=(
            BackboneSnapshotCondition(
                source_condition_id=source_condition_id,
                label="baseline",
                condition_index=1,
                is_por=True,
                cells=(BackboneSnapshotCell(parameter_code=parameter_code, value=value),),
            ),
        ),
    )
    return serialize_backbone_snapshot(snapshot)


async def _seed_small_history_fixture(session: AsyncSession) -> SmallHistoryFixture:
    project = Project(
        line_id="L1",
        process_id="PROC_HISTORY",
        part_id="PART_HISTORY",
        name="history-project",
        status=ProjectStatus.DRAFT,
        profile=make_project_profile(process_name="history-project"),
    )
    current_layer = SheetLayer(
        layer_key="L1::PROC_HISTORY::010::ACT",
        step_seq="010",
        layer_id="ACT",
        sort_order=1,
        backbone_snapshot=None,
    )
    deleted_layer = SheetLayer(
        layer_key="L1::PROC_HISTORY::020::DEP",
        step_seq="020",
        layer_id="DEP",
        sort_order=2,
        backbone_snapshot=None,
    )
    legacy_layer = SheetLayer(
        layer_key="L1::PROC_HISTORY::030::LEGACY",
        step_seq="030",
        layer_id="LEGACY",
        sort_order=3,
        backbone_snapshot={"schema_version": 1, "source_project_id": 101},
    )
    current_condition = LayerCondition(label="C1", condition_index=1, is_por=True)
    current_condition.source_condition_id = 777
    current_condition.cell_values.append(
        CellValue(parameter_code="param_000", value_text="current-live")
    )
    deleted_condition = LayerCondition(label="C2", condition_index=2, is_por=False)
    deleted_condition.cell_values.append(
        CellValue(parameter_code="param_001", value_text="deleted-live")
    )
    current_layer.conditions.append(current_condition)
    deleted_layer.conditions.append(deleted_condition)
    project.layers.extend([current_layer, deleted_layer, legacy_layer])
    session.add(project)
    await session.flush()

    current_layer.backbone_snapshot = _baseline_snapshot(
        project_id=project.id,
        layer_key=current_layer.layer_key,
        source_condition_id=777,
        parameter_code="param_000",
        value="baseline-live",
    )

    events: list[ChangeEvent] = [
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.PROJECT_CREATE,
            actor="dev-admin",
            batch_id=None,
            origin="manual",
            layer_key=current_layer.layer_key,
            source_project_id=None,
            source_layer_key=None,
            created_at=_dt(1),
        ),
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.CONDITION_ADD,
            actor="dev-admin",
            batch_id=None,
            origin="manual",
            layer_key=current_layer.layer_key,
            condition_id=current_condition.id,
            parameter_code="param_000",
            payload={
                "layer_key": current_layer.layer_key,
                "condition_id": current_condition.id,
                "snapshot": {
                    "label": current_condition.label,
                    "is_por": current_condition.is_por,
                    "condition_index": current_condition.condition_index,
                    "cells": {"param_000": "initial-live"},
                },
            },
            created_at=_dt(2),
        ),
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.CONDITION_ADD,
            actor="dev-admin",
            batch_id=None,
            origin="manual",
            layer_key=deleted_layer.layer_key,
            condition_id=deleted_condition.id,
            parameter_code="param_001",
            payload={
                "layer_key": deleted_layer.layer_key,
                "condition_id": deleted_condition.id,
            },
            created_at=_dt(3),
        ),
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.CELL_UPDATE,
            actor="dev-admin",
            batch_id="batch-detail-100",
            origin="manual",
            layer_key=current_layer.layer_key,
            condition_id=current_condition.id,
            parameter_code="param_000",
            old_value="100",
            new_value="101",
            created_at=_dt(4),
        ),
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.CELL_UPDATE,
            actor="dev-admin",
            batch_id="batch-detail-100",
            origin="manual",
            layer_key=current_layer.layer_key,
            condition_id=current_condition.id,
            parameter_code="param_000",
            old_value="101",
            new_value="102",
            created_at=_dt(5),
        ),
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.CELL_UPDATE,
            actor="audit-bot",
            batch_id="batch-detail-100",
            origin="manual",
            layer_key=current_layer.layer_key,
            condition_id=current_condition.id,
            parameter_code="param_000",
            old_value="102",
            new_value="103",
            created_at=_dt(6),
        ),
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.BACKBONE_COPY,
            actor="dev-admin",
            batch_id="1",
            origin="backbone",
            layer_key=current_layer.layer_key,
            condition_id=current_condition.id,
            parameter_code="param_000",
            old_value="900",
            new_value="901",
            source_project_id=project.id,
            source_layer_key=current_layer.layer_key,
            created_at=_dt(7),
        ),
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.BACKBONE_COPY,
            actor="audit-bot",
            batch_id="1",
            origin="backbone",
            layer_key=current_layer.layer_key,
            condition_id=current_condition.id,
            parameter_code="param_000",
            old_value="901",
            new_value="902",
            source_project_id=project.id,
            source_layer_key=current_layer.layer_key,
            created_at=_dt(8),
        ),
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.CELL_UPDATE,
            actor="dev-admin",
            batch_id="batch-deleted-history",
            origin="manual",
            layer_key=deleted_layer.layer_key,
            condition_id=deleted_condition.id,
            parameter_code="param_001",
            old_value="200",
            new_value="201",
            created_at=_dt(9),
        ),
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.CELL_UPDATE,
            actor="dev-admin",
            batch_id="batch-deleted-history",
            origin="paste",
            layer_key=deleted_layer.layer_key,
            condition_id=deleted_condition.id,
            parameter_code="param_001",
            old_value="201",
            new_value="202",
            created_at=_dt(10),
        ),
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.CONDITION_REMOVE,
            actor="dev-admin",
            batch_id=None,
            origin="manual",
            layer_key=deleted_layer.layer_key,
            condition_id=deleted_condition.id,
            parameter_code="param_001",
            payload={
                "layer_key": deleted_layer.layer_key,
                "condition_id": deleted_condition.id,
                "snapshot": {
                    "label": deleted_condition.label,
                    "is_por": deleted_condition.is_por,
                    "condition_index": deleted_condition.condition_index,
                    "cells": {"param_001": "deleted-live"},
                },
            },
            created_at=_dt(11),
        ),
    ]
    session.add_all(events)
    await session.flush()

    remove_id = events[-1].id
    current_ids = [event.id for event in events[1:8]]
    deleted_ids = [event.id for event in events[8:10]]
    await session.delete(deleted_condition)
    await session.flush()
    await session.commit()

    return SmallHistoryFixture(
        project_id=project.id,
        current_condition_id=current_condition.id,
        current_parameter_code="param_000",
        deleted_condition_id=deleted_condition.id,
        deleted_parameter_code="param_001",
        current_layer_key=current_layer.layer_key,
        deleted_layer_key=deleted_layer.layer_key,
        batch_copy_id="1",
        batch_detail_id="batch-detail-100",
        batch_deleted_id="batch-deleted-history",
        remove_event_id=remove_id,
        current_event_ids=tuple(current_ids),
        batch_detail_event_ids=tuple(event.id for event in events[3:6]),
        deleted_event_ids=tuple(deleted_ids),
        snapshot_max_event_id=events[-1].id,
    )


async def _seed_large_history_fixture(session: AsyncSession) -> LargeHistoryFixture:
    project = Project(
        line_id="L1",
        process_id="PROC_HISTORY_LARGE",
        part_id="PART_HISTORY_LARGE",
        name="history-project-large",
        status=ProjectStatus.DRAFT,
        profile=make_project_profile(process_name="history-project-large"),
    )
    layer_a = SheetLayer(
        layer_key="L1::PROC_HISTORY_LARGE::010::ACT",
        step_seq="010",
        layer_id="ACT",
        sort_order=1,
        backbone_snapshot={"schema_version": 2, "source_project_id": 202},
    )
    layer_b = SheetLayer(
        layer_key="L1::PROC_HISTORY_LARGE::020::DEP",
        step_seq="020",
        layer_id="DEP",
        sort_order=2,
        backbone_snapshot={"schema_version": 2, "source_project_id": 202},
    )
    condition_a = LayerCondition(label="A1", condition_index=1, is_por=True)
    condition_a.cell_values.append(CellValue(parameter_code="param_000", value_text="1"))
    noise_condition = LayerCondition(label="N1", condition_index=2, is_por=False)
    noise_condition.cell_values.append(CellValue(parameter_code="param_001", value_text="2"))
    condition_b = LayerCondition(label="B1", condition_index=1, is_por=False)
    condition_b.cell_values.append(CellValue(parameter_code="param_002", value_text="3"))
    layer_a.conditions.extend([condition_a, noise_condition])
    layer_b.conditions.append(condition_b)
    project.layers.extend([layer_a, layer_b])
    session.add(project)
    await session.flush()

    batch_id = "batch-paste-120"
    batch_events: list[ChangeEvent] = []
    noise_events: list[ChangeEvent] = []
    events: list[ChangeEvent] = []
    created_at = datetime(2026, 7, 16, 2, 0, 0, tzinfo=UTC)
    offset_seconds = 0
    for index in range(120):
        batch_event = ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.CELL_UPDATE,
            actor="dev-admin",
            batch_id=batch_id,
            origin="paste",
            layer_key=layer_a.layer_key,
            condition_id=condition_a.id,
            parameter_code="param_000",
            old_value=str(900 + index),
            new_value=str(901 + index),
            source_project_id=project.id,
            source_layer_key=layer_a.layer_key,
            created_at=created_at + timedelta(seconds=offset_seconds),
        )
        batch_events.append(batch_event)
        events.append(batch_event)
        offset_seconds += 1
        if index % 10 == 0:
            noise_event = ChangeEvent(
                project_id=project.id,
                event_type=ChangeEventType.POR_CHANGE,
                actor="dev-admin",
                batch_id=None,
                origin="manual",
                layer_key=layer_a.layer_key,
                condition_id=noise_condition.id,
                parameter_code="param_001",
                old_value=str(index),
                new_value=str(index + 1),
                created_at=created_at + timedelta(seconds=offset_seconds),
            )
            noise_events.append(noise_event)
            events.append(noise_event)
            offset_seconds += 1
    session.add_all(events)
    await session.flush()
    await session.commit()

    return LargeHistoryFixture(
        project_id=project.id,
        layer_a_key=layer_a.layer_key,
        layer_b_key=layer_b.layer_key,
        condition_a_id=condition_a.id,
        condition_b_id=condition_b.id,
        snapshot_max_event_id=events[-1].id,
        batch_id=batch_id,
        batch_event_ids=tuple(event.id for event in batch_events),
        noise_event_ids=tuple(event.id for event in noise_events),
    )


async def _seed_deleted_proof_fixture(session: AsyncSession) -> DeletedProofFixture:
    project = Project(
        line_id="L1",
        process_id="PROC_HISTORY_DELETE",
        part_id="PART_HISTORY_DELETE",
        name="history-project-delete",
        status=ProjectStatus.DRAFT,
        profile=make_project_profile(process_name="history-project-delete"),
    )
    layer = SheetLayer(
        layer_key="L1::PROC_HISTORY_DELETE::010::ACT",
        step_seq="010",
        layer_id="ACT",
        sort_order=1,
        backbone_snapshot=None,
    )
    project.layers.append(layer)
    session.add(project)
    await session.flush()

    target_condition_id = 9001
    parameter_code = "param_900"
    target_event = ChangeEvent(
        project_id=project.id,
        event_type=ChangeEventType.CONDITION_REMOVE,
        actor="dev-admin",
        batch_id=None,
        origin="manual",
        layer_key=None,
        condition_id=None,
        parameter_code=None,
        payload={
            "layer_key": layer.layer_key,
            "condition_id": target_condition_id,
            "snapshot": {
                "label": "C9001",
                "is_por": False,
                "condition_index": 1,
                "cells": {parameter_code: "removed-live"},
            },
        },
        created_at=_dt(1),
    )
    session.add(target_event)
    await session.flush()
    await session.execute(
        update(ChangeEvent)
        .where(ChangeEvent.id == target_event.id)
        .values(condition_id=None, parameter_code=None, layer_key=None)
    )

    for index in range(200):
        session.add(
            ChangeEvent(
                project_id=project.id,
                event_type=ChangeEventType.CONDITION_REMOVE,
                actor="dev-admin",
                batch_id=None,
                origin="manual",
                layer_key=None,
                condition_id=None,
                parameter_code=None,
                payload={
                    "layer_key": layer.layer_key,
                    "condition_id": 10000 + index,
                    "snapshot": {
                        "label": f"C{10000 + index}",
                        "is_por": False,
                        "condition_index": index + 2,
                        "cells": {f"param_{index:03d}": f"value-{index}"},
                    },
                },
                created_at=_dt(2 + index),
            )
        )
    await session.flush()
    await session.commit()

    return DeletedProofFixture(
        project_id=project.id,
        condition_id=target_condition_id,
        parameter_code=parameter_code,
        layer_key=layer.layer_key,
        remove_event_id=target_event.id,
    )


async def _seed_capture_history_fixture(session: AsyncSession) -> CaptureHistoryFixture:
    project = Project(
        line_id="L1",
        process_id="PROC_HISTORY_CAPTURE",
        part_id="PART_HISTORY_CAPTURE",
        name="history-project-capture",
        status=ProjectStatus.DRAFT,
        profile=make_project_profile(process_name="history-project-capture"),
    )
    layer = SheetLayer(
        layer_key="L1::PROC_HISTORY_CAPTURE::010::ACT",
        step_seq="010",
        layer_id="ACT",
        sort_order=1,
        backbone_snapshot={"schema_version": 2, "source_project_id": 303},
    )
    condition = LayerCondition(label="C100", condition_index=1, is_por=True)
    condition.cell_values.append(CellValue(parameter_code="param_010", value_text="live"))
    layer.conditions.append(condition)
    project.layers.append(layer)
    session.add(project)
    await session.flush()

    valid_batch_id = "batch-v2-valid"
    legacy_batch_id = "batch-v1-legacy"
    bool_batch_id = "batch-v2-bool"
    wrong_batch_id = "batch-v2-wrong"
    corrupt_batch_id = "batch-v2-corrupt"

    valid_events = [
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.BACKBONE_LAYER_REPLACE,
            actor="dev-admin",
            batch_id=valid_batch_id,
            origin="backbone",
            layer_key=layer.layer_key,
            condition_id=condition.id,
            parameter_code="param_010",
            source_project_id=project.id,
            source_layer_key=layer.layer_key,
            payload={
                "batch_id": valid_batch_id,
                "captured_at": "2026-07-16T02:00:01+00:00",
                "payload_schema_version": 2,
                "capture": _capture_snapshot(),
                "detail": _capture_detail(),
            },
            created_at=_dt(1),
        ),
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.BACKBONE_LAYER_REPLACE,
            actor="dev-admin",
            batch_id=valid_batch_id,
            origin="backbone",
            layer_key=layer.layer_key,
            condition_id=condition.id,
            parameter_code="param_010",
            source_project_id=project.id,
            source_layer_key=layer.layer_key,
            payload={
                "batch_id": valid_batch_id,
                "captured_at": "2026-07-16T02:00:01+00:00",
                "payload_schema_version": 2,
                "capture": _capture_snapshot(),
                "detail": _capture_detail(),
            },
            created_at=_dt(2),
        ),
    ]
    legacy_event = ChangeEvent(
        project_id=project.id,
        event_type=ChangeEventType.BACKBONE_LAYER_REPLACE,
        actor="dev-admin",
        batch_id=legacy_batch_id,
        origin="backbone",
        layer_key=layer.layer_key,
        condition_id=condition.id,
        parameter_code="param_010",
        source_project_id=project.id,
        source_layer_key=layer.layer_key,
        payload={
            "batch_id": legacy_batch_id,
            "captured_at": "2026-07-16T02:00:02+00:00",
            "capture": _capture_snapshot(),
            "detail": _capture_detail(),
        },
        created_at=_dt(3),
    )
    bool_event = ChangeEvent(
        project_id=project.id,
        event_type=ChangeEventType.BACKBONE_LAYER_REPLACE,
        actor="dev-admin",
        batch_id=bool_batch_id,
        origin="backbone",
        layer_key=layer.layer_key,
        condition_id=condition.id,
        parameter_code="param_010",
        source_project_id=project.id,
        source_layer_key=layer.layer_key,
        payload={
            "batch_id": bool_batch_id,
            "captured_at": "2026-07-16T02:00:03+00:00",
            "payload_schema_version": True,
            "capture": _capture_snapshot(),
            "detail": _capture_detail(),
        },
        created_at=_dt(4),
    )
    wrong_event = ChangeEvent(
        project_id=project.id,
        event_type=ChangeEventType.BACKBONE_LAYER_REPLACE,
        actor="dev-admin",
        batch_id=wrong_batch_id,
        origin="backbone",
        layer_key=layer.layer_key,
        condition_id=condition.id,
        parameter_code="param_010",
        source_project_id=project.id,
        source_layer_key=layer.layer_key,
        payload={
            "batch_id": wrong_batch_id,
            "captured_at": "2026-07-16T02:00:04+00:00",
            "payload_schema_version": 3,
            "capture": _capture_snapshot(),
            "detail": _capture_detail(),
        },
        created_at=_dt(5),
    )
    corrupt_event = ChangeEvent(
        project_id=project.id,
        event_type=ChangeEventType.BACKBONE_LAYER_REPLACE,
        actor="dev-admin",
        batch_id=corrupt_batch_id,
        origin="backbone",
        layer_key=layer.layer_key,
        condition_id=condition.id,
        parameter_code="param_010",
        source_project_id=project.id,
        source_layer_key=layer.layer_key,
        payload={
            "batch_id": corrupt_batch_id,
            "captured_at": "2026-07-16T02:00:05+00:00",
            "payload_schema_version": 2,
            "capture": [],
            "detail": {},
        },
        created_at=_dt(6),
    )
    events = [*valid_events, legacy_event, bool_event, wrong_event, corrupt_event]
    session.add_all(events)
    await session.flush()
    await session.commit()

    return CaptureHistoryFixture(
        project_id=project.id,
        layer_key=layer.layer_key,
        condition_id=condition.id,
        parameter_code="param_010",
        valid_batch_id=valid_batch_id,
        legacy_batch_id=legacy_batch_id,
        bool_batch_id=bool_batch_id,
        wrong_batch_id=wrong_batch_id,
        corrupt_batch_id=corrupt_batch_id,
        valid_event_ids=tuple(event.id for event in valid_events),
        legacy_event_id=legacy_event.id,
        snapshot_max_event_id=events[-1].id,
    )


def test_history_repository_contract_exposes_group_and_context_interfaces() -> None:
    field_names = set(HistoryTimelineGroupRow.__dataclass_fields__)
    assert {
        "min_event_id",
        "started_at",
        "occurred_at",
        "event_types",
        "actors",
        "origins",
        "layer_keys",
    } <= field_names
    assert "before_event_id" in inspect.signature(
        HistoryRepository.load_batch_members
    ).parameters
    assert hasattr(HistoryRepository, "load_cell_history_context")
    assert hasattr(history_repository_module, "HistoryCellStateRow")
    assert hasattr(history_repository_module, "HistoryCellHistoryContext")


async def test_sqlite_repository_groups_batches_without_payload_and_counts_members(
    sqlite_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with sqlite_factory() as session:
        fixture = await _seed_small_history_fixture(session)
        repo = HistoryRepository(session)

        assert await repo.project_exists(fixture.project_id) is True
        assert await repo.project_exists(999999) is False

        snapshot = await repo.snapshot_max_event_id(fixture.project_id)
        assert snapshot == fixture.snapshot_max_event_id

        filtered = HistoryMemberFilterScope(actors=("dev-admin",))
        groups = await repo.list_timeline_groups(
            fixture.project_id,
            member_filters=filtered,
            snapshot_max_event_id=snapshot,
            limit=10,
        )

        assert all(group.group_key.startswith(("batch:", "event:")) for group in groups)
        assert [group.group_key for group in groups[:4]] == [
            f"event:{fixture.remove_event_id}",
            f"batch:{fixture.batch_deleted_id}",
            f"batch:{fixture.batch_copy_id}",
            f"batch:{fixture.batch_detail_id}",
        ]
        assert {group.group_key for group in groups} >= {
            f"batch:{fixture.batch_copy_id}",
            f"event:{fixture.remove_event_id}",
        }
        detail_group = next(
            group for group in groups if group.group_key == f"batch:{fixture.batch_detail_id}"
        )
        detail_group_any: Any = detail_group
        assert detail_group.group_kind == "batch"
        assert detail_group.matched_event_count == 2
        assert detail_group.total_event_count == 3
        assert detail_group_any.min_event_id == 4
        assert detail_group.max_event_id == 5
        assert detail_group_any.started_at == _dt(4)
        assert detail_group_any.occurred_at == _dt(5)
        assert set(detail_group_any.event_types) == {"cell_update"}
        assert set(detail_group_any.actors) == {"dev-admin"}
        assert set(detail_group_any.origins) == {"manual"}
        assert set(detail_group_any.layer_keys) == {fixture.current_layer_key}
        assert detail_group.representative.event_id == 5
        assert detail_group.representative.batch_id == fixture.batch_detail_id

        repo_any: Any = repo
        batch_members = await repo_any.load_batch_members(
            fixture.project_id,
            fixture.batch_detail_id,
            member_filters=filtered,
            snapshot_max_event_id=snapshot,
            before_event_id=7,
            limit=3,
        )
        assert [row.event_id for row in batch_members] == [5, 4]
        assert all(row.batch_id == fixture.batch_detail_id for row in batch_members)

        batch_total = await repo.count_batch_members(
            fixture.project_id, fixture.batch_detail_id, snapshot_max_event_id=snapshot
        )
        assert batch_total == 3

        coverage = await repo.coverage_counts(fixture.project_id, snapshot_max_event_id=snapshot)
        assert coverage.legacy_unresolved_layer_count > 0
        assert coverage.legacy_detail_unavailable_count > 0


async def test_sqlite_repository_load_batch_members_preserves_payload_and_rejects_invalid_versions(
    sqlite_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with sqlite_factory() as session:
        fixture = await _seed_capture_history_fixture(session)
        repo = HistoryRepository(session)
        repo_any: Any = repo

        valid_rows = await repo_any.load_batch_members(
            fixture.project_id,
            fixture.valid_batch_id,
            snapshot_max_event_id=fixture.snapshot_max_event_id,
            before_event_id=fixture.valid_event_ids[-1] + 1,
            limit=2,
        )
        assert valid_rows == (
            _row(
                fixture.valid_event_ids[1],
                "backbone_layer_replace",
                actor="dev-admin",
                created_at=_dt(2),
                batch_id=fixture.valid_batch_id,
                origin="backbone",
                layer_key=fixture.layer_key,
                condition_id=fixture.condition_id,
                parameter_code=fixture.parameter_code,
                source_project_id=fixture.project_id,
                source_layer_key=fixture.layer_key,
                schema_version=2,
                capture=_capture_snapshot(),
                detail=_capture_detail(),
            ),
            _row(
                fixture.valid_event_ids[0],
                "backbone_layer_replace",
                actor="dev-admin",
                created_at=_dt(1),
                batch_id=fixture.valid_batch_id,
                origin="backbone",
                layer_key=fixture.layer_key,
                condition_id=fixture.condition_id,
                parameter_code=fixture.parameter_code,
                source_project_id=fixture.project_id,
                source_layer_key=fixture.layer_key,
                schema_version=2,
                capture=_capture_snapshot(),
                detail=_capture_detail(),
            ),
        )

        legacy_rows = await repo_any.load_batch_members(
            fixture.project_id,
            fixture.legacy_batch_id,
            snapshot_max_event_id=fixture.snapshot_max_event_id,
            before_event_id=fixture.legacy_event_id + 1,
            limit=1,
        )
        assert legacy_rows == (
            _row(
                fixture.legacy_event_id,
                "backbone_layer_replace",
                actor="dev-admin",
                created_at=_dt(3),
                batch_id=fixture.legacy_batch_id,
                origin="backbone",
                layer_key=fixture.layer_key,
                condition_id=fixture.condition_id,
                parameter_code=fixture.parameter_code,
                source_project_id=fixture.project_id,
                source_layer_key=fixture.layer_key,
                schema_version=1,
                capture={},
                detail={},
            ),
        )

        for batch_id in (fixture.bool_batch_id, fixture.wrong_batch_id, fixture.corrupt_batch_id):
            with pytest.raises(ConflictError) as excinfo:
                await repo_any.load_batch_members(
                    fixture.project_id,
                    batch_id,
                    snapshot_max_event_id=fixture.snapshot_max_event_id,
                    limit=1,
                )
            assert excinfo.value.code == "invalid_event_batch"


async def test_sqlite_repository_cell_history_context_contract(
    sqlite_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with sqlite_factory() as session:
        fixture = await _seed_small_history_fixture(session)
        await session.execute(
            delete(CellValue).where(
                CellValue.condition_id == fixture.current_condition_id
            )
        )
        await session.execute(
            update(ChangeEvent)
            .where(ChangeEvent.id == fixture.remove_event_id)
            .values(condition_id=None, parameter_code=None, layer_key=None)
        )
        await session.commit()
        repo = HistoryRepository(session)
        repo_any: Any = repo

        current_proof = await repo.prove_cell_coordinate(
            fixture.project_id, fixture.current_condition_id, fixture.current_parameter_code
        )
        assert current_proof is not None
        assert current_proof.state == "current"
        assert current_proof.layer_key == fixture.current_layer_key
        assert current_proof.latest_event_id == 6

        current_context = await repo_any.load_cell_history_context(
            fixture.project_id,
            fixture.current_condition_id,
            fixture.current_parameter_code,
        )
        assert current_context.baseline_entry is not None
        assert current_context.initial_entry is not None
        assert current_context.initial_state_unavailable is False
        assert current_context.remove_event is None
        assert not hasattr(current_context.baseline_entry, "event_id")
        assert not hasattr(current_context.initial_entry, "event_id")

        deleted_proof = await repo.prove_cell_coordinate(
            fixture.project_id, fixture.deleted_condition_id, fixture.deleted_parameter_code
        )
        assert deleted_proof is not None
        assert deleted_proof.deleted is True
        assert deleted_proof.layer_key == fixture.deleted_layer_key
        assert deleted_proof.remove_event_id == fixture.remove_event_id

        deleted_context = await repo_any.load_cell_history_context(
            fixture.project_id,
            fixture.deleted_condition_id,
            fixture.deleted_parameter_code,
        )
        assert deleted_context.baseline_entry is None
        assert deleted_context.initial_entry is None
        assert deleted_context.initial_state_unavailable is True
        assert deleted_context.remove_event is not None
        assert deleted_context.remove_event.event_id == fixture.remove_event_id
        assert deleted_context.remove_event.layer_key == fixture.deleted_layer_key

        current_rows = await repo.load_cell_history_rows(
            fixture.project_id, fixture.current_condition_id, fixture.current_parameter_code
        )
        assert [row.event_id for row in current_rows] == list(
            sorted(fixture.batch_detail_event_ids, reverse=True)
        )
        assert all(row.condition_id == fixture.current_condition_id for row in current_rows)
        assert all(row.parameter_code == fixture.current_parameter_code for row in current_rows)

        deleted_rows = await repo.load_cell_history_rows(
            fixture.project_id, fixture.deleted_condition_id, fixture.deleted_parameter_code
        )
        assert [row.event_id for row in deleted_rows] == list(
            sorted(fixture.deleted_event_ids, reverse=True)
        )


async def test_sqlite_repository_deleted_proof_uses_payload_snapshot_beyond_latest_window(
    sqlite_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with sqlite_factory() as session:
        fixture = await _seed_deleted_proof_fixture(session)
        repo = HistoryRepository(session)

        proof = await repo.prove_cell_coordinate(
            fixture.project_id,
            fixture.condition_id,
            fixture.parameter_code,
        )

        assert proof is not None
        assert proof.deleted is True
        assert proof.layer_key == fixture.layer_key
        assert proof.remove_event_id == fixture.remove_event_id


@pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")
async def test_postgres_repository_frozen_traversal_ignores_late_events_and_excludes_payload(
    pg_engine: AsyncEngine,
    pg_factory: async_sessionmaker[AsyncSession],
) -> None:
    async def capture_round_trip(
        call: Callable[[], Awaitable[tuple[HistoryTimelineGroupRow, ...]]],
    ) -> tuple[tuple[HistoryTimelineGroupRow, ...], list[str]]:
        statements: list[str] = []

        def capture_sql(
            _conn: object,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: object,
            _executemany: bool,
        ) -> None:
            statements.append(statement)

        event.listen(pg_engine.sync_engine, "before_cursor_execute", capture_sql)
        try:
            result = await call()
        finally:
            event.remove(pg_engine.sync_engine, "before_cursor_execute", capture_sql)
        return result, statements

    async with pg_factory() as session:
        fixture = await _seed_large_history_fixture(session)
        repo = HistoryRepository(session)
        filter_scope = HistoryMemberFilterScope(
            actors=("dev-admin",),
            layer_keys=(fixture.layer_a_key,),
        )
        snapshot = await repo.snapshot_max_event_id(
            fixture.project_id, member_filters=filter_scope
        )
        assert snapshot is not None

        first_page, first_page_statements = await capture_round_trip(
            lambda: repo.list_timeline_groups(
                fixture.project_id,
                member_filters=filter_scope,
                snapshot_max_event_id=snapshot,
                limit=5,
            )
        )

        assert first_page
        assert all(row.group_key.startswith(("batch:", "event:")) for row in first_page)
        assert all("payload" not in statement.lower() for statement in first_page_statements)
        assert all("capture" not in statement.lower() for statement in first_page_statements)
        batch_group = next(
            row for row in first_page if row.group_key == f"batch:{fixture.batch_id}"
        )
        batch_group_any: Any = batch_group
        assert batch_group.group_kind == "batch"
        assert batch_group.matched_event_count == 120
        assert batch_group.total_event_count == 120
        assert batch_group_any.min_event_id == min(fixture.batch_event_ids)
        assert batch_group.max_event_id == max(fixture.batch_event_ids)
        assert batch_group.representative.event_id == max(fixture.batch_event_ids)
        assert set(batch_group_any.event_types) == {"cell_update"}
        assert set(batch_group_any.actors) == {"dev-admin"}
        assert set(batch_group_any.origins) == {"paste"}
        assert set(batch_group_any.layer_keys) == {fixture.layer_a_key}

        last_seen = first_page[-1].max_event_id
        late_event = ChangeEvent(
            project_id=fixture.project_id,
            event_type=ChangeEventType.CELL_UPDATE,
            actor="dev-admin",
            batch_id="batch-999",
            origin="manual",
            layer_key=fixture.layer_a_key,
            condition_id=fixture.condition_a_id,
            parameter_code="param_000",
            old_value="late-old",
            new_value="late-new",
            created_at=datetime(2026, 7, 16, 4, 0, 0, tzinfo=UTC),
        )
        session.add(late_event)
        await session.flush()
        await session.commit()

        frozen_first_page, frozen_first_page_statements = await capture_round_trip(
            lambda: repo.list_timeline_groups(
                fixture.project_id,
                member_filters=filter_scope,
                snapshot_max_event_id=snapshot,
                limit=5,
            )
        )
        assert [row.group_key for row in frozen_first_page] == [row.group_key for row in first_page]
        assert [row.max_event_id for row in frozen_first_page] == [
            row.max_event_id for row in first_page
        ]
        assert all("payload" not in statement.lower() for statement in frozen_first_page_statements)
        assert all("capture" not in statement.lower() for statement in frozen_first_page_statements)

        next_page, next_page_statements = await capture_round_trip(
            lambda: repo.list_timeline_groups(
                fixture.project_id,
                member_filters=filter_scope,
                snapshot_max_event_id=snapshot,
                before_group_max_id=last_seen,
                limit=5,
            )
        )
        assert next_page
        assert all(row.max_event_id < last_seen for row in next_page)
        assert {row.group_key for row in next_page}.isdisjoint(
            {row.group_key for row in first_page}
        )
        assert all("payload" not in statement.lower() for statement in next_page_statements)
        assert all("capture" not in statement.lower() for statement in next_page_statements)

        first_page_total = sum(
            row.total_event_count for row in first_page if row.batch_id is not None
        )
        assert first_page_total == 120
