"""Repository seams for bounded Phase 4 history reads."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, event, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 -- register every model for metadata.create_all
from app.core.db import Base
from app.features.history.cursor import HistoryMemberFilterScope
from app.features.history.projection import (
    HistoryAvailability,
    HistoryEntryRole,
    project_cell_history,
)
from app.features.history.repository import HistoryRepository
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
    batch_ids: tuple[str, ...]


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
    return datetime(2026, 7, 16, 1, 0, second, tzinfo=UTC)


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
        backbone_snapshot={"schema_version": 2, "source_project_id": 101},
    )
    deleted_layer = SheetLayer(
        layer_key="L1::PROC_HISTORY::020::DEP",
        step_seq="020",
        layer_id="DEP",
        sort_order=2,
        backbone_snapshot={"schema_version": 2, "source_project_id": 101},
    )
    current_condition = LayerCondition(label="C1", condition_index=1, is_por=True)
    current_condition.cell_values.append(
        CellValue(parameter_code="param_000", value_text="current-live")
    )
    deleted_condition = LayerCondition(label="C2", condition_index=2, is_por=False)
    deleted_condition.cell_values.append(
        CellValue(parameter_code="param_001", value_text="deleted-live")
    )
    current_layer.conditions.append(current_condition)
    deleted_layer.conditions.append(deleted_condition)
    project.layers.extend([current_layer, deleted_layer])
    session.add(project)
    await session.flush()

    events = [
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
            event_type=ChangeEventType.BACKBONE_COPY,
            actor="dev-admin",
            batch_id="batch-copy-001",
            origin="backbone",
            layer_key=current_layer.layer_key,
            condition_id=current_condition.id,
            parameter_code="param_000",
            old_value="900",
            new_value="901",
            source_project_id=project.id,
            source_layer_key=current_layer.layer_key,
            created_at=_dt(2),
        ),
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.BACKBONE_COPY,
            actor="audit-bot",
            batch_id="batch-copy-001",
            origin="backbone",
            layer_key=current_layer.layer_key,
            condition_id=current_condition.id,
            parameter_code="param_000",
            old_value="901",
            new_value="902",
            source_project_id=project.id,
            source_layer_key=current_layer.layer_key,
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
            event_type=ChangeEventType.CELL_UPDATE,
            actor="dev-admin",
            batch_id="batch-deleted-history",
            origin="manual",
            layer_key=deleted_layer.layer_key,
            condition_id=deleted_condition.id,
            parameter_code="param_001",
            old_value="200",
            new_value="201",
            created_at=_dt(7),
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
            created_at=_dt(8),
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
            created_at=_dt(9),
        ),
    ]
    session.add_all(events)
    await session.flush()

    remove_id = events[-1].id
    current_ids = [event.id for event in events[:6]]
    deleted_ids = [event.id for event in events[6:8]]
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
        batch_copy_id="batch-copy-001",
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
    condition_b = LayerCondition(label="B1", condition_index=1, is_por=False)
    condition_b.cell_values.append(CellValue(parameter_code="param_001", value_text="2"))
    layer_a.conditions.append(condition_a)
    layer_b.conditions.append(condition_b)
    project.layers.extend([layer_a, layer_b])
    session.add(project)
    await session.flush()

    batch_ids = ["batch-001", "batch-002", "batch-003", "batch-004"]
    event_types = [
        ChangeEventType.PROJECT_CREATE,
        ChangeEventType.BACKBONE_COPY,
        ChangeEventType.BACKBONE_LAYER_REPLACE,
        ChangeEventType.CONDITION_ADD,
        ChangeEventType.CONDITION_REMOVE,
        ChangeEventType.POR_CHANGE,
    ]
    events: list[ChangeEvent] = []
    for index in range(120):
        is_batch = index % 6 != 0
        batch_id = batch_ids[index % len(batch_ids)] if is_batch else None
        event_type = ChangeEventType.CELL_UPDATE if is_batch else event_types[index % len(event_types)]
        actor = "dev-admin" if index % 2 == 0 else "qa-bot"
        layer = layer_a if index % 3 == 0 else layer_b
        condition = condition_a if index % 2 == 0 else condition_b
        parameter_code = "param_000" if index % 2 == 0 else "param_001"
        origin = "manual" if index % 3 else "paste"
        events.append(
            ChangeEvent(
                project_id=project.id,
                event_type=event_type,
                actor=actor,
                batch_id=batch_id,
                origin=origin,
                layer_key=layer.layer_key,
                condition_id=condition.id,
                parameter_code=parameter_code,
                old_value=str(900 + index),
                new_value=str(901 + index),
                source_project_id=project.id if batch_id is not None else None,
                source_layer_key=layer.layer_key if batch_id is not None else None,
                created_at=datetime(2026, 7, 16, 2, 0, 0, tzinfo=UTC) + timedelta(seconds=index),
            )
        )
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
        batch_ids=tuple(batch_ids),
    )


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

        assert [group.group_key for group in groups[:3]] == [
            str(fixture.remove_event_id),
            fixture.batch_deleted_id,
            fixture.batch_detail_id,
        ]
        detail_group = next(group for group in groups if group.group_key == fixture.batch_detail_id)
        assert detail_group.group_kind == "batch"
        assert detail_group.matched_event_count == 2
        assert detail_group.total_event_count == 3
        assert detail_group.representative.event_id == 5
        assert detail_group.representative.batch_id == fixture.batch_detail_id

        batch_members = await repo.load_batch_members(
            fixture.project_id,
            fixture.batch_detail_id,
            member_filters=filtered,
            snapshot_max_event_id=snapshot,
        )
        assert [row.event_id for row in batch_members] == sorted(
            (5, 4), reverse=True
        )
        assert all(row.batch_id == fixture.batch_detail_id for row in batch_members)

        batch_total = await repo.count_batch_members(
            fixture.project_id, fixture.batch_detail_id, snapshot_max_event_id=snapshot
        )
        assert batch_total == 3

        coverage = await repo.coverage_counts(fixture.project_id, snapshot_max_event_id=snapshot)
        assert coverage.legacy_unresolved_layer_count == 0
        assert coverage.legacy_detail_unavailable_count == 0


async def test_sqlite_repository_proves_current_and_deleted_coordinates_and_reads_cell_history(
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

        current_proof = await repo.prove_cell_coordinate(
            fixture.project_id, fixture.current_condition_id, fixture.current_parameter_code
        )
        assert current_proof is not None
        assert current_proof.state == "current"
        assert current_proof.layer_key == fixture.current_layer_key
        assert current_proof.latest_event_id == 6

        deleted_proof = await repo.prove_cell_coordinate(
            fixture.project_id, fixture.deleted_condition_id, fixture.deleted_parameter_code
        )
        assert deleted_proof is not None
        assert deleted_proof.deleted is True
        assert deleted_proof.layer_key == fixture.deleted_layer_key
        assert deleted_proof.remove_event_id == fixture.remove_event_id

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
        anchor_rows = await repo.load_cell_history_anchor_rows(
            fixture.project_id, fixture.deleted_condition_id, fixture.deleted_parameter_code
        )
        anchor_projection = project_cell_history(anchor_rows)
        assert anchor_projection.initial_entry is not None
        assert anchor_projection.initial_entry.role == HistoryEntryRole.INITIAL
        assert anchor_projection.initial_entry.event_id == fixture.remove_event_id
        assert anchor_projection.initial_state == HistoryAvailability.AVAILABLE
        projected = project_cell_history(
            [
                *deleted_rows,
                *current_rows,
            ]
        )
        assert projected.entries[0].role == HistoryEntryRole.CURRENT


@pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")
async def test_postgres_repository_frozen_traversal_ignores_late_events_and_excludes_payload(
    pg_engine: AsyncEngine,
    pg_factory: async_sessionmaker[AsyncSession],
) -> None:
    async def capture_round_trip(call):
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
        assert all("payload" not in statement.lower() for statement in first_page_statements)
        assert all("capture" not in statement.lower() for statement in first_page_statements)

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
        assert [row.max_event_id for row in frozen_first_page] == [row.max_event_id for row in first_page]
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
        assert {row.group_key for row in next_page}.isdisjoint({row.group_key for row in first_page})
        assert all("payload" not in statement.lower() for statement in next_page_statements)
        assert all("capture" not in statement.lower() for statement in next_page_statements)

        first_page_total = sum(row.total_event_count for row in first_page if row.batch_id is not None)
        assert first_page_total > 0
