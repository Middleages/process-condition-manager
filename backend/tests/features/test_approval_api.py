"""Approval API endpoint coverage for Phase 5 routes."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from typing import Any
from uuid import uuid4

import pytest
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import Permission, Role, UserContext, get_current_user
from app.features.approval.service import _fit_review_gate_details
from app.main import app
from app.models.choice import ChoiceOption, ChoiceSet
from app.models.project import (
    CellValue,
    ChangeEvent,
    ChangeEventType,
    LayerCondition,
    Project,
    ReviewComment,
    SheetLayer,
)
from tests.factories import seed_backbone_capture_parameters, seed_required_profile_choice_sets

CORE_PROFILE = {
    "device_type_code": "DEFAULT",
    "project_category_code": "DEFAULT",
}


def test_review_gate_payload_fitter_keeps_public_response_below_256_kib() -> None:
    details: dict[str, Any] = {
        "validation": {
            "summary": {"error_count": 200, "warning_count": 0},
            "issues": [
                {"key": f"issue-{index}", "details": {"equals": "가" * 1024}}
                for index in range(200)
            ],
            "evaluated_at": "2026-07-19T00:00:00+00:00",
            "basis_hash": "sha256:" + "f" * 64,
            "rule_versions": {f"rule_{index:04d}_" + "x" * 48: 1 for index in range(2000)},
            "truncated": False,
        },
        "missing_por_layers": [
            {"layer_key": "가" * 256, "layer_label": "나" * 128}
            for _ in range(200)
        ],
        "total_missing_por_count": 200,
    }
    _fit_review_gate_details(details)
    body = {
        "code": "review_gate_failed",
        "message": "Review 게이트 검증에 실패했습니다",
        "details": details,
        "request_id": "r" * 128,
    }
    assert len(json.dumps(body, ensure_ascii=False).encode("utf-8")) <= 256 * 1024


async def create_project(db_client: AsyncClient, part_id: str | None = None) -> dict:
    if part_id is None:
        part_id = f"APPR-{uuid4().hex[:8].upper()}"
    response = await db_client.post(
        "/api/projects",
        json={
            **CORE_PROFILE,
            "line_id": "L1",
            "process_id": "PROC_ALPHA",
            "part_id": part_id,
            "name": "approval flow",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _join_paths(*parts: str) -> str:
    pieces = [part.strip("/") for part in parts if part]
    if not pieces:
        return "/"
    return "/" + "/".join(pieces)


def _walk_routes(routes: Iterable[Any], prefix: str = "") -> Iterable[tuple[str, APIRoute]]:
    for route in routes:
        if isinstance(route, APIRoute):
            yield _join_paths(prefix, route.path), route
            continue
        if route.__class__.__name__ == "_IncludedRouter":
            yield from _walk_routes(
                route.original_router.routes, _join_paths(prefix, route.include_context.prefix)
            )
            continue
        if hasattr(route, "routes"):
            yield from _walk_routes(route.routes, prefix)


def _route_has_auth_dependency(route: APIRoute) -> bool:
    def _calls(dependent: Dependant) -> set[Callable[..., object]]:
        calls: set[Callable[..., object]] = set()
        if dependent.call is not None:
            calls.add(dependent.call)
        for child in dependent.dependencies:
            calls.update(_calls(child))
        return calls

    return get_current_user in _calls(route.dependant)


def _routes_by_method() -> dict[tuple[str, str], APIRoute]:
    route_map: dict[tuple[str, str], APIRoute] = {}
    for path, route in _walk_routes(app.router.routes):
        for method in route.methods or set():
            route_map[(method, path)] = route
    return route_map


_REQUIRED_APPROVAL_ENDPOINTS: set[tuple[str, str]] = {
    ("GET", "/api/projects/{project_id}/comments"),
    ("POST", "/api/projects/{project_id}/comments"),
    ("PATCH", "/api/projects/{project_id}/comments/{comment_id}"),
    ("DELETE", "/api/projects/{project_id}/comments/{comment_id}"),
    ("POST", "/api/projects/{project_id}/transitions"),
    ("POST", "/api/projects/{project_id}/revisions"),
}


@pytest.fixture(autouse=True)
async def _required_profile_choices(db_session: AsyncSession) -> None:
    await seed_required_profile_choice_sets(db_session)
    await db_session.commit()


@pytest.fixture(autouse=True)
async def _required_backbone_parameters(db_session: AsyncSession) -> None:
    await seed_backbone_capture_parameters(db_session)
    await db_session.commit()


@pytest.mark.parametrize("route_spec", sorted(_REQUIRED_APPROVAL_ENDPOINTS))
def test_approval_routes_are_registered(route_spec: tuple[str, str]) -> None:
    route_map = _routes_by_method()
    assert route_spec in route_map
    assert _route_has_auth_dependency(route_map[route_spec])


async def test_unknown_transition_action_has_stable_error_contract(
    db_client: AsyncClient,
) -> None:
    project = await create_project(db_client)
    response = await db_client.post(
        f"/api/projects/{project['id']}/transitions",
        json={"action": "archive", "expected_status": "draft"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "workflow_action_invalid"


async def test_comments_crud_flow(db_client: AsyncClient) -> None:
    project = await create_project(db_client)
    project_id = project["id"]

    list_resp = await db_client.get(f"/api/projects/{project_id}/comments")
    assert list_resp.status_code == 200, list_resp.text
    assert list_resp.json()["items"] == []

    created_resp = await db_client.post(
        f"/api/projects/{project_id}/comments",
        json={"body": "첫 번째 댓글"},
    )
    assert created_resp.status_code in (200, 201), created_resp.text
    comment = created_resp.json()
    comment_id = comment["id"]
    assert comment["body"] == "첫 번째 댓글"
    assert comment["deleted"] is False
    project_threads = await db_client.get(
        f"/api/projects/{project_id}/comments",
        params={"target": "project"},
    )
    assert [item["id"] for item in project_threads.json()["items"]] == [comment_id]

    resolved_resp = await db_client.patch(
        f"/api/projects/{project_id}/comments/{comment_id}",
        json={"resolved": True},
    )
    assert resolved_resp.status_code == 200, resolved_resp.text
    assert resolved_resp.json()["resolved"] is True

    resolved_list = await db_client.get(
        f"/api/projects/{project_id}/comments",
        params={"resolved": "true"},
    )
    assert resolved_list.status_code == 200, resolved_list.text
    assert len(resolved_list.json()["items"]) == 1

    delete_resp = await db_client.delete(f"/api/projects/{project_id}/comments/{comment_id}")
    assert delete_resp.status_code in (200, 204)
    after_delete = await db_client.get(f"/api/projects/{project_id}/comments")
    assert after_delete.json()["items"][0]["deleted"] is True
    assert after_delete.json()["items"][0]["body"] is None
    deleted_patch = await db_client.patch(
        f"/api/projects/{project_id}/comments/{comment_id}",
        json={"resolved": False},
    )
    assert deleted_patch.status_code == 409
    assert deleted_patch.json()["code"] == "comment_deleted"


async def test_non_author_non_admin_comment_delete_is_forbidden(db_client: AsyncClient) -> None:
    project = await create_project(db_client)
    created = await db_client.post(
        f"/api/projects/{project['id']}/comments", json={"body": "author only"}
    )
    assert created.status_code == 201

    async def other_editor() -> UserContext:
        return UserContext(
            id="other-editor",
            roles=(Role.EDITOR,),
            permissions=(Permission.BUSINESS_READ, Permission.PROJECT_COMMENT),
        )

    app.dependency_overrides[get_current_user] = other_editor
    try:
        denied = await db_client.delete(
            f"/api/projects/{project['id']}/comments/{created.json()['id']}"
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert denied.status_code == 403
    assert denied.json()["code"] == "permission_denied"


async def test_comment_page_is_byte_bounded_and_remains_cursor_reachable(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project = await create_project(db_client)
    db_session.add_all(
        ReviewComment(
            project_id=project["id"],
            body="가" * 4000,
            author="bulk-author",
            resolved=False,
            deleted=False,
        )
        for _ in range(100)
    )
    await db_session.commit()

    response = await db_client.get(
        f"/api/projects/{project['id']}/comments", params={"limit": 100}
    )
    assert response.status_code == 200
    assert len(response.content) <= 256 * 1024
    assert 0 < len(response.json()["items"]) < 100
    assert response.json()["next_cursor"] == response.json()["items"][-1]["id"]


async def test_transitions_and_revisions_endpoints_return_non_404(db_client: AsyncClient) -> None:
    project = await create_project(db_client)
    project_id = project["id"]

    transition_resp = await db_client.post(
        f"/api/projects/{project_id}/transitions",
        json={"action": "request_review", "expected_status": "draft"},
    )
    assert transition_resp.status_code in (200, 409)

    revision_resp = await db_client.post(f"/api/projects/{project_id}/revisions")
    assert revision_resp.status_code in (200, 201, 409)


async def test_review_and_approval_use_canonical_basis_and_freeze_snapshot(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    project_payload = await create_project(db_client)
    project_id = project_payload["id"]
    project = (
        await db_session.execute(
            select(Project)
            .where(Project.id == project_id)
            .options(
                selectinload(Project.layers)
                .selectinload(SheetLayer.conditions)
                .selectinload(LayerCondition.cell_values)
            )
        )
    ).scalar_one()
    for layer in project.layers:
        if layer.conditions:
            layer.conditions[0].is_por = True
        else:
            condition = LayerCondition(
                layer_id=layer.id,
                label="POR",
                condition_index=0,
                is_por=True,
            )
            db_session.add(condition)
            layer.conditions.append(condition)
        for condition in layer.conditions:
            if not any(cell.parameter_code == "spin_speed" for cell in condition.cell_values):
                condition.cell_values.append(
                    CellValue(parameter_code="spin_speed", value_text="1200")
                )
    await db_session.commit()

    review = await db_client.post(
        f"/api/projects/{project_id}/transitions",
        json={"action": "request_review", "expected_status": "draft"},
    )
    assert review.status_code == 200, review.text
    review_body = review.json()
    assert review_body["status"] == "review"
    assert review_body["basis_hash"].startswith("sha256:")
    assert review_body["rule_versions"] == {}

    # A Profile presentation mutation is part of the complete DefinitionView
    # digest even though it does not alter executable validation semantics.
    option = (
        await db_session.execute(
            select(ChoiceOption)
            .join(ChoiceSet, ChoiceOption.choice_set_id == ChoiceSet.id)
            .where(ChoiceSet.code == "device_type", ChoiceOption.code == "DEFAULT")
        )
    ).scalar_one()
    option.label = "Changed after Review"
    await db_session.commit()

    approved = await db_client.post(
        f"/api/projects/{project_id}/transitions",
        json={"action": "approve", "expected_status": "review"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert approved.json()["revalidated"] is True
    assert approved.json()["basis_hash"] != review_body["basis_hash"]

    db_session.expire_all()
    persisted = await db_session.get(Project, project_id)
    assert persisted is not None
    assert persisted.parameter_snapshot is not None
    assert persisted.parameter_snapshot["version"] == 3
    assert (
        persisted.parameter_snapshot["validation_basis_hash"]
        == approved.json()["basis_hash"]
    )

    events = list(
        (
            await db_session.execute(
                select(ChangeEvent)
                .where(
                    ChangeEvent.project_id == project_id,
                    ChangeEvent.event_type == ChangeEventType.STATUS_CHANGE,
                )
                .order_by(ChangeEvent.id)
            )
        )
        .scalars()
        .all()
    )
    assert [event.payload["action"] for event in events] == ["request_review", "approve"]
    assert events[-1].payload == {
        "schema_version": 1,
        "operation_id": approved.json()["operation_id"],
        "action": "approve",
        "from_status": "review",
        "to_status": "approved",
        "basis_hash": approved.json()["basis_hash"],
        "rule_versions": {},
        "revalidated": True,
    }

    invalid = await db_client.post(
        f"/api/projects/{project_id}/transitions",
        json={"action": "request_review", "expected_status": "approved"},
    )
    assert invalid.status_code == 409
    assert invalid.json()["code"] == "workflow_transition_invalid"

    revision = await db_client.post(f"/api/projects/{project_id}/revisions")
    assert revision.status_code == 200, revision.text
    revision_body = revision.json()
    assert revision_body["source"] == {
        "id": project_id,
        "status": "archived",
        "version": 1,
    }
    target = revision_body["revision"]
    assert target["status"] == "draft"
    assert target["version"] == 2
    assert target["predecessor_project_id"] == project_id
    assert target["profile"]["device_type"]["code"] == "DEFAULT"
    assert len(target["layers"]) == len(project.layers)

    duplicate = await db_client.post(
        "/api/projects",
        json={
            **CORE_PROFILE,
            "line_id": project_payload["line_id"],
            "process_id": project_payload["process_id"],
            "part_id": project_payload["part_id"],
            "name": "must not fork lineage",
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["details"]["existing_project_id"] == target["id"]

    db_session.expire_all()
    revision_events = list(
        (
            await db_session.execute(
                select(ChangeEvent)
                .where(ChangeEvent.event_type == ChangeEventType.REVISION_CREATE)
                .order_by(ChangeEvent.project_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(revision_events) == 2
    expected_common = {
        "schema_version": 1,
        "operation_id": revision_body["operation_id"],
        "source_project_id": project_id,
        "target_project_id": target["id"],
        "source_version": 1,
        "target_version": 2,
    }
    assert {event.payload["event_role"] for event in revision_events} == {
        "source",
        "target",
    }
    for event in revision_events:
        assert event.payload == {
            **expected_common,
            "event_role": event.payload["event_role"],
        }
