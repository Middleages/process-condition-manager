"""PostgreSQL에서만 재현되는 편집 잠금 동시성 회귀 테스트."""

import asyncio
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models  # noqa: F401 -- metadata에 모든 모델 등록
from app.core.auth import UserContext
from app.core.db import Base, get_app_session
from app.core.locks import require_edit_lock
from app.features.locks.repository import EditLockRepository
from app.features.locks.service import LockService
from app.main import app
from app.models.project import EditLock, Project, ProjectStatus

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    _PG_URL is None,
    reason="APP_TEST_DATABASE_URL 미설정",
)


@pytest.fixture
async def pg_engine() -> AsyncIterator[AsyncEngine]:
    assert _PG_URL is not None
    engine = create_async_engine(_PG_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()


async def test_concurrent_acquire_returns_one_success_and_only_conflicts(
    pg_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """동시 최초 획득은 정확히 하나만 성공하고 나머지는 모두 409여야 한다."""
    factory = async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)
    async with factory() as session:
        project = Project(
            line_id="L1",
            process_id="PROC_LOCK",
            part_id="PART_LOCK",
            name="lock concurrency",
            status=ProjectStatus.DRAFT,
        )
        session.add(project)
        await session.commit()
        project_id = project.id

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    # 기존 check-then-insert 구현에서도 요청 타이밍에 따라 우연히 전부 409가 될 수 있다.
    # 각 요청이 "잠금 없음"을 읽은 지점에서 맞춰 출발시켜 최초 획득 경쟁을 결정적으로 만든다.
    original_get = EditLockRepository.get
    ready = 0
    ready_lock = asyncio.Lock()
    all_ready = asyncio.Event()

    async def synchronized_get(
        self: EditLockRepository, project_id: int
    ) -> EditLock | None:
        nonlocal ready
        lock = await original_get(self, project_id)
        if lock is None:
            async with ready_lock:
                ready += 1
                if ready == 20:
                    all_ready.set()
            try:
                await asyncio.wait_for(all_ready.wait(), timeout=0.2)
            except TimeoutError:
                # 수정 후에는 프로젝트 행 잠금 때문에 최초 요청만 이 지점에 도달한다.
                pass
        return lock

    monkeypatch.setattr(EditLockRepository, "get", synchronized_get)

    app.dependency_overrides[get_app_session] = override_session
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            responses = await asyncio.gather(
                *(client.post(f"/api/projects/{project_id}/lock") for _ in range(20))
            )
    finally:
        app.dependency_overrides.pop(get_app_session, None)

    statuses = [response.status_code for response in responses]
    assert statuses.count(200) == 1, statuses
    assert statuses.count(409) == 19, statuses
    assert 500 not in statuses


async def test_validated_edit_fences_expired_lock_takeover(
    pg_engine: AsyncEngine,
) -> None:
    """편집 토큰 검증 후 커밋 전까지 만료 잠금 탈취가 끼어들 수 없다."""
    factory = async_sessionmaker(pg_engine, expire_on_commit=False, class_=AsyncSession)
    old_token = "old-editor-token"
    now = datetime.now(UTC)
    async with factory() as session:
        project = Project(
            line_id="L1",
            process_id="PROC_FENCE",
            part_id="PART_FENCE",
            name="lock fencing",
            status=ProjectStatus.DRAFT,
        )
        session.add(project)
        await session.flush()
        project_id = project.id
        session.add(
            EditLock(
                project_id=project_id,
                locked_by="dev-admin",
                lock_token=old_token,
                locked_at=now,
                expires_at=now + timedelta(minutes=5),
            )
        )
        await session.commit()

    async with factory() as editor_session:
        await require_edit_lock(
            project_id,
            UserContext(id="dev-admin"),
            editor_session,
            old_token,
        )

        # 검증 직후 잠금이 만료됐다고 가정한다. 실제 편집 트랜잭션이 project 행을
        # 잡고 있으므로 새 획득은 편집 커밋 뒤까지 기다려야 한다.
        async with factory() as expiry_session:
            await expiry_session.execute(
                update(EditLock)
                .where(EditLock.project_id == project_id)
                .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
            await expiry_session.commit()

        async def take_over() -> str:
            async with factory() as contender_session:
                service = LockService(EditLockRepository(contender_session))
                lock = await service.acquire(project_id, user_id="dev-admin")
                await contender_session.commit()
                return lock.lock_token

        takeover = asyncio.create_task(take_over())
        await asyncio.sleep(0.05)
        assert not takeover.done()

        await editor_session.commit()
        new_token = await asyncio.wait_for(takeover, timeout=1)

    assert new_token != old_token
