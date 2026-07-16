"""PostgreSQL-only ChoiceSet lost-update and unique-index race coverage."""

import asyncio
import os
from collections.abc import AsyncIterator, Awaitable, Callable

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
from app.features.choice_sets.schema import (
    ChoiceImportIn,
    ChoiceOptionOrderIn,
    ChoiceSetCreateIn,
)
from app.features.choice_sets.service import ChoiceSetService
from app.models.choice import ChoiceOption, ChoiceSet
from tests.postgres_database import temporary_postgres_database

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")


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


async def _seed_set(
    factory: async_sessionmaker[AsyncSession], code: str, labels: dict[str, str]
) -> None:
    async with factory() as session:
        choice_set = ChoiceSet(code=code, display_name=code)
        choice_set.options.extend(
            ChoiceOption(code=option_code, label=label, sort_order=index)
            for index, (option_code, label) in enumerate(labels.items())
        )
        session.add(choice_set)
        await session.commit()


async def _race(
    factory: async_sessionmaker[AsyncSession],
    calls: tuple[
        Callable[[ChoiceSetService], Awaitable[object]],
        Callable[[ChoiceSetService], Awaitable[object]],
    ],
) -> list[tuple[str, object]]:
    start = asyncio.Event()

    async def run(call: Callable[[ChoiceSetService], Awaitable[object]]) -> tuple[str, object]:
        async with factory() as session:
            service = ChoiceSetService(ChoiceSetRepository(session))
            await start.wait()
            try:
                result = await call(service)
                await session.commit()
                return ("success", result)
            except ConflictError as exc:
                await session.rollback()
                return ("conflict", exc)

    tasks = [asyncio.create_task(run(call)) for call in calls]
    await asyncio.sleep(0)
    start.set()
    return await asyncio.gather(*tasks)


def _assert_one_changed(results: list[tuple[str, object]]) -> None:
    assert [kind for kind, _ in results].count("success") == 1, results
    assert [kind for kind, _ in results].count("conflict") == 1, results
    conflict = next(value for kind, value in results if kind == "conflict")
    assert isinstance(conflict, ConflictError)
    assert conflict.code == "choice_set_changed"


async def test_write_resolver_does_not_return_set_created_after_absent_lock_check(
    pg_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    factory = async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)
    absent_lock_checked = asyncio.Event()
    concurrent_create_committed = asyncio.Event()
    original_lock_sets = ChoiceSetRepository._lock_sets

    async def pause_after_absent_lock_check(
        self: ChoiceSetRepository, codes: set[str]
    ) -> dict[str, ChoiceSet]:
        locked = await original_lock_sets(self, codes)
        if codes == {"appeared_after_lock"}:
            assert locked == {}
            absent_lock_checked.set()
            await asyncio.wait_for(concurrent_create_committed.wait(), timeout=2)
        return locked

    monkeypatch.setattr(ChoiceSetRepository, "_lock_sets", pause_after_absent_lock_check)

    async def create_after_absent_check() -> None:
        await asyncio.wait_for(absent_lock_checked.wait(), timeout=2)
        async with factory() as session:
            choice_set = ChoiceSet(code="appeared_after_lock", display_name="Late set")
            choice_set.options.append(ChoiceOption(code="A", label="Late option"))
            session.add(choice_set)
            await session.commit()
        concurrent_create_committed.set()

    creator = asyncio.create_task(create_after_absent_check())
    async with factory() as resolver_session:
        repository = ChoiceSetRepository(resolver_session)
        resolved = await asyncio.wait_for(
            repository.resolve_options(
                {("appeared_after_lock", "A")},
                for_write=True,
            ),
            timeout=2,
        )
        await resolver_session.commit()
    await creator

    # A row that appeared after the absent lock check was never locked by this
    # transaction and therefore cannot be approved for a consumer write.
    assert resolved == {}
    async with factory() as verification_session:
        persisted = await verification_session.scalar(
            select(func.count())
            .select_from(ChoiceOption)
            .join(ChoiceSet, ChoiceSet.id == ChoiceOption.choice_set_id)
            .where(
                ChoiceSet.code == "appeared_after_lock",
                ChoiceOption.code == "A",
            )
        )
    assert persisted == 1


async def test_competing_reorders_serialize_version_check_and_keep_one_complete_order(
    pg_engine: AsyncEngine,
) -> None:
    factory = async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)
    await _seed_set(factory, "race_order", {"A": "A", "B": "B", "C": "C"})
    orders = (["A", "C", "B"], ["C", "B", "A"])
    results = await _race(
        factory,
        (
            lambda service: service.reorder_options(
                "race_order", ChoiceOptionOrderIn(expected_version=1, ordered_codes=orders[0])
            ),
            lambda service: service.reorder_options(
                "race_order", ChoiceOptionOrderIn(expected_version=1, ordered_codes=orders[1])
            ),
        ),
    )
    _assert_one_changed(results)

    async with factory() as session:
        choice_set = (
            await session.execute(select(ChoiceSet).where(ChoiceSet.code == "race_order"))
        ).scalar_one()
        rows = list(
            (
                await session.execute(
                    select(ChoiceOption.code)
                    .where(ChoiceOption.choice_set_id == choice_set.id)
                    .order_by(ChoiceOption.sort_order, ChoiceOption.code)
                )
            ).scalars()
        )
    assert choice_set.version == 2
    assert rows in orders


async def test_competing_imports_keep_exactly_the_winners_complete_csv(
    pg_engine: AsyncEngine,
) -> None:
    factory = async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)
    await _seed_set(factory, "race_import", {"A": "old A", "B": "old B", "C": "old C"})
    label_sets = (
        {"A": "first A", "B": "first B", "C": "first C"},
        {"A": "second A", "B": "second B", "C": "second C"},
    )

    def csv_text(labels: dict[str, str]) -> str:
        return "code,label,sort_order,is_active\n" + "".join(
            f"{code},{label},{index},true\n"
            for index, (code, label) in enumerate(labels.items())
        )

    results = await _race(
        factory,
        (
            lambda service: service.import_apply(
                "race_import", ChoiceImportIn(expected_version=1, csv_text=csv_text(label_sets[0]))
            ),
            lambda service: service.import_apply(
                "race_import", ChoiceImportIn(expected_version=1, csv_text=csv_text(label_sets[1]))
            ),
        ),
    )
    _assert_one_changed(results)

    async with factory() as session:
        choice_set = (
            await session.execute(select(ChoiceSet).where(ChoiceSet.code == "race_import"))
        ).scalar_one()
        result = await session.execute(
            select(ChoiceOption.code, ChoiceOption.label).where(
                ChoiceOption.choice_set_id == choice_set.id
            )
        )
        final = {code: label for code, label in result.all()}
    assert choice_set.version == 2
    assert final in label_sets


async def test_competing_set_creates_translate_unique_race_and_persist_one_row(
    pg_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    factory = async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)
    original_get = ChoiceSetRepository.get_set_by_code
    both_checked = asyncio.Event()
    ready_count = 0
    ready_lock = asyncio.Lock()

    async def synchronized_duplicate_check(
        self: ChoiceSetRepository, code: str
    ) -> ChoiceSet | None:
        nonlocal ready_count
        result = await original_get(self, code)
        if result is None:
            async with ready_lock:
                ready_count += 1
                if ready_count == 2:
                    both_checked.set()
            await both_checked.wait()
        return result

    # Force both UX pre-checks to observe no row. The unique index must decide the winner.
    monkeypatch.setattr(ChoiceSetRepository, "get_set_by_code", synchronized_duplicate_check)
    payloads = (
        ChoiceSetCreateIn(code="same_new_set", display_name="First"),
        ChoiceSetCreateIn(code="same_new_set", display_name="Second"),
    )
    results = await _race(
        factory,
        (
            lambda service: service.create_set(payloads[0]),
            lambda service: service.create_set(payloads[1]),
        ),
    )
    assert [kind for kind, _ in results].count("success") == 1, results
    assert [kind for kind, _ in results].count("conflict") == 1, results
    conflict = next(value for kind, value in results if kind == "conflict")
    assert isinstance(conflict, ConflictError)
    assert conflict.code == "choice_set_exists"

    async with factory() as session:
        count = await session.scalar(
            select(func.count()).select_from(ChoiceSet).where(ChoiceSet.code == "same_new_set")
        )
        rows = list(
            (
                await session.execute(
                    select(ChoiceSet.code, ChoiceSet.display_name).where(
                        ChoiceSet.code == "same_new_set"
                    )
                )
            ).all()
        )
    assert count == 1
    assert rows[0][1] in {"First", "Second"}
