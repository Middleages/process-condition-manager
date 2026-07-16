"""PostgreSQL source-capture lock races for ProjectRepository."""

import asyncio
import os
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models  # noqa: F401 -- register every model for metadata
from app.core.db import Base
from app.core.errors import ConflictError
from app.features.projects.repository import ProjectRepository
from app.models.project import (
    CellValue,
    ChangeEvent,
    LayerCondition,
    Project,
    ProjectStatus,
    SheetLayer,
)
from tests.factories import make_project_profile
from tests.postgres_database import temporary_postgres_database

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")


@pytest.fixture
async def pg_engine() -> AsyncIterator[AsyncEngine]:
    assert _PG_URL is not None
    with temporary_postgres_database() as database:
        engine = create_async_engine(database.async_url)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            yield engine
        finally:
            await engine.dispose()


async def _seed_project(
    session: AsyncSession,
    *,
    line_id: str,
    process_id: str,
    part_id: str,
    name: str,
    layer_key: str,
) -> Project:
    project = Project(
        line_id=line_id,
        process_id=process_id,
        part_id=part_id,
        name=name,
        status=ProjectStatus.DRAFT,
        profile=make_project_profile(process_name=process_id),
    )
    layer = SheetLayer(
        layer_key=layer_key,
        step_seq="010",
        layer_id="ACT",
        sort_order=1,
    )
    por_condition = LayerCondition(label="por", condition_index=1, is_por=True)
    por_condition.cell_values.append(
        CellValue(parameter_code="mode", value_text="AUTO")
    )
    support_condition = LayerCondition(
        label="support",
        condition_index=2,
        is_por=False,
    )
    support_condition.cell_values.append(
        CellValue(parameter_code="mode", value_text="MANUAL")
    )
    layer.conditions.extend([por_condition, support_condition])
    project.layers.append(layer)
    session.add(project)
    await session.flush()
    return project


def _new_factory(
    pg_engine: AsyncEngine,
) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)


async def test_source_capture_conflicts_with_inflight_source_mutation_and_recovers_after_release(
    pg_engine: AsyncEngine,
) -> None:
    factory = _new_factory(pg_engine)
    async with factory() as session:
        source = await _seed_project(
            session,
            line_id="L1",
            process_id="PROC_SRC",
            part_id="PART_SRC",
            name="source",
            layer_key="L1::PROC_SRC::010::ACT",
        )
        target = await _seed_project(
            session,
            line_id="L1",
            process_id="PROC_TGT",
            part_id="PART_TGT",
            name="target",
            layer_key="L1::PROC_TGT::010::ACT",
        )
        await session.commit()
        source_id = source.id
        target_id = target.id

    async with factory() as source_session, factory() as contender_session:
        source_repo = ProjectRepository(source_session)
        contender_repo = ProjectRepository(contender_session)

        locked_source = await source_repo.get_for_update(source_id)
        assert locked_source is not None

        locked_layer = locked_source.layers[0]
        locked_layer.conditions[0].label = "por-mutated"
        locked_layer.conditions[0].cell_values[0].value_text = "LOCKED"
        locked_layer.conditions[0].is_por = False
        locked_layer.conditions[1].is_por = True
        await source_session.flush()

        with pytest.raises(ConflictError) as excinfo:
            await contender_repo.capture_source_project(source_id)
        assert excinfo.value.code == "source_project_busy"
        assert excinfo.value.details["project_id"] == source_id
        await contender_session.rollback()

        captured_events = await contender_session.scalar(
            select(func.count(ChangeEvent.id)).where(
                ChangeEvent.project_id.in_({source_id, target_id})
            )
        )
        assert captured_events == 0

        await source_session.rollback()

    async with factory() as verification_session:
        verification_repo = ProjectRepository(verification_session)
        captured = await verification_repo.capture_source_project(source_id)
        assert captured is not None
        assert captured.id == source_id
        assert captured.layers[0].conditions[0].label == "por"
        assert captured.layers[0].conditions[0].cell_values[0].value_text == "AUTO"
        assert captured.layers[0].conditions[0].is_por is True
        assert captured.layers[0].conditions[1].is_por is False


async def test_source_capture_same_project_reuses_locked_target_without_second_sql(
    pg_engine: AsyncEngine,
) -> None:
    factory = _new_factory(pg_engine)
    async with factory() as session:
        project = await _seed_project(
            session,
            line_id="L1",
            process_id="PROC_SAME",
            part_id="PART_SAME",
            name="same-project",
            layer_key="L1::PROC_SAME::010::ACT",
        )
        await session.commit()

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

    async with factory() as session:
        repo = ProjectRepository(session)
        locked_target = await repo.get_for_update(project.id)
        assert locked_target is not None

        event.listen(pg_engine.sync_engine, "before_cursor_execute", capture_sql)
        try:
            captured = await repo.capture_source_project(
                project.id, locked_target=locked_target
            )
        finally:
            event.remove(pg_engine.sync_engine, "before_cursor_execute", capture_sql)

        assert captured is locked_target
        assert statements == []


async def test_source_capture_nowait_avoids_cross_project_deadlock(
    pg_engine: AsyncEngine,
) -> None:
    factory = _new_factory(pg_engine)
    async with factory() as session:
        left = await _seed_project(
            session,
            line_id="L1",
            process_id="PROC_LEFT",
            part_id="PART_LEFT",
            name="left",
            layer_key="L1::PROC_LEFT::010::ACT",
        )
        right = await _seed_project(
            session,
            line_id="L1",
            process_id="PROC_RIGHT",
            part_id="PART_RIGHT",
            name="right",
            layer_key="L1::PROC_RIGHT::010::ACT",
        )
        await session.commit()

    async with factory() as left_holder_session, factory() as right_holder_session:
        left_holder_repo = ProjectRepository(left_holder_session)
        right_holder_repo = ProjectRepository(right_holder_session)

        left_target = await left_holder_repo.get_for_update(left.id)
        right_target = await right_holder_repo.get_for_update(right.id)
        assert left_target is not None
        assert right_target is not None

        async with factory() as left_session, factory() as right_session:
            left_repo = ProjectRepository(left_session)
            right_repo = ProjectRepository(right_session)

            go = asyncio.Event()

            async def capture_from_left() -> str:
                await go.wait()
                try:
                    await left_repo.capture_source_project(right.id)
                except ConflictError as exc:
                    await left_session.rollback()
                    return exc.code
                raise AssertionError("expected source_project_busy")

            async def capture_from_right() -> str:
                await go.wait()
                try:
                    await right_repo.capture_source_project(left.id)
                except ConflictError as exc:
                    await right_session.rollback()
                    return exc.code
                raise AssertionError("expected source_project_busy")

            left_task = asyncio.create_task(capture_from_left())
            right_task = asyncio.create_task(capture_from_right())
            go.set()
            results = await asyncio.wait_for(
                asyncio.gather(left_task, right_task), timeout=3
            )

    assert results == ["source_project_busy", "source_project_busy"]
