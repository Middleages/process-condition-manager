"""PG writer-contract regressions for project create and backbone replace.

These tests cover two gaps that the SQLite API suites do not prove as strongly:
- a duplicate project identity race must roll back the loser cleanly
- backbone replace must copy from the captured source snapshot even if the source
  layer changes before repopulation resumes
"""

import asyncio
import os
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models  # noqa: F401 -- register every model for create_all
from app.core.db import Base
from app.core.errors import ConflictError
from app.features.choice_sets.repository import ChoiceSetRepository
from app.features.projects.repository import ProjectRepository
from app.features.projects.schema import BackboneReplaceIn, ProjectCreate
from app.features.projects.service import ProjectService
from app.ingest.fixture_reader import FixtureIngestReader
from app.models.project import (
    CellValue,
    ChangeEvent,
    ChangeEventType,
    LayerCondition,
    Project,
    SheetLayer,
)
from app.project_metadata.manual import ManualProjectMetadataProvider
from tests.factories import (
    seed_backbone_capture_parameters,
    seed_required_profile_choice_sets,
)

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")


@pytest.fixture
async def pg_engine(tmp_path_factory: pytest.TempPathFactory) -> AsyncIterator[AsyncEngine]:
    if _PG_URL is None:
        database_path = tmp_path_factory.mktemp("phase4-writer") / "writer.sqlite"
        url = f"sqlite+aiosqlite:///{database_path}"
        engine = create_async_engine(url, connect_args={"check_same_thread": False})
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        try:
            yield engine
        finally:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.drop_all)
            await engine.dispose()
        return

    with temporary_postgres_database() as database:
        engine = create_async_engine(database.async_url)
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


async def _seed_required_choices(factory: async_sessionmaker[AsyncSession]) -> None:
    async with factory() as session:
        await seed_required_profile_choice_sets(session)
        await seed_backbone_capture_parameters(session)
        await session.commit()


def _service(session: AsyncSession) -> ProjectService:
    return ProjectService(
        ProjectRepository(session),
        FixtureIngestReader(),
        ManualProjectMetadataProvider(),
    )


async def _create_project(
    service: ProjectService, payload: ProjectCreate, *, actor: str
) -> Project:
    project = await service.create_project(payload, actor=actor)
    await service.repo.session.commit()
    return project


async def _seed_source_cell(
    session: AsyncSession, *, project_id: int, layer_key: str, value_text: str
) -> None:
    layer = (
        await session.execute(
            select(SheetLayer).where(
                SheetLayer.project_id == project_id,
                SheetLayer.layer_key == layer_key,
            )
        )
    ).scalar_one()
    condition = (
        await session.execute(
            select(LayerCondition).where(LayerCondition.layer_id == layer.id)
        )
    ).scalar_one()
    session.add(
        CellValue(
            condition_id=condition.id,
            parameter_code="spin_speed",
            value_text=value_text,
        )
    )
    await session.commit()


async def _change_event_count(
    session: AsyncSession, project_id: int, event_type: ChangeEventType
) -> int:
    count = await session.scalar(
        select(func.count(ChangeEvent.id)).where(
            ChangeEvent.project_id == project_id,
            ChangeEvent.event_type == event_type,
        )
    )
    assert count is not None
    return int(count)


async def _project_count(
    session: AsyncSession, *, line_id: str, process_id: str, part_id: str
) -> int:
    count = await session.scalar(
        select(func.count(Project.id)).where(
            Project.line_id == line_id,
            Project.process_id == process_id,
            Project.part_id == part_id,
        )
    )
    assert count is not None
    return int(count)


async def test_create_project_race_rolls_back_the_loser(
    pg_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    await _seed_required_choices(pg_factory)

    original_get_by_identity = ProjectRepository.get_by_identity
    both_checked = asyncio.Event()
    ready_lock = asyncio.Lock()
    ready_count = 0
    race_identity = ("L1", "PROC_ALPHA", "PART-RACE")

    async def controlled_get_by_identity(
        self: ProjectRepository, line_id: str, process_id: str, part_id: str
    ) -> Project | None:
        nonlocal ready_count
        result = await original_get_by_identity(self, line_id, process_id, part_id)
        if (line_id, process_id, part_id) == race_identity and result is None:
            async with ready_lock:
                ready_count += 1
                if ready_count == 2:
                    both_checked.set()
            await both_checked.wait()
        return result

    async def noop_lock_sets(
        self: ChoiceSetRepository, codes: list[str] | set[str] | tuple[str, ...]
    ) -> dict[str, object]:
        return {}

    async def noop_resolve_active_options(
        self: ChoiceSetRepository,
        keys: set[tuple[str, str]],
        *,
        for_write: bool = True,
        prelocked_set_codes: list[str] | set[str] | tuple[str, ...] | None = None,
    ) -> dict[tuple[str, str], object]:
        return {}

    monkeypatch.setattr(ProjectRepository, "get_by_identity", controlled_get_by_identity)
    monkeypatch.setattr(ChoiceSetRepository, "lock_sets_for_write", noop_lock_sets)
    monkeypatch.setattr(ChoiceSetRepository, "resolve_active_options", noop_resolve_active_options)

    payload = ProjectCreate(
        line_id="L1",
        process_id="PROC_ALPHA",
        part_id="PART-RACE",
        name="Race target",
        device_type_code="DEFAULT",
        project_category_code="DEFAULT",
    )

    async def run(session: AsyncSession) -> tuple[str, object]:
        service = _service(session)
        try:
            project = await _create_project(service, payload, actor="race-user")
            return "success", project.id
        except ConflictError as exc:
            await session.rollback()
            return "conflict", exc

    async with pg_factory() as session_a, pg_factory() as session_b:
        task_a = asyncio.create_task(run(session_a))
        task_b = asyncio.create_task(run(session_b))
        results = await asyncio.gather(task_a, task_b)

    assert [kind for kind, _ in results].count("success") == 1, results
    assert [kind for kind, _ in results].count("conflict") == 1, results
    conflict = next(value for kind, value in results if kind == "conflict")
    assert isinstance(conflict, ConflictError)
    assert conflict.code == "conflict"

    async with pg_factory() as verify_session:
        assert await _project_count(
            verify_session,
            line_id=race_identity[0],
            process_id=race_identity[1],
            part_id=race_identity[2],
        ) == 1
        project_id = await verify_session.scalar(
            select(Project.id).where(
                Project.line_id == race_identity[0],
                Project.process_id == race_identity[1],
                Project.part_id == race_identity[2],
            )
        )
        assert project_id is not None
        assert await _change_event_count(
            verify_session, project_id, ChangeEventType.PROJECT_CREATE
        ) == 1


async def test_backbone_replace_uses_captured_source_snapshot(
    pg_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    await _seed_required_choices(pg_factory)
    fixture_reader = FixtureIngestReader()
    provider = ManualProjectMetadataProvider()

    source_payload = ProjectCreate(
        line_id="L1",
        process_id="PROC_ALPHA",
        part_id="SOURCE",
        name="Source",
        device_type_code="DEFAULT",
        project_category_code="DEFAULT",
    )
    target_payload = ProjectCreate(
        line_id="L1",
        process_id="PROC_BETA",
        part_id="TARGET",
        name="Target",
        device_type_code="DEFAULT",
        project_category_code="DEFAULT",
    )

    async with pg_factory() as source_session, pg_factory() as target_session:
        source_service = ProjectService(ProjectRepository(source_session), fixture_reader, provider)
        target_service = ProjectService(ProjectRepository(target_session), fixture_reader, provider)

        source = await _create_project(source_service, source_payload, actor="seed-user")
        target = await _create_project(target_service, target_payload, actor="seed-user")

        source_layer_key = source.layers[1].layer_key
        target_layer_key = target.layers[1].layer_key
        await _seed_source_cell(
            source_session,
            project_id=source.id,
            layer_key=source_layer_key,
            value_text="1200",
        )

        original_flush = AsyncSession.flush
        pause_enabled = False
        flush_started = asyncio.Event()
        release_flush = asyncio.Event()

        async def paused_flush(self: AsyncSession, *args, **kwargs):
            if pause_enabled and self is target_session:
                flush_started.set()
                await asyncio.wait_for(release_flush.wait(), timeout=3)
            return await original_flush(self, *args, **kwargs)

        monkeypatch.setattr(AsyncSession, "flush", paused_flush)

        async def mutate_source_after_snapshot() -> None:
            await asyncio.wait_for(flush_started.wait(), timeout=3)
            async with pg_factory() as mutator_session:
                row = (
                    await mutator_session.execute(
                        select(CellValue)
                        .join(LayerCondition, CellValue.condition_id == LayerCondition.id)
                        .join(SheetLayer, LayerCondition.layer_id == SheetLayer.id)
                        .where(
                            SheetLayer.project_id == source.id,
                            SheetLayer.layer_key == source_layer_key,
                            CellValue.parameter_code == "spin_speed",
                        )
                    )
                ).scalar_one()
                row.value_text = "1300"
                await mutator_session.commit()
            release_flush.set()

        pause_enabled = True
        mutator = asyncio.create_task(mutate_source_after_snapshot())
        replaced = await target_service.replace_layer_backbone(
            target.id,
            target_layer_key,
            BackboneReplaceIn(
                source_project_id=source.id,
                source_layer_key=source_layer_key,
            ),
            actor="replace-user",
        )
        await target_session.commit()
        await mutator

    assert replaced.layers[1].source_project_id == source.id
    assert replaced.layers[1].source_layer_key == source_layer_key
    assert replaced.layers[1].backbone_snapshot is not None
    assert replaced.layers[1].backbone_snapshot["source"]["project_id"] == source.id
    assert replaced.layers[1].backbone_snapshot["source"]["layer_key"] == source_layer_key
    assert replaced.layers[1].backbone_snapshot["capture_batch_id"]
    assert replaced.layers[1].backbone_snapshot["captured_at"].endswith("Z")

    async with pg_factory() as verify_session:
        source_value = (
            await verify_session.execute(
                select(CellValue.value_text)
                .join(LayerCondition, CellValue.condition_id == LayerCondition.id)
                .join(SheetLayer, LayerCondition.layer_id == SheetLayer.id)
                .where(
                    SheetLayer.project_id == source.id,
                    SheetLayer.layer_key == source_layer_key,
                    CellValue.parameter_code == "spin_speed",
                )
            )
        ).scalar_one()
        target_value = (
            await verify_session.execute(
                select(CellValue.value_text)
                .join(LayerCondition, CellValue.condition_id == LayerCondition.id)
                .join(SheetLayer, LayerCondition.layer_id == SheetLayer.id)
                .where(
                    SheetLayer.project_id == target.id,
                    SheetLayer.layer_key == target_layer_key,
                    CellValue.parameter_code == "spin_speed",
                )
            )
        ).scalar_one()

    assert source_value == "1300"
    assert target_value == "1200"


async def test_backbone_create_rolls_back_when_event_flush_fails(
    pg_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    await _seed_required_choices(pg_factory)
    fixture_reader = FixtureIngestReader()
    provider = ManualProjectMetadataProvider()

    source_payload = ProjectCreate(
        line_id="L1",
        process_id="PROC_ALPHA",
        part_id="SOURCE",
        name="Source",
        device_type_code="DEFAULT",
        project_category_code="DEFAULT",
    )
    async with pg_factory() as source_session, pg_factory() as target_session:
        source_service = ProjectService(ProjectRepository(source_session), fixture_reader, provider)
        target_service = ProjectService(ProjectRepository(target_session), fixture_reader, provider)

        source = await _create_project(source_service, source_payload, actor="seed-user")
        target_payload = ProjectCreate(
            line_id="L1",
            process_id="PROC_BETA",
            part_id="TARGET",
            name="Target",
            device_type_code="DEFAULT",
            project_category_code="DEFAULT",
            backbone_project_id=source.id,
        )

        original_flush = AsyncSession.flush
        flush_count = 0

        async def fail_on_second_target_flush(self: AsyncSession, *args, **kwargs):
            nonlocal flush_count
            if self is target_session:
                flush_count += 1
                if flush_count == 2:
                    raise RuntimeError("event flush failed")
            return await original_flush(self, *args, **kwargs)

        monkeypatch.setattr(AsyncSession, "flush", fail_on_second_target_flush)

        with pytest.raises(RuntimeError, match="event flush failed"):
            await target_service.create_project(target_payload, actor="seed-user")
        await target_session.rollback()

    async with pg_factory() as verify_session:
        project_rows = await verify_session.scalar(
            select(func.count(Project.id)).where(
                Project.line_id == "L1",
                Project.process_id == "PROC_BETA",
                Project.part_id == "TARGET",
            )
        )
        event_rows = await verify_session.scalar(
            select(func.count(ChangeEvent.id)).join(Project).where(
                Project.line_id == "L1",
                Project.process_id == "PROC_BETA",
                Project.part_id == "TARGET",
            )
        )
        assert project_rows == 0
        assert event_rows == 0
