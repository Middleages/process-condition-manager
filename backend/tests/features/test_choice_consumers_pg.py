"""Real PostgreSQL ChoiceSet deactivate-versus-consumer lock races."""

import asyncio
import os
from collections.abc import AsyncIterator, Collection
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
from app.core.db import Base
from app.core.errors import DomainValidationError
from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType
from app.features.cells.repository import CellRepository
from app.features.cells.schema import CellsPatchIn, CellUpdateIn
from app.features.cells.service import CellService
from app.features.choice_sets.repository import ChoiceSetRepository
from app.features.choice_sets.schema import ChoiceSetPatchIn
from app.features.choice_sets.service import ChoiceSetService
from app.features.parameters.repository import ParameterRepository
from app.features.parameters.schema import ParameterCreate
from app.features.parameters.service import ParameterService
from app.models.choice import ChoiceSet
from app.models.parameter import Parameter
from app.models.project import CellValue, ChangeEvent, LayerCondition, Project, SheetLayer
from tests.factories import seed_choice_set, seed_parameter

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")

ConsumerKind = Literal["parameter_create", "csv_apply", "cell_batch"]
Winner = Literal["consumer", "deactivation"]


@pytest.fixture
async def pg_engine() -> AsyncIterator[AsyncEngine]:
    assert _PG_URL is not None
    engine = create_async_engine(_PG_URL)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
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
