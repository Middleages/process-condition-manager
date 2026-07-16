"""Phase 4 writer mutation-freeze regression coverage on real PostgreSQL."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

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
from app.core import maintenance
from app.core.auth import UserContext, get_current_user
from app.core.db import Base, get_app_session
from app.main import app
from app.models.project import (
    CellValue,
    ChangeEvent,
    EditLock,
    LayerCondition,
    Project,
    ProjectProfile,
    ProjectStatus,
    SheetLayer,
)
from tests.factories import seed_required_profile_choice_sets
from tests.postgres_database import temporary_postgres_database

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")


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


async def _seed_source_project(session: AsyncSession) -> dict[str, Any]:
    project = Project(
        line_id="L1",
        process_id="PROC_SRC",
        part_id="PART_SRC",
        name="pg-freeze-source",
        status=ProjectStatus.DRAFT,
        profile=ProjectProfile(
            process_name="PROC_SRC",
            device_type_code="DEFAULT",
            project_category_code="DEFAULT",
        ),
    )
    layer = SheetLayer(
        layer_key="L1::PROC_SRC::010::SRC",
        step_seq="010",
        layer_id="SRC",
        sort_order=1,
    )
    source = LayerCondition(label="SRC1", condition_index=1, is_por=False)
    source.cell_values.extend(
        [
            CellValue(parameter_code="spin_speed", value_text="900"),
            CellValue(parameter_code="memo", value_text="source"),
        ]
    )
    layer.conditions.append(source)
    project.layers.append(layer)
    session.add(project)
    await session.flush()
    return {
        "project_id": project.id,
        "layer_key": layer.layer_key,
        "condition_id": source.id,
    }


async def _seed_target_project(session: AsyncSession) -> dict[str, Any]:
    project = Project(
        line_id="L1",
        process_id="PROC_TGT",
        part_id="PART_TGT",
        name="pg-freeze-target",
        status=ProjectStatus.DRAFT,
        profile=ProjectProfile(
            process_name="PROC_TGT",
            device_type_code="DEFAULT",
            project_category_code="DEFAULT",
        ),
    )
    main_layer = SheetLayer(
        layer_key="L1::PROC_TGT::010::ACT",
        step_seq="010",
        layer_id="ACT",
        sort_order=1,
    )
    backup_layer = SheetLayer(
        layer_key="L1::PROC_TGT::020::WAIT",
        step_seq="020",
        layer_id="WAIT",
        sort_order=2,
    )
    source = LayerCondition(label="T1", condition_index=1, is_por=True)
    source.cell_values.extend(
        [
            CellValue(parameter_code="spin_speed", value_text="1000"),
            CellValue(parameter_code="memo", value_text="seed"),
        ]
    )
    removable = LayerCondition(label="T2", condition_index=2, is_por=False)
    por_target = LayerCondition(label="T3", condition_index=3, is_por=False)
    main_layer.conditions.extend([source, removable, por_target])
    project.layers.extend([main_layer, backup_layer])
    session.add(project)
    await session.flush()
    return {
        "project_id": project.id,
        "main_layer_key": main_layer.layer_key,
        "secondary_layer_key": backup_layer.layer_key,
        "source_condition_id": source.id,
        "removable_condition_id": removable.id,
        "por_target_condition_id": por_target.id,
    }


async def _project_truth_counts(session: AsyncSession) -> dict[str, int]:
    session.expire_all()

    async def _count(model: type[Any]) -> int:
        value = await session.scalar(select(func.count()).select_from(model))
        return int(value or 0)

    return {
        "projects": await _count(Project),
        "layers": await _count(SheetLayer),
        "conditions": await _count(LayerCondition),
        "cells": await _count(CellValue),
        "events": await _count(ChangeEvent),
        "locks": await _count(EditLock),
    }


@pytest.mark.asyncio
async def test_mutation_freeze_blocks_truth_writes_without_changing_counts(
    pg_factory: async_sessionmaker[AsyncSession],
    pg_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with pg_factory() as setup_session:
        await seed_required_profile_choice_sets(setup_session)
        source_project = await _seed_source_project(setup_session)
        target_project = await _seed_target_project(setup_session)
        await setup_session.commit()

    lock_response = await pg_client.post(f"/api/projects/{target_project['project_id']}/lock")
    assert lock_response.status_code == 200, lock_response.text
    lock_token = lock_response.json()["lock_token"]

    async with pg_factory() as verify_session:
        baseline = await _project_truth_counts(verify_session)

    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    blocked_cases = [
        (
            "POST",
            "/api/projects",
            {
                "json": {
                    "device_type_code": "DEFAULT",
                    "project_category_code": "DEFAULT",
                    "line_id": "L1",
                    "process_id": "PROC_NEW",
                    "part_id": "PART_NEW",
                    "name": "blocked create",
                }
            },
        ),
        (
            "POST",
            f"/api/projects/{target_project['project_id']}/layers/{target_project['secondary_layer_key']}/backbone-replace",
            {
                "json": {
                    "source_project_id": source_project["project_id"],
                    "source_layer_key": source_project["layer_key"],
                },
            },
        ),
        (
            "PATCH",
            f"/api/projects/{target_project['project_id']}/profile",
            {"json": {"comment": "blocked"}},
        ),
        (
            "PATCH",
            f"/api/projects/{target_project['project_id']}/cells",
            {
                "json": {
                    "origin": "manual",
                    "cells": [
                        {
                            "condition_id": target_project["source_condition_id"],
                            "parameter_code": "spin_speed",
                            "value": "1200",
                        }
                    ],
                }
            },
        ),
        (
            "POST",
            f"/api/projects/{target_project['project_id']}/layers/{target_project['main_layer_key']}/conditions",
            {"json": {"source_condition_id": target_project["source_condition_id"]}},
        ),
        (
            "DELETE",
            f"/api/projects/{target_project['project_id']}/conditions/{target_project['removable_condition_id']}",
            {},
        ),
        (
            "PUT",
            f"/api/projects/{target_project['project_id']}/conditions/{target_project['por_target_condition_id']}/por",
            {},
        ),
        ("POST", f"/api/projects/{source_project['project_id']}/lock", {}),
        (
            "POST",
            f"/api/projects/{target_project['project_id']}/lock/heartbeat",
            {"json": {"lock_token": lock_token}},
        ),
    ]

    for method, url, kwargs in blocked_cases:
        resp = await pg_client.request(method, url, **kwargs)
        assert resp.status_code == 503, resp.text
        assert resp.json()["code"] == "project_mutations_disabled"
        assert resp.headers["Retry-After"] == "60"
        async with pg_factory() as verify_session:
            assert await _project_truth_counts(verify_session) == baseline

    allowed_get = await pg_client.get(f"/api/projects/{target_project['project_id']}")
    assert allowed_get.status_code == 200, allowed_get.text
    async with pg_factory() as verify_session:
        assert await _project_truth_counts(verify_session) == baseline

    allowed_preview = await pg_client.post(
        "/api/projects/backbone-preview",
        json={"line_id": "L1", "process_id": "PROC_BETA"},
    )
    assert allowed_preview.status_code == 200, allowed_preview.text
    async with pg_factory() as verify_session:
        assert await _project_truth_counts(verify_session) == baseline

    release_delete = await pg_client.request(
        "DELETE",
        f"/api/projects/{target_project['project_id']}/lock",
        json={"lock_token": lock_token},
    )
    assert release_delete.status_code == 204, release_delete.text
    async with pg_factory() as verify_session:
        after_delete = await _project_truth_counts(verify_session)
    assert after_delete["locks"] == baseline["locks"] - 1
    assert {key: value for key, value in after_delete.items() if key != "locks"} == {
        key: value for key, value in baseline.items() if key != "locks"
    }

    release_beacon = await pg_client.post(
        f"/api/projects/{target_project['project_id']}/lock/release",
        json={"lock_token": lock_token},
    )
    assert release_beacon.status_code == 204, release_beacon.text
    async with pg_factory() as verify_session:
        assert await _project_truth_counts(verify_session) == after_delete
