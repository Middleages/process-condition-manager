"""프로젝트 생성/백본 API 테스트."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import Permission, UserContext, get_current_user
from app.domain.parameters.snapshot import snapshot_digest
from app.main import app
from app.models.project import (
    CellValue,
    ChangeEvent,
    ChangeEventType,
    LayerCondition,
    Project,
    ProjectProfile,
    ProjectStatus,
    SheetLayer,
)
from tests.factories import (
    seed_backbone_capture_parameters,
    seed_required_profile_choice_sets,
)

_CORE_PROFILE = {
    "device_type_code": "DEFAULT",
    "project_category_code": "DEFAULT",
}


def _frozen_profile_snapshot() -> dict[str, object]:
    result: dict[str, object] = {
        "version": 3,
        "categories": [],
        "parameters": [],
        "choice_sets": [
            {
                "code": code,
                "display_name": code,
                "version": 1,
                "is_active": True,
                "options": [
                    {"code": "DEFAULT", "label": "Default", "sort_order": 0, "is_active": True}
                ],
            }
            for code in ("active_direction", "device_type", "gate_direction", "project_category")
        ],
        "validation_rules": [],
    }
    result["validation_basis_hash"] = snapshot_digest(result)
    return result


@pytest.fixture(autouse=True)
async def _required_profile_choices(db_session: AsyncSession) -> None:
    await seed_required_profile_choice_sets(db_session)
    await db_session.commit()


@pytest.fixture(autouse=True)
async def _required_backbone_parameters(db_session: AsyncSession) -> None:
    await seed_backbone_capture_parameters(db_session)
    await db_session.commit()


@asynccontextmanager
async def _as_user(permissions: tuple[Permission, ...]) -> AsyncIterator[None]:
    async def _current_user() -> UserContext:
        return UserContext(
            id="test-user",
            permissions=(Permission.BUSINESS_READ, *permissions),
        )

    app.dependency_overrides[get_current_user] = _current_user
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def _lock_headers(client: AsyncClient, project_id: int) -> dict[str, str]:
    """편집 잠금을 획득해 backbone-replace(잠금 검사 소급 적용)용 토큰 헤더를 만든다."""
    resp = await client.post(f"/api/projects/{project_id}/lock")
    assert resp.status_code == 200, resp.text
    return {"X-Lock-Token": resp.json()["lock_token"]}


async def _seed_backbone_cells(
    session: AsyncSession, project_id: int, layer_key: str, cells: dict[str, str]
) -> None:
    """백본 프로젝트의 특정 layer 조건 행에 셀 값을 직접 심는다 (Phase 1엔 편집 API 없음)."""
    result = await session.execute(
        select(SheetLayer).where(
            SheetLayer.project_id == project_id, SheetLayer.layer_key == layer_key
        )
    )
    layer = result.scalar_one()
    condition = (
        await session.execute(select(LayerCondition).where(LayerCondition.layer_id == layer.id))
    ).scalar_one()
    for code, value in cells.items():
        session.add(CellValue(condition_id=condition.id, parameter_code=code, value_text=value))
    await session.commit()


async def test_create_project_from_process_structure(db_client: AsyncClient) -> None:
    resp = await db_client.post(
        "/api/projects",
        json={
            **_CORE_PROFILE,
            "line_id": "L1",
            "process_id": "PROC_ALPHA",
            "part_id": "PART-001",
            "name": "Alpha 조건표",
        },
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "draft"
    assert body["version"] == 1
    assert body["revision_root_id"] == body["id"]
    assert body["predecessor_project_id"] is None
    assert body["successor_project_id"] is None
    assert body["allowed_actions"] == ["request_review"]
    assert body["line_id"] == "L1"
    assert body["process_id"] == "PROC_ALPHA"
    assert body["part_id"] == "PART-001"
    assert [(layer["step_seq"], layer["layer_id"]) for layer in body["layers"]] == [
        ("001", "CLN"),
        ("010", "ACT"),
        ("020", "ACT"),
    ]
    assert [layer["condition_count"] for layer in body["layers"]] == [1, 1, 1]


async def test_duplicate_project_identity_rejected(db_client: AsyncClient) -> None:
    payload = {
        **_CORE_PROFILE,
        "line_id": "L1",
        "process_id": "PROC_ALPHA",
        "part_id": "PART-001",
        "name": "Alpha 조건표",
    }
    assert (await db_client.post("/api/projects", json=payload)).status_code == 201

    dup = await db_client.post("/api/projects", json=payload)

    assert dup.status_code == 409
    assert dup.json()["code"] == "conflict"


async def test_preview_without_backbone_returns_unmatched_layers(db_client: AsyncClient) -> None:
    resp = await db_client.post(
        "/api/projects/backbone-preview",
        json={"line_id": "L1", "process_id": "PROC_BETA"},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["matched_count"] == 0
    assert body["unmatched_count"] == 2
    assert [match["match_type"] for match in body["matches"]] == [
        "unmatched",
        "unmatched",
    ]


async def test_preview_with_backbone_reports_match_and_copy_counts(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    backbone = (
        await db_client.post(
            "/api/projects",
            json={
                **_CORE_PROFILE,
                "line_id": "L1",
                "process_id": "PROC_ALPHA",
                "part_id": "SRC",
                "name": "B",
            },
        )
    ).json()
    await _seed_backbone_cells(
        db_session, backbone["id"], backbone["layers"][0]["layer_key"], {"spin_speed": "900"}
    )

    resp = await db_client.post(
        "/api/projects/backbone-preview",
        json={
            "line_id": "L1",
            "process_id": "PROC_BETA",
            "backbone_project_id": backbone["id"],
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["matched_count"] == 1  # 001/CLN 자동 매칭
    assert body["unmatched_count"] == 1  # 015/WELL 미매칭
    assert body["copy_cell_count"] == 1
    types = {m["match_type"] for m in body["matches"]}
    assert types == {"auto", "unmatched"}


async def test_backbone_candidates_ranked_by_match_rate(db_client: AsyncClient) -> None:
    # 백본 후보: PROC_ALPHA(001/CLN 공통) 하나. 대상 PROC_BETA 기준 매칭률 계산.
    alpha = (
        await db_client.post(
            "/api/projects",
            json={
                **_CORE_PROFILE,
                "line_id": "L1",
                "process_id": "PROC_ALPHA",
                "part_id": "A",
                "name": "Alpha",
            },
        )
    ).json()

    resp = await db_client.get(
        "/api/projects/backbone-candidates",
        params={"line_id": "L1", "process_id": "PROC_BETA"},
    )

    assert resp.status_code == 200, resp.text
    candidates = resp.json()
    assert len(candidates) == 1
    assert candidates[0]["id"] == alpha["id"]
    # PROC_BETA layer 2개 중 001/CLN 하나만 매칭 → 0.5
    assert candidates[0]["matched_count"] == 1
    assert candidates[0]["unmatched_count"] == 1
    assert candidates[0]["match_rate"] == 0.5


async def test_list_and_get_project(db_client: AsyncClient) -> None:
    created = (
        await db_client.post(
            "/api/projects",
            json={
                **_CORE_PROFILE,
                "line_id": "L1",
                "process_id": "PROC_BETA",
                "part_id": "PART-002",
                "name": "Beta 조건표",
            },
        )
    ).json()

    listed = await db_client.get("/api/projects")
    assert listed.status_code == 200
    body = listed.json()
    assert [project["id"] for project in body["items"]] == [created["id"]]
    assert body["items"][0]["revision_root_id"] == created["id"]
    assert body["items"][0]["predecessor_project_id"] is None
    assert body["items"][0]["successor_project_id"] is None
    assert body["items"][0]["allowed_actions"] == ["request_review"]
    assert body["items"][0]["version"] == 1
    assert body["items"][0]["layer_count"] == 2
    assert body["next_cursor"] is None

    fetched = await db_client.get(f"/api/projects/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "Beta 조건표"
    assert fetched.json()["version"] == 1
    assert fetched.json()["revision_root_id"] == created["id"]
    assert fetched.json()["predecessor_project_id"] is None
    assert fetched.json()["successor_project_id"] is None
    assert fetched.json()["allowed_actions"] == ["request_review"]


async def test_project_out_allowed_actions_respects_permissions(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    create_resp = await db_client.post(
        "/api/projects",
        json={
            **_CORE_PROFILE,
            "line_id": "L1",
            "process_id": "PROC_ALPHA",
            "part_id": "PART-ALLOWED",
            "name": "Permissioned project",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()
    # update status directly in DB for permission matrix checks
    project = await db_session.get(Project, created["id"])
    assert project is not None
    project.status = ProjectStatus.REVIEW
    await db_session.commit()

    async with _as_user((Permission.PROJECT_REVIEW_REQUEST,)):
        listed = (await db_client.get("/api/projects")).json()
        assert listed["items"][0]["allowed_actions"] == []
        fetched = (await db_client.get(f"/api/projects/{created['id']}")).json()
        assert fetched["allowed_actions"] == []

    async with _as_user((Permission.PROJECT_REVIEW_DECIDE,)):
        listed = (await db_client.get("/api/projects")).json()
        assert listed["items"][0]["allowed_actions"] == ["approve", "reject"]
        fetched = (await db_client.get(f"/api/projects/{created['id']}")).json()
        assert fetched["allowed_actions"] == ["approve", "reject"]

    project.status = ProjectStatus.ARCHIVED
    project.parameter_snapshot = _frozen_profile_snapshot()
    await db_session.commit()

    async with _as_user((Permission.PROJECT_REVIEW_DECIDE, Permission.PROJECT_REVIEW_REQUEST)):
        fetched = (await db_client.get(f"/api/projects/{created['id']}")).json()
        assert fetched["allowed_actions"] == []


async def test_project_summary_includes_successor_project_id(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    base_resp = await db_client.post(
        "/api/projects",
        json={
            **_CORE_PROFILE,
            "line_id": "L1",
            "process_id": "PROC_ALPHA",
            "part_id": "BASE",
            "name": "Base",
        },
    )
    assert base_resp.status_code == 201, base_resp.text
    base = base_resp.json()
    base_row = await db_session.get(Project, base["id"])
    assert base_row is not None
    base_row.status = ProjectStatus.APPROVED
    base_row.parameter_snapshot = _frozen_profile_snapshot()
    base_row.revision_root_id = base_row.id
    await db_session.flush()

    successor = Project(
        line_id="L2",
        process_id="PROC_ALPHA",
        part_id="SUCC",
        name="Revision",
        status=ProjectStatus.ARCHIVED,
        version=2,
        revision_root_id=base_row.revision_root_id,
        revision_of_id=base_row.id,
        parameter_snapshot=_frozen_profile_snapshot(),
        profile=ProjectProfile(
            process_name="PROC_ALPHA",
            device_type_code="DEFAULT",
            project_category_code="DEFAULT",
        ),
    )
    db_session.add(successor)
    await db_session.commit()

    listed = (await db_client.get("/api/projects")).json()
    summary = next(item for item in listed["items"] if item["id"] == base["id"])
    assert summary["successor_project_id"] == successor.id
    assert summary["predecessor_project_id"] is None
    assert summary["revision_root_id"] == base["id"]


async def test_list_projects_search_and_cursor_paging(db_client: AsyncClient) -> None:
    for part in ("AAA", "BBB", "CCC"):
        await db_client.post(
            "/api/projects",
            json={
                **_CORE_PROFILE,
                "line_id": "L1",
                "process_id": "PROC_ALPHA",
                "part_id": part,
                "name": f"proj-{part}",
            },
        )

    # 검색: part_id 부분 일치
    searched = await db_client.get("/api/projects", params={"query": "BBB"})
    assert [p["part_id"] for p in searched.json()["items"]] == ["BBB"]

    # 커서 페이징: 최신순 2개 + next_cursor
    page1 = (await db_client.get("/api/projects", params={"limit": 2})).json()
    assert len(page1["items"]) == 2
    assert page1["next_cursor"] is not None

    page2 = (
        await db_client.get("/api/projects", params={"limit": 2, "cursor": page1["next_cursor"]})
    ).json()
    assert len(page2["items"]) == 1
    assert page2["next_cursor"] is None
    ids_all = [p["id"] for p in page1["items"]] + [p["id"] for p in page2["items"]]
    assert len(set(ids_all)) == 3


async def test_replace_layer_backbone_uses_source_layer_conditions(db_client: AsyncClient) -> None:
    source = (
        await db_client.post(
            "/api/projects",
            json={
                **_CORE_PROFILE,
                "line_id": "L1",
                "process_id": "PROC_ALPHA",
                "part_id": "SRC",
                "name": "Source",
            },
        )
    ).json()
    target = (
        await db_client.post(
            "/api/projects",
            json={
                **_CORE_PROFILE,
                "line_id": "L1",
                "process_id": "PROC_BETA",
                "part_id": "TGT",
                "name": "Target",
            },
        )
    ).json()

    resp = await db_client.post(
        f"/api/projects/{target['id']}/layers/{target['layers'][1]['layer_key']}/backbone-replace",
        json={
            "source_project_id": source["id"],
            "source_layer_key": source["layers"][0]["layer_key"],
        },
        headers=await _lock_headers(db_client, target["id"]),
    )

    assert resp.status_code == 200, resp.text
    replaced = resp.json()["layers"][1]
    assert replaced["source_project_id"] == source["id"]
    assert replaced["source_layer_key"] == source["layers"][0]["layer_key"]
    assert replaced["condition_count"] == source["layers"][0]["condition_count"]


async def test_backbone_copy_duplicates_conditions_and_cells(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    backbone = (
        await db_client.post(
            "/api/projects",
            json={
                **_CORE_PROFILE,
                "line_id": "L1",
                "process_id": "PROC_ALPHA",
                "part_id": "SRC",
                "name": "Backbone",
            },
        )
    ).json()
    clean_layer_key = backbone["layers"][0]["layer_key"]  # 001/CLN
    await _seed_backbone_cells(
        db_session, backbone["id"], clean_layer_key, {"spin_speed": "1200", "pr_type": "A"}
    )

    created = await db_client.post(
        "/api/projects",
        json={
            **_CORE_PROFILE,
            "line_id": "L1",
            "process_id": "PROC_BETA",
            "part_id": "TGT",
            "name": "Target",
            "backbone_project_id": backbone["id"],
        },
    )

    assert created.status_code == 201, created.text
    layers = {(layer["step_seq"], layer["layer_id"]): layer for layer in created.json()["layers"]}
    # 001/CLN은 백본과 자동 매칭 → 셀 2개 복사
    assert layers[("001", "CLN")]["cell_count"] == 2
    assert layers[("001", "CLN")]["source_project_id"] == backbone["id"]
    # 015/WELL은 미매칭 → 기본 조건 1행 + 빈 값
    assert layers[("015", "WELL")]["condition_count"] == 1
    assert layers[("015", "WELL")]["cell_count"] == 0


async def test_backbone_copy_records_event_with_counts(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    backbone = (
        await db_client.post(
            "/api/projects",
            json={
                **_CORE_PROFILE,
                "line_id": "L1",
                "process_id": "PROC_ALPHA",
                "part_id": "SRC",
                "name": "B",
            },
        )
    ).json()
    await _seed_backbone_cells(
        db_session,
        backbone["id"],
        backbone["layers"][0]["layer_key"],
        {"spin_speed": "1200", "pr_type": "A"},
    )
    target = await db_client.post(
        "/api/projects",
        json={
            **_CORE_PROFILE,
            "line_id": "L1",
            "process_id": "PROC_BETA",
            "part_id": "TGT",
            "name": "T",
            "backbone_project_id": backbone["id"],
        },
    )
    target_body = target.json()
    target_id = target_body["id"]
    db_session.expire_all()

    create_event = (
        await db_session.execute(
            select(ChangeEvent).where(
                ChangeEvent.project_id == target_id,
                ChangeEvent.event_type == ChangeEventType.PROJECT_CREATE,
            )
        )
    ).scalar_one()
    event = (
        await db_session.execute(
            select(ChangeEvent).where(
                ChangeEvent.project_id == target_id,
                ChangeEvent.event_type == ChangeEventType.BACKBONE_COPY,
            )
        )
    ).scalar_one()
    assert create_event.origin == "system"
    assert create_event.source_project_id == backbone["id"]
    assert create_event.layer_key is None
    assert create_event.batch_id is not None
    assert event.event_type == ChangeEventType.BACKBONE_COPY
    assert event.origin == "backbone"
    assert event.batch_id == create_event.batch_id
    assert event.source_project_id == backbone["id"]
    assert event.layer_key == target_body["layers"][0]["layer_key"]
    assert event.payload["captured_at"].endswith("Z")
    assert event.payload["target_layer_key"] == target_body["layers"][0]["layer_key"]
    assert event.payload["source_layer_key"] == backbone["layers"][0]["layer_key"]
    assert event.payload["auto_count"] == 1
    assert event.payload["unmatched_count"] == 1
    assert "batch_id" in event.payload
    assert event.payload["payload_schema_version"] == 2
    assert event.payload["capture"]["source"]["project_id"] == backbone["id"]
    assert event.payload["detail"] == [
        {
            "target_condition_id": event.payload["detail"][0]["target_condition_id"],
            "source_condition_id": event.payload["detail"][0]["source_condition_id"],
            "label": "base",
            "condition_index": 1,
            "is_por": False,
            "cell_count": 2,
        }
    ]

    target_layer = (
        await db_session.execute(
            select(SheetLayer)
            .options(selectinload(SheetLayer.conditions))
            .where(
                SheetLayer.project_id == target_id,
                SheetLayer.layer_key == target_body["layers"][0]["layer_key"],
            )
        )
    ).scalar_one()
    assert target_layer.backbone_snapshot is not None
    assert target_layer.backbone_snapshot["source"]["project_id"] == backbone["id"]
    assert (
        target_layer.backbone_snapshot["source"]["layer_key"]
        == (backbone["layers"][0]["layer_key"])
    )
    assert target_layer.backbone_snapshot["capture_batch_id"] == event.payload["batch_id"]
    assert target_layer.backbone_snapshot["captured_at"] == event.payload["captured_at"]


async def test_backbone_copy_emits_one_event_per_matched_layer(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    source = (
        await db_client.post(
            "/api/projects",
            json={
                **_CORE_PROFILE,
                "line_id": "L1",
                "process_id": "PROC_ALPHA",
                "part_id": "SRC-MULTI",
                "name": "Source multi",
            },
        )
    ).json()

    target = await db_client.post(
        "/api/projects",
        json={
            **_CORE_PROFILE,
            "line_id": "L1",
            "process_id": "PROC_ALPHA",
            "part_id": "TGT-MULTI",
            "name": "Target multi",
            "backbone_project_id": source["id"],
        },
    )
    assert target.status_code == 201, target.text
    target_body = target.json()
    db_session.expire_all()

    events = list(
        (
            await db_session.execute(
                select(ChangeEvent)
                .where(
                    ChangeEvent.project_id == target.json()["id"],
                    ChangeEvent.event_type == ChangeEventType.BACKBONE_COPY,
                )
                .order_by(ChangeEvent.id)
            )
        ).scalars()
    )
    assert len(events) == 3
    assert {event.payload["batch_id"] for event in events} == {events[0].payload["batch_id"]}
    assert {event.payload["captured_at"] for event in events} == {events[0].payload["captured_at"]}
    assert [event.payload["target_layer_key"] for event in events] == [
        layer["layer_key"] for layer in target_body["layers"]
    ]
    assert all(len(event.payload["detail"]) == 1 for event in events)
    assert {event.origin for event in events} == {"backbone"}
    assert {event.source_project_id for event in events} == {source["id"]}
    assert {event.batch_id for event in events} == {events[0].batch_id}


async def test_create_without_backbone_records_project_create_event(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    created = (
        await db_client.post(
            "/api/projects",
            json={
                **_CORE_PROFILE,
                "line_id": "L1",
                "process_id": "PROC_ALPHA",
                "part_id": "P",
                "name": "N",
            },
        )
    ).json()

    event = (
        await db_session.execute(select(ChangeEvent).where(ChangeEvent.project_id == created["id"]))
    ).scalar_one()
    assert event.event_type == ChangeEventType.PROJECT_CREATE
    assert event.origin == "system"
    assert event.batch_id is not None
    assert event.payload["backbone_project_id"] is None
    assert event.source_project_id is None
    assert event.source_layer_key is None
    assert event.layer_key is None


async def test_invalid_manual_override_is_rejected(db_client: AsyncClient) -> None:
    backbone = (
        await db_client.post(
            "/api/projects",
            json={
                **_CORE_PROFILE,
                "line_id": "L1",
                "process_id": "PROC_ALPHA",
                "part_id": "SRC",
                "name": "B",
            },
        )
    ).json()

    resp = await db_client.post(
        "/api/projects",
        json={
            **_CORE_PROFILE,
            "line_id": "L1",
            "process_id": "PROC_BETA",
            "part_id": "TGT",
            "name": "T",
            "backbone_project_id": backbone["id"],
            "manual_overrides": [
                {
                    "target_layer_key": "L1::PROC_BETA::015::WELL",
                    "source_layer_key": "does-not-exist",
                }
            ],
        },
    )

    assert resp.status_code == 422, resp.text


async def test_self_layer_replace_is_rejected(db_client: AsyncClient) -> None:
    project = (
        await db_client.post(
            "/api/projects",
            json={
                **_CORE_PROFILE,
                "line_id": "L1",
                "process_id": "PROC_ALPHA",
                "part_id": "P",
                "name": "N",
            },
        )
    ).json()
    layer_key = project["layers"][0]["layer_key"]

    # 잠금을 보유한 상태여도 자기 자신 교체는 도메인 규칙 위반(422)으로 막힌다
    # (잠금 검사는 통과하고 그 다음 서비스 검증에서 걸린다).
    resp = await db_client.post(
        f"/api/projects/{project['id']}/layers/{layer_key}/backbone-replace",
        json={"source_project_id": project["id"], "source_layer_key": layer_key},
        headers=await _lock_headers(db_client, project["id"]),
    )

    assert resp.status_code == 422, resp.text


async def test_duplicate_conflict_carries_existing_project(db_client: AsyncClient) -> None:
    payload = {
        **_CORE_PROFILE,
        "line_id": "L1",
        "process_id": "PROC_ALPHA",
        "part_id": "P",
        "name": "N",
    }
    first = (await db_client.post("/api/projects", json=payload)).json()

    dup = await db_client.post("/api/projects", json=payload)

    assert dup.status_code == 409
    assert dup.json()["details"]["existing_project_id"] == first["id"]
    assert dup.json()["details"]["existing_status"] == "draft"
