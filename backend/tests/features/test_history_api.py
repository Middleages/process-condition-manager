from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.history.cursor import HistoryDetailScope, encode_history_detail_scope
from app.models.project import ChangeEvent, ChangeEventType, Project, ProjectProfile


async def _seed_history_project(session: AsyncSession) -> int:
    project = Project(
        line_id="L1",
        process_id="PROC_HISTORY",
        part_id="PART-001",
        name="History project",
    )
    project.profile = ProjectProfile(
        process_name="History project",
        device_type_code="DEFAULT",
        project_category_code="DEFAULT",
    )
    session.add(project)
    await session.flush()

    session.add_all(
        [
            ChangeEvent(
                project_id=project.id,
                event_type=ChangeEventType.PROJECT_CREATE,
                actor="dev-admin",
                payload={},
                created_at=datetime(2026, 7, 1, 0, 0, tzinfo=UTC),
            ),
            ChangeEvent(
                project_id=project.id,
                event_type=ChangeEventType.CELL_UPDATE,
                actor="dev-admin",
                batch_id="batch-1",
                origin="manual",
                layer_key="L1",
                condition_id=1,
                parameter_code="P1",
                old_value="OLD",
                new_value="NEW",
                created_at=datetime(2026, 7, 1, 0, 1, tzinfo=UTC),
            ),
        ]
    )
    await session.commit()
    return project.id


@pytest.mark.asyncio
async def test_history_events_route_is_authenticated_and_payload_free(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _seed_history_project(db_session)

    response = await db_client.get(f"/api/projects/{project_id}/events")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["next_cursor"] is None
    assert body["coverage"] == {
        "legacy_unresolved_layer_count": 0,
        "legacy_detail_unavailable_count": 0,
    }
    assert body["items"]
    first_item = body["items"][0]
    assert first_item["kind"] == "batch"
    assert first_item["batch_id"] == "batch-1"
    assert first_item["matched_event_count"] == 1
    assert first_item["total_event_count"] == 1
    assert first_item["detail_status"] == "available"
    assert "raw_payload" not in first_item
    assert "full_capture" not in first_item


@pytest.mark.asyncio
async def test_history_events_limit_above_max_is_rejected(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _seed_history_project(db_session)

    response = await db_client.get(f"/api/projects/{project_id}/events", params={"limit": 101})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_history_event_batch_scope_mismatch_is_rejected(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _seed_history_project(db_session)
    scope = encode_history_detail_scope(
        HistoryDetailScope(project_id=project_id, batch_id="batch-other")
    )

    response = await db_client.get(
        f"/api/projects/{project_id}/event-batches/batch-1",
        params={"scope": scope},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_scope"


@pytest.mark.asyncio
async def test_history_cell_history_missing_target_returns_404(db_client: AsyncClient) -> None:
    response = await db_client.get(
        "/api/projects/999999/cell-history",
        params={"condition_id": 1, "parameter_code": "P1"},
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
