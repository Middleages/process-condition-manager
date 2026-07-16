"""PostgreSQL writer atomicity and rollback regressions.

This file exercises the real transaction boundary with a disposable PostgreSQL
database, focusing on the cell/condition/POR writer seams that the phase-4
contract depends on:
- exact structured provenance columns for cell and condition events
- full rollback when a late flush fails after rows/events have been staged
- project-row lock serialization for concurrent edits
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models  # noqa: F401 -- register models for metadata.create_all
from app.core.auth import UserContext, get_current_user
from app.core.db import Base, get_app_session
from app.features.cells.repository import CellRepository
from app.features.cells.schema import CellUpdateIn, CellsPatchIn
from app.features.cells.service import CellService
from app.features.conditions.repository import ConditionRepository
from app.features.conditions.schema import ConditionCreateIn
from app.features.conditions.service import ConditionService
from app.features.locks.repository import EditLockRepository
from app.features.locks.service import LockService
from app.main import app
from app.models.parameter import Parameter, ParameterCategory
from app.models.project import (
    CellValue,
    ChangeEvent,
    ChangeEventType,
    EditLock,
    LayerCondition,
    Project,
    ProjectProfile,
    ProjectStatus,
    SheetLayer,
)
from tests.factories import make_project_profile
from tests.postgres_database import temporary_postgres_database

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    _PG_URL is None,
    reason="APP_TEST_DATABASE_URL 미설정",
)


@pytest.fixture
async def pg_engine() -> AsyncIterator[AsyncEngine]:
    with temporary_postgres_database() as temp_db:
        engine = create_async_engine(temp_db.async_url)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        try:
            yield engine
        finally:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.drop_all)
            await engine.dispose()


@pytest.fixture
def pg_factory(pg_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)


async def _dev_user() -> UserContext:
    return UserContext(id="dev-admin")


@asynccontextmanager
async def _override_session(
    factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[None]:
    async def _get_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    app.dependency_overrides[get_app_session] = _get_session
    app.dependency_overrides[get_current_user] = _dev_user
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_app_session, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
async def pg_client(
    pg_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncClient]:
    async with _override_session(pg_factory):
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


def _cell_service(session: AsyncSession) -> CellService:
    return CellService(CellRepository(session))


def _condition_service(session: AsyncSession) -> ConditionService:
    return ConditionService(ConditionRepository(session))


def _lock_service(session: AsyncSession) -> LockService:
    return LockService(EditLockRepository(session))


async def _seed_required_parameter(session: AsyncSession, *, code: str) -> None:
    category = ParameterCategory(code=f"cat_{code}", display_name=code)
    session.add(
        Parameter(
            code=code,
            display_name=code,
            value_type="text",
            category=category,
        )
    )
    await session.flush()


async def _seed_project_graph(
    session: AsyncSession,
) -> tuple[int, str, int, int, int]:
    """Seed one project with three conditions and simple sparse cell values."""
    project = Project(
        line_id="L1",
        process_id="PROC_PG",
        part_id="PART_PG",
        name="pg-writer",
        status=ProjectStatus.DRAFT,
        profile=ProjectProfile(
            process_name="PROC_PG",
            device_type_code="DEFAULT",
            project_category_code="DEFAULT",
        ),
    )
    layer = SheetLayer(
        layer_key="L1::PROC_PG::010::ACT",
        step_seq="010",
        layer_id="ACT",
        sort_order=1,
    )
    source = LayerCondition(label="C1", condition_index=1, is_por=True)
    source.cell_values.extend(
        [
            CellValue(parameter_code="spin_speed", value_text="1000"),
            CellValue(parameter_code="memo", value_text="seed"),
        ]
    )
    removable = LayerCondition(label="C2", condition_index=2, is_por=False)
    por_target = LayerCondition(label="C3", condition_index=3, is_por=False)
    layer.conditions.extend([source, removable, por_target])
    project.layers.append(layer)
    session.add(project)
    await session.commit()
    return project.id, layer.layer_key, source.id, removable.id, por_target.id


async def _seed_lock(
    session: AsyncSession,
    *,
    project_id: int,
    user_id: str = "dev-admin",
) -> str:
    lock = await _lock_service(session).acquire(project_id, user_id=user_id)
    await session.commit()
    return lock.lock_token


async def _cell_events(session: AsyncSession, project_id: int) -> list[ChangeEvent]:
    session.expire_all()
    rows = await session.execute(
        select(ChangeEvent)
        .where(
            ChangeEvent.project_id == project_id,
            ChangeEvent.event_type == ChangeEventType.CELL_UPDATE,
        )
        .order_by(ChangeEvent.id)
    )
    return list(rows.scalars().all())


async def _condition_events(
    session: AsyncSession, project_id: int, event_type: ChangeEventType
) -> list[ChangeEvent]:
    session.expire_all()
    rows = await session.execute(
        select(ChangeEvent)
        .where(
            ChangeEvent.project_id == project_id,
            ChangeEvent.event_type == event_type,
        )
        .order_by(ChangeEvent.id)
    )
    return list(rows.scalars().all())


async def _condition_cells(
    session: AsyncSession, condition_id: int
) -> dict[str, str | None]:
    session.expire_all()
    rows = await session.execute(
        select(CellValue.parameter_code, CellValue.value_text).where(
            CellValue.condition_id == condition_id
        )
    )
    return {code: value for code, value in rows.all()}


async def _condition_row(session: AsyncSession, condition_id: int) -> LayerCondition | None:
    session.expire_all()
    row = (
        await session.execute(
            select(LayerCondition).where(LayerCondition.id == condition_id)
        )
    ).scalar_one_or_none()
    return row


@pytest.mark.parametrize("origin", ["manual", "paste"])
async def test_cell_batches_record_exact_provenance_and_shared_batch(
    pg_factory: async_sessionmaker[AsyncSession], origin: str
) -> None:
    async with pg_factory() as setup_session:
        project_id, _, source_id, removable_id, _ = await _seed_project_graph(setup_session)

    async with pg_factory() as session:
        response = await _cell_service(session).patch_cells(
            project_id,
            CellsPatchIn(
                origin=origin,
                cells=[
                    CellUpdateIn(condition_id=source_id, parameter_code="spin_speed", value="1200"),
                    CellUpdateIn(condition_id=removable_id, parameter_code="memo", value="batch"),
                ],
            ),
            actor="writer-user",
        )
        await session.commit()

    async with pg_factory() as verify_session:
        events = await _cell_events(verify_session, project_id)

    assert len(events) == 2
    assert response.batch_id and len(response.batch_id) == 32
    assert {event.batch_id for event in events} == {response.batch_id}
    assert {event.origin for event in events} == {origin}
    assert {event.layer_key for event in events} == {"L1::PROC_PG::010::ACT"}
    assert {event.source_project_id for event in events} == {None}
    assert {event.source_layer_key for event in events} == {None}
    assert {(event.condition_id, event.parameter_code) for event in events} == {
        (source_id, "spin_speed"),
        (removable_id, "memo"),
    }


async def test_condition_writers_record_exact_envelope_and_snapshots(
    pg_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with pg_factory() as setup_session:
        project_id, layer_key, source_id, removable_id, por_target_id = await _seed_project_graph(
            setup_session
        )

    async with pg_factory() as session:
        service = _condition_service(session)

        added = await service.add_condition(
            project_id,
            layer_key,
            ConditionCreateIn(source_condition_id=source_id),
            actor="writer-user",
        )
        await service.delete_condition(project_id, removable_id, actor="writer-user")
        por = await service.set_por(project_id, por_target_id, actor="writer-user")
        await session.commit()

    async with pg_factory() as verify_session:
        add_event = (await _condition_events(verify_session, project_id, ChangeEventType.CONDITION_ADD))[-1]
        remove_event = (
            await _condition_events(verify_session, project_id, ChangeEventType.CONDITION_REMOVE)
        )[-1]
        por_event = (await _condition_events(verify_session, project_id, ChangeEventType.POR_CHANGE))[-1]

    assert added.layer_key == layer_key
    assert por.layer_key == layer_key

    assert add_event.condition_id == added.id
    assert add_event.layer_key == layer_key
    assert add_event.origin == "manual"
    assert add_event.source_project_id is None
    assert add_event.source_layer_key is None
    assert add_event.payload == {
        "layer_key": layer_key,
        "condition_id": added.id,
        "source_condition_id": source_id,
        "snapshot": {
            "label": "C4",
            "is_por": False,
            "condition_index": 4,
            "cells": {"memo": "seed", "spin_speed": "1000"},
        },
    }

    assert remove_event.condition_id == removable_id
    assert remove_event.layer_key == layer_key
    assert remove_event.origin == "manual"
    assert remove_event.source_project_id is None
    assert remove_event.source_layer_key is None
    assert remove_event.payload["snapshot"] == {
        "label": "C2",
        "is_por": False,
        "condition_index": 2,
        "cells": {},
    }

    assert por_event.condition_id == por_target_id
    assert por_event.layer_key == layer_key
    assert por_event.origin == "manual"
    assert por_event.source_project_id is None
    assert por_event.source_layer_key is None
    assert por_event.payload == {
        "layer_key": layer_key,
        "old_por_condition_id": source_id,
        "new_por_condition_id": por_target_id,
    }


@pytest.mark.parametrize("kind", ["cells", "conditions"])
async def test_writer_flush_failure_rolls_back_all_mutations(
    pg_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    async with pg_factory() as setup_session:
        project_id, layer_key, source_id, removable_id, por_target_id = await _seed_project_graph(
            setup_session
        )

    if kind == "cells":
        original_flush = CellRepository.flush

        async def failing_flush(self: CellRepository) -> None:
            await original_flush(self)
            raise RuntimeError("boom after cell flush")

        monkeypatch.setattr(CellRepository, "flush", failing_flush)
        async with pg_factory() as session:
            with pytest.raises(RuntimeError, match="boom after cell flush"):
                await _cell_service(session).patch_cells(
                    project_id,
                    CellsPatchIn(
                        origin="paste",
                        cells=[
                            CellUpdateIn(
                                condition_id=source_id,
                                parameter_code="spin_speed",
                                value="1200",
                            ),
                            CellUpdateIn(
                                condition_id=removable_id,
                                parameter_code="memo",
                                value="batch",
                            ),
                        ],
                    ),
                    actor="writer-user",
                )
            await session.rollback()
    else:
        original_flush = ConditionRepository.flush
        call_count = 0

        async def failing_flush(self: ConditionRepository) -> None:
            nonlocal call_count
            call_count += 1
            await original_flush(self)
            if call_count == 2:
                raise RuntimeError("boom after condition flush")

        monkeypatch.setattr(ConditionRepository, "flush", failing_flush)
        async with pg_factory() as session:
            service = _condition_service(session)
            with pytest.raises(RuntimeError, match="boom after condition flush"):
                await service.add_condition(
                    project_id,
                    layer_key,
                    ConditionCreateIn(source_condition_id=source_id),
                    actor="writer-user",
                )
            await session.rollback()

    async with pg_factory() as verify_session:
        project = (
            await verify_session.execute(
                select(Project).where(Project.id == project_id)
            )
        ).scalar_one()
        source = await _condition_row(verify_session, source_id)
        removable = await _condition_row(verify_session, removable_id)
        por_target = await _condition_row(verify_session, por_target_id)
        cell_events = await _cell_events(verify_session, project_id)
        add_events = await _condition_events(verify_session, project_id, ChangeEventType.CONDITION_ADD)
        remove_events = await _condition_events(
            verify_session, project_id, ChangeEventType.CONDITION_REMOVE
        )
        por_events = await _condition_events(verify_session, project_id, ChangeEventType.POR_CHANGE)

    assert project.id == project_id
    assert source is not None and source.source_condition_id is None
    assert await _condition_cells(verify_session, source_id) == {
        "memo": "seed",
        "spin_speed": "1000",
    }
    assert removable is not None and removable is not None
    assert por_target is not None and por_target.is_por is False
    assert cell_events == []
    assert add_events == []
    assert remove_events == []
    assert por_events == []


async def test_concurrent_edits_are_serialized_by_project_lock(
    pg_factory: async_sessionmaker[AsyncSession], pg_client: AsyncClient
) -> None:
    async with pg_factory() as setup_session:
        project_id, layer_key, source_id, removable_id, _ = await _seed_project_graph(setup_session)
        lock_token = await _seed_lock(setup_session, project_id=project_id)

    original_flush = CellRepository.flush
    first_flush_started = asyncio.Event()
    release_first_flush = asyncio.Event()
    flush_calls = 0

    async def paused_flush(self: CellRepository) -> None:
        nonlocal flush_calls
        flush_calls += 1
        if flush_calls == 1:
            first_flush_started.set()
            await asyncio.wait_for(release_first_flush.wait(), timeout=5)
        return await original_flush(self)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(CellRepository, "flush", paused_flush)

        async def update_source_cell() -> int:
            response = await pg_client.patch(
                f"/api/projects/{project_id}/cells",
                headers={"X-Lock-Token": lock_token},
                json={
                    "origin": "paste",
                    "cells": [
                        {
                            "condition_id": source_id,
                            "parameter_code": "spin_speed",
                            "value": "1200",
                        }
                    ],
                },
            )
            assert response.status_code == 200, response.text
            return response.status_code

        async def duplicate_after_update() -> int:
            response = await pg_client.post(
                f"/api/projects/{project_id}/layers/{layer_key}/conditions",
                headers={"X-Lock-Token": lock_token},
                json={"source_condition_id": source_id},
            )
            assert response.status_code == 201, response.text
            return response.json()["id"]

        patch_task = asyncio.create_task(update_source_cell())
        await asyncio.wait_for(first_flush_started.wait(), timeout=5)
        duplicate_task = asyncio.create_task(duplicate_after_update())
        await asyncio.sleep(0.1)
        assert not duplicate_task.done(), "second edit should wait for the project lock"
        release_first_flush.set()
        await patch_task
        duplicate_id = await duplicate_task

    async with pg_factory() as verify_session:
        duplicate_cells = await _condition_cells(verify_session, duplicate_id)
        source_cells = await _condition_cells(verify_session, source_id)
        add_events = await _condition_events(verify_session, project_id, ChangeEventType.CONDITION_ADD)

    assert source_cells["spin_speed"] == "1200"
    assert duplicate_cells["spin_speed"] == "1200"
    assert add_events[-1].payload["snapshot"]["cells"]["spin_speed"] == "1200"
