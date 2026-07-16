"""Phase 4 writer rollback-only gate API coverage."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import maintenance
from tests.factories import seed_required_profile_choice_sets

_CORE_PROFILE = {
    "device_type_code": "DEFAULT",
    "project_category_code": "DEFAULT",
}


@pytest.fixture(autouse=True)
async def _required_profile_choices(db_session: AsyncSession) -> None:
    await seed_required_profile_choice_sets(db_session)
    await db_session.commit()


async def _create_project(
    db_client: AsyncClient,
    *,
    name: str = "Phase 4 Gate",
    process_id: str = "PROC_ALPHA",
    part_id: str = "PART-001",
) -> dict:
    resp = await db_client.post(
        "/api/projects",
        json={
            **_CORE_PROFILE,
            "line_id": "L1",
            "process_id": process_id,
            "part_id": part_id,
            "name": name,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _acquire_lock(db_client: AsyncClient, project_id: int) -> dict[str, str]:
    resp = await db_client.post(f"/api/projects/{project_id}/lock")
    assert resp.status_code == 200, resp.text
    return {"X-Lock-Token": resp.json()["lock_token"]}


async def test_mutation_gate_blocks_project_truth_writes_and_keeps_drain_releases(
    db_client: AsyncClient, monkeypatch
) -> None:
    locked_project = await _create_project(db_client, name="Locked project")
    unlocked_project = await _create_project(
        db_client, name="Unlocked project", process_id="PROC_BETA", part_id="PART-002"
    )
    headers = await _acquire_lock(db_client, locked_project["id"])

    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    blocked_cases = [
        (
            "POST",
            "/api/projects",
            {
                "json": {
                    **_CORE_PROFILE,
                    "line_id": "L1",
                    "process_id": "PROC_BETA",
                    "part_id": "PART-002",
                    "name": "Blocked create",
                }
            },
        ),
        (
            "POST",
            f"/api/projects/{locked_project['id']}/layers/{locked_project['layers'][1]['layer_key']}/backbone-replace",
            {
                "json": {
                    "source_project_id": locked_project["id"],
                    "source_layer_key": locked_project["layers"][0]["layer_key"],
                },
            },
        ),
        (
            "PATCH",
            f"/api/projects/{locked_project['id']}/profile",
            {"json": {"comment": "blocked"}},
        ),
        (
            "PATCH",
            f"/api/projects/{locked_project['id']}/cells",
            {"json": {"cells": [], "origin": "manual"}},
        ),
        (
            "POST",
            f"/api/projects/{locked_project['id']}/layers/{locked_project['layers'][0]['layer_key']}/conditions",
            {"json": {}},
        ),
        ("DELETE", f"/api/projects/{locked_project['id']}/conditions/999999", {}),
        ("PUT", f"/api/projects/{locked_project['id']}/conditions/999999/por", {}),
        ("POST", f"/api/projects/{unlocked_project['id']}/lock", {}),
        (
            "POST",
            f"/api/projects/{locked_project['id']}/lock/heartbeat",
            {"json": {"lock_token": headers["X-Lock-Token"]}},
        ),
    ]

    for method, url, kwargs in blocked_cases:
        resp = await db_client.request(method, url, **kwargs)
        assert resp.status_code == 503, resp.text
        body = resp.json()
        assert body["code"] == "project_mutations_disabled"
        assert resp.headers["Retry-After"] == "60"

    allowed_preview = await db_client.post(
        "/api/projects/backbone-preview",
        json={"line_id": "L1", "process_id": "PROC_ALPHA"},
    )
    assert allowed_preview.status_code == 200, allowed_preview.text

    release_delete = await db_client.request(
        "DELETE",
        f"/api/projects/{locked_project['id']}/lock",
        json={"lock_token": headers["X-Lock-Token"]},
    )
    assert release_delete.status_code == 204, release_delete.text

    release_beacon = await db_client.post(
        f"/api/projects/{locked_project['id']}/lock/release",
        json={"lock_token": headers["X-Lock-Token"]},
    )
    assert release_beacon.status_code == 204, release_beacon.text
