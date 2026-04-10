from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.config import settings
from app.models import Line, User
from app.models.step_master import StepCurrent
from app.services.auth_service import create_access_token


@pytest.mark.asyncio
async def test_process_condition_e2e_create_and_edit_entry_flow(
    client: AsyncClient,
    db_session,
) -> None:
    """E2E(API): line -> process -> part -> create -> detail 진입 플로우."""
    line = Line(line_code="L-E2E", line_name="E2E Line")
    user = User(userid="e2e_editor", roles=["editor"], password_hash="", email="e2e_editor@test.local")
    db_session.add_all([line, user])
    await db_session.flush()

    db_session.add_all(
        [
            StepCurrent(
                line_id=line.id,
                process_id="CMP",
                part_id="PART-E2E",
                layer_id="1.0",
                step_seq="ts100000",
                step_name="CMP-STEP-1",
                descript="Layer 1",
                source_updated_at=None,
                raw_payload={},
            ),
            StepCurrent(
                line_id=line.id,
                process_id="CMP",
                part_id="PART-E2E",
                layer_id="2.0",
                step_seq="ts200000",
                step_name="CMP-STEP-2",
                descript="Layer 2",
                source_updated_at=None,
                raw_payload={},
            ),
        ]
    )
    await db_session.commit()

    token = create_access_token({"sub": str(user.id), "username": user.userid, "roles": user.roles})
    client.cookies.set("app_token", token)

    # 1) 라인 선택 후 process 옵션 조회
    resp_processes = await client.get(
        f"/api/device-masters/step-current/processes?line_id={line.id}",
    )
    assert resp_processes.status_code == 200
    process_ids = resp_processes.json()["process_ids"]
    assert "CMP" in process_ids

    # 2) process 선택 후 part 옵션 조회
    resp_parts = await client.get(
        f"/api/device-masters/step-current/parts?line_id={line.id}&process_id=CMP",
    )
    assert resp_parts.status_code == 200
    part_ids = resp_parts.json()["part_ids"]
    assert "PART-E2E" in part_ids

    # 3) part 선택 후 layers 조회
    resp_layers = await client.get(
        f"/api/device-masters/step-current/layers?line_id={line.id}&process_id=CMP&part_id=PART-E2E",
    )
    assert resp_layers.status_code == 200
    layers = resp_layers.json()["layers"]
    assert len(layers) == 2

    prev_flag = settings.STEP_CURRENT_ENFORCE_FRESHNESS
    settings.STEP_CURRENT_ENFORCE_FRESHNESS = False
    try:
        # 4) 생성(create)
        create_resp = await client.post(
            "/api/process-conditions/v2",
            json={
                "line_id": line.id,
                "process": "CMP",
                "part_id": "PART-E2E",
                "device_type": "full",
                "selected_layer_refs": [],
                "backbone_condition_id": None,
            },
        )
        assert create_resp.status_code == 201
        created = create_resp.json()
        project_id = created["id"]

        # 5) 편집 진입에 해당하는 detail 조회
        detail_resp = await client.get(f"/api/process-conditions/{project_id}")
        assert detail_resp.status_code == 200
        detail = detail_resp.json()
        assert detail["id"] == project_id
        assert detail["process"] == "CMP"
        assert detail["part_id"] == "PART-E2E"
        assert len(detail["layers"]) == 2
    finally:
        settings.STEP_CURRENT_ENFORCE_FRESHNESS = prev_flag
