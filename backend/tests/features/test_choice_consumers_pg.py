"""Real PostgreSQL ChoiceSet deactivate-versus-consumer lock races."""

import asyncio
import os
from collections.abc import AsyncIterator, Collection
from datetime import UTC, datetime, timedelta
from typing import Literal

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models  # noqa: F401 -- register every model for create_all
from app.core.auth import UserContext
from app.core.db import Base
from app.core.errors import DomainValidationError
from app.core.locks import require_edit_lock
from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType
from app.features.cells.repository import CellRepository
from app.features.cells.schema import CellsPatchIn, CellUpdateIn
from app.features.cells.service import CellService
from app.features.choice_sets.repository import ChoiceSetRepository
from app.features.choice_sets.schema import ChoiceOptionPatchIn, ChoiceSetPatchIn
from app.features.choice_sets.service import ChoiceSetService
from app.features.parameters.repository import ParameterRepository
from app.features.parameters.schema import ParameterCreate
from app.features.parameters.service import ParameterService
from app.features.projects.repository import ProjectRepository
from app.features.projects.schema import ProjectCreate, ProjectProfilePatchIn
from app.features.projects.service import ProjectService
from app.ingest.fixture_reader import FixtureIngestReader
from app.models.choice import ChoiceSet
from app.models.parameter import Parameter
from app.models.project import (
    CellValue,
    ChangeEvent,
    ChangeEventType,
    EditLock,
    LayerCondition,
    Project,
    ProjectProfile,
    SheetLayer,
)
from app.project_metadata import ManualProjectMetadataProvider, ProjectProfileSeed
from tests.factories import make_project_profile, seed_choice_set, seed_parameter
from tests.postgres_database import temporary_postgres_database

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")

ConsumerKind = Literal["parameter_create", "csv_apply", "cell_batch"]
Winner = Literal["consumer", "deactivation"]
ProfileConsumerKind = Literal["project_create", "profile_patch"]
DeactivationKind = Literal["set", "option"]


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
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.drop_all)
            await engine.dispose()


async def _seed_case(
    factory: async_sessionmaker[AsyncSession], kind: ConsumerKind
) -> int | None:
    async with factory() as session:
        choice_set = await seed_choice_set(
            session,
            code="equipment_mode",
            options=(("AUTO", "Automatic", True),),
        )
        if kind != "cell_batch":
            await session.commit()
            return None

        await seed_parameter(
            session,
            code="mode",
            value_type=ValueType.CHOICE,
            choice_set=choice_set,
        )
        project = Project(
            line_id="L1",
            process_id="PROC",
            part_id="PART",
            name="consumer race",
            profile=make_project_profile(process_name="PROC"),
        )
        layer = SheetLayer(
            layer_key="L1::PROC::010::ACT",
            step_seq="010",
            layer_id="ACT",
        )
        condition = LayerCondition(label="base", condition_index=1, is_por=True)
        layer.conditions.append(condition)
        project.layers.append(layer)
        session.add(project)
        await session.flush()
        condition_id = condition.id
        await session.commit()
        return condition_id


async def _consume(
    session: AsyncSession,
    kind: ConsumerKind,
    condition_id: int | None,
) -> object:
    if kind == "parameter_create":
        return await ParameterService(ParameterRepository(session)).create_parameter(
            ParameterCreate(
                code="direct_mode",
                display_name="Direct mode",
                value_type=ValueType.CHOICE,
                choice_set_code="equipment_mode",
            )
        )
    if kind == "csv_apply":
        csv_text = (
            "code,display_name,value_type,category,unit,min_value,max_value,"
            "choice_set_code,description,sort_order\n"
            "csv_mode,CSV Mode,choice,,,,,equipment_mode,,0\n"
        )
        return await ParameterService(ParameterRepository(session)).import_apply(csv_text)
    assert condition_id is not None
    return await CellService(CellRepository(session)).patch_cells(
        1,
        CellsPatchIn(
            cells=[
                CellUpdateIn(
                    condition_id=condition_id,
                    parameter_code="mode",
                    value="AUTO",
                )
            ]
        ),
        actor="race-user",
    )


@pytest.mark.parametrize("kind", ["parameter_create", "csv_apply", "cell_batch"])
@pytest.mark.parametrize("winner", ["consumer", "deactivation"])
async def test_deactivate_vs_consumer_is_serialized_by_parent_lock(
    pg_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
    kind: ConsumerKind,
    winner: Winner,
) -> None:
    factory = async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)
    condition_id = await _seed_case(factory, kind)

    async with factory() as consumer_session, factory() as admin_session:
        consumer_locked = asyncio.Event()
        consumer_attempted = asyncio.Event()
        admin_locked = asyncio.Event()
        admin_attempted = asyncio.Event()
        release_consumer = asyncio.Event()
        release_admin = asyncio.Event()
        original_lock_sets = ChoiceSetRepository._lock_sets
        original_admin_lock = ChoiceSetRepository.get_set_for_update

        async def controlled_consumer_lock(
            self: ChoiceSetRepository, codes: Collection[str]
        ) -> dict[str, ChoiceSet]:
            if self.session is not consumer_session:
                return await original_lock_sets(self, codes)
            if winner == "deactivation":
                consumer_attempted.set()
                return await original_lock_sets(self, codes)
            locked = await original_lock_sets(self, codes)
            consumer_locked.set()
            await asyncio.wait_for(release_consumer.wait(), timeout=3)
            return locked

        async def controlled_admin_lock(
            self: ChoiceSetRepository, code: str
        ) -> ChoiceSet | None:
            if self.session is not admin_session:
                return await original_admin_lock(self, code)
            if winner == "consumer":
                admin_attempted.set()
                return await original_admin_lock(self, code)
            locked = await original_admin_lock(self, code)
            admin_locked.set()
            await asyncio.wait_for(release_admin.wait(), timeout=3)
            return locked

        monkeypatch.setattr(ChoiceSetRepository, "_lock_sets", controlled_consumer_lock)
        monkeypatch.setattr(
            ChoiceSetRepository, "get_set_for_update", controlled_admin_lock
        )

        async def run_consumer() -> tuple[str, object]:
            try:
                result = await _consume(consumer_session, kind, condition_id)
                await consumer_session.commit()
                return "success", result
            except (RuleViolationError, DomainValidationError) as exc:
                await consumer_session.rollback()
                return "unprocessable", exc

        async def run_deactivation() -> None:
            service = ChoiceSetService(ChoiceSetRepository(admin_session))
            await service.patch_set(
                "equipment_mode",
                ChoiceSetPatchIn(expected_version=1, is_active=False),
            )
            await admin_session.commit()

        if winner == "consumer":
            consumer_task = asyncio.create_task(run_consumer())
            await asyncio.wait_for(consumer_locked.wait(), timeout=3)
            admin_task = asyncio.create_task(run_deactivation())
            await asyncio.wait_for(admin_attempted.wait(), timeout=3)
            release_consumer.set()
        else:
            admin_task = asyncio.create_task(run_deactivation())
            await asyncio.wait_for(admin_locked.wait(), timeout=3)
            consumer_task = asyncio.create_task(run_consumer())
            await asyncio.wait_for(consumer_attempted.wait(), timeout=3)
            release_admin.set()

        outcome, result = await asyncio.wait_for(consumer_task, timeout=3)
        await asyncio.wait_for(admin_task, timeout=3)

    assert outcome == ("success" if winner == "consumer" else "unprocessable")
    if winner == "deactivation":
        if kind == "cell_batch":
            assert isinstance(result, DomainValidationError)
            assert result.status_code == 422
        else:
            assert isinstance(result, RuleViolationError)
            assert result.code == "invalid_active_choice_set"
    async with factory() as verification:
        choice_set = (
            await verification.execute(
                select(ChoiceSet).where(ChoiceSet.code == "equipment_mode")
            )
        ).scalar_one()
        assert choice_set.is_active is False

        if kind == "cell_batch":
            stored = await verification.scalar(
                select(CellValue.value_text).where(
                    CellValue.condition_id == condition_id,
                    CellValue.parameter_code == "mode",
                )
            )
            event_count = await verification.scalar(
                select(func.count()).select_from(ChangeEvent)
            )
            assert stored == ("AUTO" if winner == "consumer" else None)
            assert event_count == (1 if winner == "consumer" else 0)
        else:
            code = "direct_mode" if kind == "parameter_create" else "csv_mode"
            stored_count = await verification.scalar(
                select(func.count()).select_from(Parameter).where(Parameter.code == code)
            )
            assert stored_count == (1 if winner == "consumer" else 0)


async def _seed_profile_case(
    factory: async_sessionmaker[AsyncSession], kind: ProfileConsumerKind
) -> tuple[int | None, str | None]:
    async with factory() as session:
        await seed_choice_set(
            session,
            code="device_type",
            options=(
                ("FOUNDRY", "Foundry", True),
                ("SPECIAL", "Special customer", True),
            ),
        )
        await seed_choice_set(
            session,
            code="project_category",
            options=(("LOGIC", "Logic", True),),
        )
        if kind == "project_create":
            await session.commit()
            return None, None

        now = datetime.now(UTC)
        project = Project(
            line_id="L1",
            process_id="PROC_ALPHA",
            part_id="PATCH-PART",
            name="profile patch race",
            profile=ProjectProfile(
                process_name="L1 / PROC_ALPHA",
                device_type_code="FOUNDRY",
                project_category_code="LOGIC",
            ),
        )
        session.add(project)
        await session.flush()
        token = "profile-editor-token"
        session.add(
            EditLock(
                project_id=project.id,
                locked_by="race-user",
                lock_token=token,
                locked_at=now,
                expires_at=now + timedelta(minutes=5),
            )
        )
        await session.commit()
        return project.id, token


async def _consume_profile_choice(
    session: AsyncSession,
    kind: ProfileConsumerKind,
    project_id: int | None,
    token: str | None,
) -> object:
    service = ProjectService(
        ProjectRepository(session),
        FixtureIngestReader(),
        ManualProjectMetadataProvider(),
    )
    if kind == "project_create":
        return await service.create_project(
            ProjectCreate(
                line_id="L1",
                process_id="PROC_ALPHA",
                part_id="CREATE-PART",
                name="project create race",
                device_type_code="SPECIAL",
                project_category_code="LOGIC",
            ),
            actor="race-user",
        )
    assert project_id is not None and token is not None
    await require_edit_lock(
        project_id,
        UserContext(id="race-user"),
        session,
        token,
    )
    return await service.patch_profile(
        project_id,
        ProjectProfilePatchIn(device_type_code="SPECIAL"),
        actor="race-user",
    )


@pytest.mark.parametrize("kind", ["project_create", "profile_patch"])
@pytest.mark.parametrize("deactivation", ["set", "option"])
@pytest.mark.parametrize("winner", ["consumer", "deactivation"])
async def test_profile_choice_write_vs_deactivation_is_serialized(
    pg_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
    kind: ProfileConsumerKind,
    deactivation: DeactivationKind,
    winner: Winner,
) -> None:
    factory = async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)
    project_id, token = await _seed_profile_case(factory, kind)

    async with factory() as consumer_session, factory() as admin_session:
        consumer_locked = asyncio.Event()
        consumer_attempted = asyncio.Event()
        admin_locked = asyncio.Event()
        admin_attempted = asyncio.Event()
        release_consumer = asyncio.Event()
        release_admin = asyncio.Event()
        original_lock_sets = ChoiceSetRepository._lock_sets
        original_admin_lock = ChoiceSetRepository.get_set_for_update

        async def controlled_consumer_lock(
            self: ChoiceSetRepository, codes: Collection[str]
        ) -> dict[str, ChoiceSet]:
            if self.session is not consumer_session:
                return await original_lock_sets(self, codes)
            if winner == "deactivation":
                consumer_attempted.set()
                return await original_lock_sets(self, codes)
            locked = await original_lock_sets(self, codes)
            consumer_locked.set()
            await asyncio.wait_for(release_consumer.wait(), timeout=3)
            return locked

        async def controlled_admin_lock(self: ChoiceSetRepository, code: str) -> ChoiceSet | None:
            if self.session is not admin_session:
                return await original_admin_lock(self, code)
            if winner == "consumer":
                admin_attempted.set()
                return await original_admin_lock(self, code)
            locked = await original_admin_lock(self, code)
            admin_locked.set()
            await asyncio.wait_for(release_admin.wait(), timeout=3)
            return locked

        monkeypatch.setattr(ChoiceSetRepository, "_lock_sets", controlled_consumer_lock)
        monkeypatch.setattr(ChoiceSetRepository, "get_set_for_update", controlled_admin_lock)

        async def run_consumer() -> tuple[str, object]:
            try:
                result = await _consume_profile_choice(consumer_session, kind, project_id, token)
                await consumer_session.commit()
                return "success", result
            except (RuleViolationError, DomainValidationError) as exc:
                await consumer_session.rollback()
                return "unprocessable", exc

        async def run_deactivation() -> None:
            service = ChoiceSetService(ChoiceSetRepository(admin_session))
            if deactivation == "set":
                await service.patch_set(
                    "device_type",
                    ChoiceSetPatchIn(expected_version=1, is_active=False),
                )
            else:
                await service.patch_option(
                    "device_type",
                    "SPECIAL",
                    ChoiceOptionPatchIn(expected_version=1, is_active=False),
                )
            await admin_session.commit()

        if winner == "consumer":
            consumer_task = asyncio.create_task(run_consumer())
            await asyncio.wait_for(consumer_locked.wait(), timeout=3)
            admin_task = asyncio.create_task(run_deactivation())
            await asyncio.wait_for(admin_attempted.wait(), timeout=3)
            release_consumer.set()
        else:
            admin_task = asyncio.create_task(run_deactivation())
            await asyncio.wait_for(admin_locked.wait(), timeout=3)
            consumer_task = asyncio.create_task(run_consumer())
            await asyncio.wait_for(consumer_attempted.wait(), timeout=3)
            release_admin.set()

        outcome, result = await asyncio.wait_for(consumer_task, timeout=3)
        await asyncio.wait_for(admin_task, timeout=3)

    assert outcome == ("success" if winner == "consumer" else "unprocessable")
    if winner == "deactivation":
        assert isinstance(result, (RuleViolationError, DomainValidationError))

    async with factory() as verification:
        profile_count = await verification.scalar(select(func.count()).select_from(ProjectProfile))
        create_event_count = await verification.scalar(
            select(func.count())
            .select_from(ChangeEvent)
            .where(ChangeEvent.event_type == ChangeEventType.PROJECT_CREATE)
        )
        patch_event_count = await verification.scalar(
            select(func.count())
            .select_from(ChangeEvent)
            .where(ChangeEvent.event_type == ChangeEventType.PROJECT_PROFILE_UPDATE)
        )
        if kind == "project_create":
            assert profile_count == (1 if winner == "consumer" else 0)
            assert create_event_count == (1 if winner == "consumer" else 0)
            assert patch_event_count == 0
        else:
            assert project_id is not None
            stored_code = await verification.scalar(
                select(ProjectProfile.device_type_code).where(
                    ProjectProfile.project_id == project_id
                )
            )
            assert profile_count == 1
            assert create_event_count == 0
            assert stored_code == ("SPECIAL" if winner == "consumer" else "FOUNDRY")
            assert patch_event_count == (1 if winner == "consumer" else 0)


async def test_optional_seed_create_and_multi_choice_patch_share_one_global_lock_order(
    pg_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Create must not hold required-set locks while loading optional provider facts."""
    factory = async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)
    now = datetime.now(UTC)
    async with factory() as seed_session:
        await seed_choice_set(
            seed_session,
            code="active_direction",
            options=(("DOWN", "Down", True), ("UP", "Up", True)),
        )
        await seed_choice_set(
            seed_session,
            code="device_type",
            options=(
                ("FOUNDRY", "Foundry", True),
                ("SPECIAL", "Special customer", True),
            ),
        )
        await seed_choice_set(
            seed_session,
            code="gate_direction",
            options=(("LEFT", "Left", True),),
        )
        await seed_choice_set(
            seed_session,
            code="project_category",
            options=(("LOGIC", "Logic", True),),
        )
        existing = Project(
            line_id="L1",
            process_id="PROC_ALPHA",
            part_id="PATCH-OPTIONAL",
            name="multi-choice patch race",
            profile=ProjectProfile(
                process_name="L1 / PROC_ALPHA",
                device_type_code="FOUNDRY",
                project_category_code="LOGIC",
                active_direction_code="DOWN",
            ),
        )
        seed_session.add(existing)
        await seed_session.flush()
        token = "multi-choice-editor-token"
        seed_session.add(
            EditLock(
                project_id=existing.id,
                locked_by="race-user",
                lock_token=token,
                locked_at=now,
                expires_at=now + timedelta(minutes=5),
            )
        )
        existing_id = existing.id
        await seed_session.commit()

    async with factory() as create_session, factory() as patch_session:
        provider_entered = asyncio.Event()
        release_provider = asyncio.Event()
        patch_locked = asyncio.Event()
        release_patch = asyncio.Event()
        create_lock_attempted = asyncio.Event()
        create_lock_calls: list[tuple[str, ...]] = []
        patch_lock_calls: list[tuple[str, ...]] = []
        original_lock_sets = ChoiceSetRepository._lock_sets

        class CoordinatedProvider:
            identifier = "coordinated-optional-seed"

            async def load_seed(
                self, *, line_id: str, process_id: str, part_id: str
            ) -> ProjectProfileSeed:
                assert (line_id, process_id, part_id) == (
                    "L1",
                    "PROC_ALPHA",
                    "CREATE-OPTIONAL",
                )
                provider_entered.set()
                await asyncio.wait_for(release_provider.wait(), timeout=3)
                return ProjectProfileSeed(
                    active_direction_code="UP",
                    gate_direction_code="LEFT",
                )

        async def controlled_lock_sets(
            self: ChoiceSetRepository, codes: Collection[str]
        ) -> dict[str, ChoiceSet]:
            ordered_codes = tuple(sorted(set(codes)))
            if self.session is create_session:
                create_lock_calls.append(ordered_codes)
                create_lock_attempted.set()
                return await original_lock_sets(self, codes)
            if self.session is patch_session:
                patch_lock_calls.append(ordered_codes)
                locked = await original_lock_sets(self, codes)
                patch_locked.set()
                await asyncio.wait_for(release_patch.wait(), timeout=3)
                return locked
            return await original_lock_sets(self, codes)

        monkeypatch.setattr(ChoiceSetRepository, "_lock_sets", controlled_lock_sets)
        create_service = ProjectService(
            ProjectRepository(create_session),
            FixtureIngestReader(),
            CoordinatedProvider(),
        )
        patch_service = ProjectService(
            ProjectRepository(patch_session),
            FixtureIngestReader(),
            ManualProjectMetadataProvider(),
        )

        async def run_create() -> None:
            await create_service.create_project(
                ProjectCreate(
                    line_id="L1",
                    process_id="PROC_ALPHA",
                    part_id="CREATE-OPTIONAL",
                    name="optional seed create race",
                    device_type_code="FOUNDRY",
                    project_category_code="LOGIC",
                ),
                actor="race-user",
            )
            await create_session.commit()

        async def run_patch() -> None:
            await require_edit_lock(
                existing_id,
                UserContext(id="race-user"),
                patch_session,
                token,
            )
            await patch_service.patch_profile(
                existing_id,
                ProjectProfilePatchIn(
                    device_type_code="SPECIAL",
                    active_direction_code="UP",
                ),
                actor="race-user",
            )
            await patch_session.commit()

        create_task = asyncio.create_task(run_create())
        await asyncio.wait_for(provider_entered.wait(), timeout=3)
        if create_lock_attempted.is_set():
            # Let the old two-phase implementation finish cleanly before RED fails.
            release_provider.set()
            await asyncio.wait_for(create_task, timeout=3)
        assert not create_lock_attempted.is_set(), (
            "creation acquired required ChoiceSet locks before the provider returned"
        )

        patch_task = asyncio.create_task(run_patch())
        await asyncio.wait_for(patch_locked.wait(), timeout=3)
        release_provider.set()
        await asyncio.wait_for(create_lock_attempted.wait(), timeout=3)
        await asyncio.sleep(0.05)
        assert not create_task.done(), "creation did not serialize behind the Profile patch"
        release_patch.set()
        await asyncio.wait_for(patch_task, timeout=3)
        await asyncio.wait_for(create_task, timeout=3)

    assert create_lock_calls == [
        (
            "active_direction",
            "device_type",
            "gate_direction",
            "project_category",
        )
    ]
    assert patch_lock_calls == [("active_direction", "device_type")]

    async with factory() as verification:
        profiles = (
            await verification.execute(
                select(Project.part_id, ProjectProfile)
                .join(ProjectProfile, ProjectProfile.project_id == Project.id)
                .order_by(Project.part_id)
            )
        ).all()
        by_part = {part_id: profile for part_id, profile in profiles}
        assert set(by_part) == {"CREATE-OPTIONAL", "PATCH-OPTIONAL"}
        assert by_part["CREATE-OPTIONAL"].device_type_code == "FOUNDRY"
        assert by_part["CREATE-OPTIONAL"].active_direction_code == "UP"
        assert by_part["CREATE-OPTIONAL"].gate_direction_code == "LEFT"
        assert by_part["PATCH-OPTIONAL"].device_type_code == "SPECIAL"
        assert by_part["PATCH-OPTIONAL"].active_direction_code == "UP"

        events = (
            await verification.execute(
                select(ChangeEvent).order_by(ChangeEvent.id)
            )
        ).scalars().all()
        assert [event.event_type for event in events] == [
            ChangeEventType.PROJECT_PROFILE_UPDATE,
            ChangeEventType.PROJECT_CREATE,
        ]
        assert set(events[0].payload["changes"]) == {
            "active_direction_code",
            "device_type_code",
        }
        assert events[1].payload["profile_final"]["active_direction_code"] == "UP"
        assert events[1].payload["profile_final"]["gate_direction_code"] == "LEFT"
