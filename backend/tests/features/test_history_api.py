from __future__ import annotations

import logging
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import Request
from httpx import AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.auth import get_current_user
from app.core.errors import AppError
from app.domain.backbone.snapshot import (
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
    serialize_backbone_snapshot,
)
from app.domain.parameters.types import ValueType
from app.features.history.cursor import (
    HistoryCaptureKey,
    HistoryDetailCursor,
    HistoryDetailScope,
    HistoryMemberFilterScope,
    decode_history_detail_scope,
    encode_history_detail_cursor,
    encode_history_detail_scope,
)
from app.features.history.projection import HistoryEventRow
from app.features.history.repository import (
    HistoryBatchDescriptor,
    HistoryCellCoordinateKey,
    HistoryCellCoordinateProof,
    HistoryRepository,
)
from app.main import app
from app.models.parameter import Parameter
from app.models.project import (
    CellValue,
    ChangeEvent,
    ChangeEventType,
    LayerCondition,
    Project,
    ProjectProfile,
    SheetLayer,
)


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
                payload={"private_value": "SECRET_RAW_VALUE"},
                created_at=datetime(2026, 7, 1, 0, 1, tzinfo=UTC),
            ),
        ]
    )
    await session.commit()
    return project.id


def _scope(
    project_id: int,
    batch_id: str,
    *,
    member_filters: HistoryMemberFilterScope | None = None,
) -> str:
    return encode_history_detail_scope(
        HistoryDetailScope(
            project_id=project_id,
            batch_id=batch_id,
            member_filters=member_filters or HistoryMemberFilterScope(),
        )
    )


def _capture_snapshot() -> dict[str, Any]:
    return serialize_backbone_snapshot(
        BackboneSnapshot(
            capture_batch_id="0123456789abcdef0123456789abcdef",
            captured_at=datetime(2026, 7, 1, 0, 2, tzinfo=UTC),
            source=BackboneSnapshotSource(
                project_id=99,
                sheet_layer_id=100,
                layer_key="SOURCE-L1",
                step_seq="010",
                layer_id="ACT",
            ),
            columns=(
                BackboneSnapshotColumn(
                    parameter_code="alpha",
                    value_type=ValueType.TEXT,
                    display_name="Alpha",
                    category_code=None,
                    sort_order=0,
                    active_at_capture=True,
                ),
                BackboneSnapshotColumn(
                    parameter_code="beta",
                    value_type=ValueType.TEXT,
                    display_name="Beta",
                    category_code=None,
                    sort_order=1,
                    active_at_capture=True,
                ),
            ),
            conditions=(
                BackboneSnapshotCondition(
                    source_condition_id=7,
                    label="Captured condition",
                    condition_index=0,
                    is_por=True,
                    cells=(
                        BackboneSnapshotCell(parameter_code="alpha", value="A"),
                        BackboneSnapshotCell(parameter_code="beta", value="B"),
                    ),
                ),
            ),
        )
    )


def _capture_detail() -> list[dict[str, Any]]:
    return [
        {
            "target_condition_id": 501,
            "source_condition_id": 7,
            "label": "Captured condition",
            "condition_index": 0,
            "is_por": True,
            "cell_count": 2,
        }
    ]


@contextmanager
def _record_sql(engine: AsyncEngine) -> Iterator[list[str]]:
    statements: list[str] = []

    def _capture_sql(
        _conn: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _capture_sql)
    try:
        yield statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _capture_sql)


async def _seed_valid_capture_batch(session: AsyncSession) -> tuple[int, str]:
    session.add(
        Parameter(
            code="alpha",
            display_name="Alpha",
            value_type=ValueType.TEXT,
            is_active=False,
        )
    )
    project = Project(
        line_id="L-CAPTURE",
        process_id="PROC_CAPTURE",
        part_id="PART-CAPTURE",
        name="Capture history project",
        profile=ProjectProfile(
            process_name="Capture history project",
            device_type_code="DEFAULT",
            project_category_code="DEFAULT",
        ),
    )
    layer = SheetLayer(
        layer_key="L-CAPTURE::PROC_CAPTURE::010::ACT",
        step_seq="010",
        layer_id="ACT",
        sort_order=3,
    )
    target_condition = LayerCondition(
        label="Capture target",
        condition_index=0,
        is_por=True,
    )
    layer.conditions.append(target_condition)
    project.layers.append(layer)
    session.add(project)
    await session.flush()

    batch_id = "valid-v2-capture-batch"
    detail = _capture_detail()
    detail[0]["target_condition_id"] = target_condition.id
    session.add(
        ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.BACKBONE_COPY,
            actor="capture-operator",
            batch_id=batch_id,
            origin="backbone",
            layer_key=layer.layer_key,
            payload={
                "payload_schema_version": 2,
                "detail": detail,
                "capture": _capture_snapshot(),
            },
            created_at=datetime(2026, 7, 1, 0, 2, tzinfo=UTC),
        )
    )
    await session.commit()
    return project.id, batch_id


async def _seed_current_and_deleted_cells(
    session: AsyncSession,
) -> tuple[int, int, int]:
    session.add(
        Parameter(
            code="P1",
            display_name="P1",
            value_type=ValueType.TEXT,
            is_active=False,
        )
    )
    project = Project(
        line_id="L-CELL",
        process_id="PROC_CELL_HISTORY",
        part_id="PART-CELL",
        name="Cell history project",
        profile=ProjectProfile(
            process_name="Cell history project",
            device_type_code="DEFAULT",
            project_category_code="DEFAULT",
        ),
    )
    layer = SheetLayer(
        layer_key="L-CELL::PROC_CELL_HISTORY::010::ACT",
        step_seq="010",
        layer_id="ACT",
        sort_order=0,
    )
    current = LayerCondition(
        label="Current condition",
        condition_index=0,
        is_por=True,
        source_condition_id=77,
    )
    current.cell_values.append(CellValue(parameter_code="P1", value_text="CURRENT"))
    layer.conditions.append(current)
    project.layers.append(layer)
    session.add(project)
    await session.flush()

    layer.backbone_snapshot = serialize_backbone_snapshot(
        BackboneSnapshot(
            capture_batch_id="abcdef0123456789abcdef0123456789",
            captured_at=datetime(2026, 7, 1, 0, 0, tzinfo=UTC),
            source=BackboneSnapshotSource(
                project_id=project.id,
                sheet_layer_id=layer.id,
                layer_key=layer.layer_key,
                step_seq=layer.step_seq,
                layer_id=layer.layer_id,
            ),
            columns=(
                BackboneSnapshotColumn(
                    parameter_code="P1",
                    value_type=ValueType.TEXT,
                    display_name="P1",
                    category_code=None,
                    sort_order=0,
                    active_at_capture=True,
                ),
            ),
            conditions=(
                BackboneSnapshotCondition(
                    source_condition_id=77,
                    label="Baseline condition",
                    condition_index=0,
                    is_por=True,
                    cells=(BackboneSnapshotCell(parameter_code="P1", value="BASE"),),
                ),
            ),
        )
    )
    deleted_condition_id = current.id + 1000
    session.add_all(
        [
            ChangeEvent(
                project_id=project.id,
                event_type=ChangeEventType.CONDITION_ADD,
                actor="dev-admin",
                condition_id=current.id,
                layer_key=layer.layer_key,
                payload={
                    "condition_id": current.id,
                    "snapshot": {"label": "Current initial", "cells": {"P1": "INIT"}},
                },
                created_at=datetime(2026, 7, 1, 0, 1, tzinfo=UTC),
            ),
            ChangeEvent(
                project_id=project.id,
                event_type=ChangeEventType.CELL_UPDATE,
                actor="dev-admin",
                batch_id="current-cell-batch",
                origin="manual",
                condition_id=current.id,
                parameter_code="P1",
                layer_key=layer.layer_key,
                old_value="INIT",
                new_value="CURRENT",
                payload={"private_value": "DO_NOT_LOG_CURRENT"},
                created_at=datetime(2026, 7, 1, 0, 2, tzinfo=UTC),
            ),
            ChangeEvent(
                project_id=project.id,
                event_type=ChangeEventType.CONDITION_ADD,
                actor="dev-admin",
                condition_id=deleted_condition_id,
                layer_key=layer.layer_key,
                payload={
                    "condition_id": deleted_condition_id,
                    "snapshot": {"label": "Deleted initial", "cells": {"P1": "D-INIT"}},
                },
                created_at=datetime(2026, 7, 1, 0, 3, tzinfo=UTC),
            ),
            ChangeEvent(
                project_id=project.id,
                event_type=ChangeEventType.CELL_UPDATE,
                actor="dev-admin",
                batch_id="deleted-cell-batch",
                origin="manual",
                condition_id=deleted_condition_id,
                parameter_code="P1",
                layer_key=layer.layer_key,
                old_value="D-INIT",
                new_value="D-NEW",
                created_at=datetime(2026, 7, 1, 0, 4, tzinfo=UTC),
            ),
            ChangeEvent(
                project_id=project.id,
                event_type=ChangeEventType.CONDITION_REMOVE,
                actor="dev-admin",
                condition_id=deleted_condition_id,
                layer_key=layer.layer_key,
                payload={
                    "condition_id": deleted_condition_id,
                    "snapshot": {
                        "label": "Deleted condition",
                        "cells": {"P1": "D-NEW"},
                    },
                },
                created_at=datetime(2026, 7, 1, 0, 5, tzinfo=UTC),
            ),
        ]
    )
    await session.commit()
    return project.id, current.id, deleted_condition_id


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
    unbatched = next(item for item in body["items"] if item["kind"] == "event")
    assert unbatched["detail_status"] == "not_applicable"
    assert unbatched["detail_scope"] is None
    assert unbatched["metadata_status"] == "complete"


@pytest.mark.asyncio
async def test_timeline_first_and_cursor_pages_use_at_most_four_sql_statements(
    db_client: AsyncClient,
    db_session: AsyncSession,
    db_engine: AsyncEngine,
) -> None:
    project_id = await _seed_history_project(db_session)
    # Put an unbatched group ahead of the seeded batch so both the first-page
    # and cursor-page query shapes are exercised.
    db_session.add(
        ChangeEvent(
            project_id=project_id,
            event_type=ChangeEventType.PROJECT_PROFILE_UPDATE,
            actor="dev-admin",
            payload={},
            created_at=datetime(2026, 7, 1, 0, 2, tzinfo=UTC),
        )
    )
    await db_session.commit()

    with _record_sql(db_engine) as first_page_statements:
        first_page = await db_client.get(
            f"/api/projects/{project_id}/events", params={"limit": 1}
        )

    assert first_page.status_code == 200, first_page.text
    cursor = first_page.json()["next_cursor"]
    assert cursor is not None
    assert len(first_page_statements) <= 4

    with _record_sql(db_engine) as cursor_page_statements:
        cursor_page = await db_client.get(
            f"/api/projects/{project_id}/events",
            params={"limit": 1, "cursor": cursor},
        )

    assert cursor_page.status_code == 200, cursor_page.text
    assert cursor_page.json()["items"][0]["batch_id"] == "batch-1"
    assert len(cursor_page_statements) <= 4


@pytest.mark.asyncio
async def test_history_events_limit_above_max_is_rejected(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _seed_history_project(db_session)

    response = await db_client.get(f"/api/projects/{project_id}/events", params={"limit": 101})

    assert response.status_code == 422
    detail = await db_client.get(
        f"/api/projects/{project_id}/event-batches/batch-1",
        params={"scope": _scope(project_id, "batch-1"), "limit": 201},
    )
    cell = await db_client.get(
        f"/api/projects/{project_id}/cell-history",
        params={"condition_id": 1, "parameter_code": "P1", "limit": 101},
    )
    assert detail.status_code == 422
    assert cell.status_code == 422


@pytest.mark.asyncio
async def test_history_event_batch_scope_mismatch_is_rejected(
    db_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id = await _seed_history_project(db_session)
    scope = encode_history_detail_scope(
        HistoryDetailScope(project_id=project_id, batch_id="batch-other")
    )

    async def _repository_read_must_not_run(*args: object, **kwargs: object) -> None:
        del args, kwargs
        raise AssertionError("scope/path mismatch reached the repository")

    monkeypatch.setattr(HistoryRepository, "project_exists", _repository_read_must_not_run)

    response = await db_client.get(
        f"/api/projects/{project_id}/event-batches/batch-1",
        params={"scope": scope},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_scope"


@pytest.mark.asyncio
async def test_history_cell_history_missing_target_returns_404(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    missing_project = await db_client.get(
        "/api/projects/999999/cell-history",
        params={"condition_id": 1, "parameter_code": "P1"},
    )
    project_id = await _seed_history_project(db_session)
    missing_coordinate = await db_client.get(
        f"/api/projects/{project_id}/cell-history",
        params={"condition_id": 999999, "parameter_code": "P1"},
    )

    assert missing_project.status_code == 404
    assert missing_project.json()["code"] == "not_found"
    assert missing_coordinate.status_code == 404
    assert missing_coordinate.json()["code"] == "not_found"


@pytest.mark.asyncio
async def test_history_routes_execute_real_auth_dependency(db_client: AsyncClient) -> None:
    async def _reject_auth(request: Request) -> None:
        del request
        raise AppError("authentication required", code="unauthorized", status_code=401)

    app.dependency_overrides[get_current_user] = _reject_auth
    try:
        response = await db_client.get("/api/projects/1/events")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


@pytest.mark.asyncio
async def test_timeline_cursor_freezes_normalized_filters_and_detail_scope(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _seed_history_project(db_session)

    first = await db_client.get(
        f"/api/projects/{project_id}/events",
        params={"actor": " dev-admin ", "limit": 1},
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["next_cursor"] is not None
    detail_scope = decode_history_detail_scope(first_body["items"][0]["detail_scope"])
    assert detail_scope.member_filters.actors == ("dev-admin",)

    db_session.add(
        ChangeEvent(
            project_id=project_id,
            event_type=ChangeEventType.CELL_UPDATE,
            actor="dev-admin",
            batch_id="late-batch",
            origin="manual",
            layer_key="L1",
            condition_id=1,
            parameter_code="P1",
            old_value="SECRET_LATE_OLD",
            new_value="SECRET_LATE_NEW",
            created_at=datetime(2026, 7, 1, 0, 9, tzinfo=UTC),
        )
    )
    await db_session.commit()

    second = await db_client.get(
        f"/api/projects/{project_id}/events",
        params={
            "actor": "dev-admin",
            "limit": 1,
            "cursor": first_body["next_cursor"],
        },
    )
    assert second.status_code == 200, second.text
    assert all(item["batch_id"] != "late-batch" for item in second.json()["items"])
    assert second.json()["items"][0]["kind"] == "event"
    assert second.json()["items"][0]["detail_status"] == "not_applicable"
    assert second.json()["items"][0]["detail_scope"] is None

    mismatch = await db_client.get(
        f"/api/projects/{project_id}/events",
        params={"actor": "someone-else", "cursor": first_body["next_cursor"]},
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["code"] == "invalid_scope"


@pytest.mark.asyncio
async def test_timeline_is_lazy_and_emits_one_scrubbed_summary_log(
    db_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    project_id = await _seed_history_project(db_session)

    async def _detail_read_must_not_run(*args: object, **kwargs: object) -> None:
        del args, kwargs
        raise AssertionError("timeline attempted a detail payload read")

    monkeypatch.setattr(HistoryRepository, "describe_batch", _detail_read_must_not_run)
    monkeypatch.setattr(HistoryRepository, "load_cell_batch_page", _detail_read_must_not_run)
    monkeypatch.setattr(
        HistoryRepository, "load_capture_batch_rows", _detail_read_must_not_run
    )
    caplog.set_level(logging.INFO, logger="app.features.history.router")

    response = await db_client.get(
        f"/api/projects/{project_id}/events",
        params={"limit": 1},
        headers={
            "authorization": "Bearer SECRET_AUTH_TOKEN",
            "x-edit-lock-token": "SECRET_EDIT_LOCK_TOKEN",
        },
    )

    assert response.status_code == 200, response.text
    records = [
        record for record in caplog.records if record.getMessage() == "history_request_summary"
    ]
    assert len(records) == 1
    record = records[0]
    assert record.route == "timeline"  # type: ignore[attr-defined]
    assert record.status == 200  # type: ignore[attr-defined]
    assert record.count == 1  # type: ignore[attr-defined]
    assert record.duration_ms >= 0  # type: ignore[attr-defined]
    serialized = f"{record.getMessage()} {record.__dict__!r}"
    for forbidden in (
        "SECRET_RAW_VALUE",
        "OLD",
        "NEW",
        "SECRET_AUTH_TOKEN",
        "SECRET_EDIT_LOCK_TOKEN",
        "dev-admin",
        response.json()["items"][0]["detail_scope"],
    ):
        assert forbidden not in serialized


@pytest.mark.asyncio
async def test_cell_batch_pages_descending_and_proves_current_and_deleted_targets(
    db_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id, current_id, deleted_id = await _seed_current_and_deleted_cells(db_session)
    db_session.add(
        ChangeEvent(
            project_id=project_id,
            event_type=ChangeEventType.CELL_UPDATE,
            actor="dev-admin",
            batch_id="current-cell-batch",
            origin="manual",
            condition_id=current_id,
            parameter_code="P1",
            layer_key="L-CELL::PROC_CELL_HISTORY::010::ACT",
            old_value="CURRENT",
            new_value="LATEST",
            created_at=datetime(2026, 7, 1, 0, 6, tzinfo=UTC),
        )
    )
    await db_session.commit()

    current_scope_value = _scope(project_id, "current-cell-batch")
    first = await db_client.get(
        f"/api/projects/{project_id}/event-batches/current-cell-batch",
        params={"scope": current_scope_value, "limit": 1},
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["order_kind"] == "event_desc"
    assert first_body["detail_status"] == "available"
    assert first_body["items"][0]["new_code"] == "LATEST"
    assert first_body["items"][0]["jump_target"]["jump_status"] == "available"
    assert first_body["next_cursor"] is not None

    second = await db_client.get(
        f"/api/projects/{project_id}/event-batches/current-cell-batch",
        params={"scope": current_scope_value, "cursor": first_body["next_cursor"], "limit": 1},
    )
    assert second.status_code == 200, second.text
    assert second.json()["items"][0]["new_code"] == "CURRENT"
    assert second.json()["next_cursor"] is None

    deleted = await db_client.get(
        f"/api/projects/{project_id}/event-batches/deleted-cell-batch",
        params={"scope": _scope(project_id, "deleted-cell-batch")},
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["items"][0]["jump_target"]["jump_status"] == "deleted"

    capture_cursor = encode_history_detail_cursor(
        HistoryDetailCursor(
            version=1,
            scope=decode_history_detail_scope(current_scope_value),
            order_kind="capture_asc",
            last_capture_key=HistoryCaptureKey(
                target_layer_sort=0,
                target_layer_key="L1",
                source_condition_index=0,
                source_condition_id=1,
                parameter_sort=0,
                parameter_code="P1",
                event_id=1,
            ),
        )
    )

    async def _proof_must_not_run(*args: object, **kwargs: object) -> None:
        del args, kwargs
        raise AssertionError("cursor order mismatch reached coordinate proof")

    monkeypatch.setattr(HistoryRepository, "prove_cell_coordinates", _proof_must_not_run)
    mismatch = await db_client.get(
        f"/api/projects/{project_id}/event-batches/current-cell-batch",
        params={"scope": current_scope_value, "cursor": capture_cursor},
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["code"] == "invalid_cursor"

    # The coordinate is part of the cursor scope and is also strictly validated.
    cell_cursor_mismatch = await db_client.get(
        f"/api/projects/{project_id}/cell-history",
        params={
            "condition_id": deleted_id,
            "parameter_code": "P1",
            "cursor": first_body["next_cursor"],
        },
    )
    assert cell_cursor_mismatch.status_code == 422


@pytest.mark.asyncio
async def test_cell_batch_detail_reuses_descriptor_definition_in_three_sql_statements(
    db_client: AsyncClient,
    db_session: AsyncSession,
    db_engine: AsyncEngine,
) -> None:
    project_id, _, _ = await _seed_current_and_deleted_cells(db_session)

    with _record_sql(db_engine) as statements:
        response = await db_client.get(
            f"/api/projects/{project_id}/event-batches/current-cell-batch",
            params={"scope": _scope(project_id, "current-cell-batch")},
        )

    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["jump_target"]["jump_status"] == "available"
    assert len(statements) == 3


@pytest.mark.asyncio
async def test_cell_history_exposes_separate_current_and_deleted_anchors(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, current_id, deleted_id = await _seed_current_and_deleted_cells(db_session)

    current = await db_client.get(
        f"/api/projects/{project_id}/cell-history",
        params={"condition_id": current_id, "parameter_code": "P1"},
    )
    deleted = await db_client.get(
        f"/api/projects/{project_id}/cell-history",
        params={"condition_id": deleted_id, "parameter_code": "P1"},
    )

    assert current.status_code == 200, current.text
    assert current.json()["items"][0]["jump_status"] == "available"
    assert current.json()["baseline_entry"] == {"code": "BASE", "label": "Baseline condition"}
    assert current.json()["initial_entry"] == {"code": "INIT", "label": "Current initial"}
    assert "event_id" not in current.json()["baseline_entry"]
    assert "event_id" not in current.json()["initial_entry"]
    assert current.json()["initial_state_unavailable"] is False

    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["items"][0]["jump_status"] == "deleted"
    assert deleted.json()["baseline_entry"] is None
    assert deleted.json()["initial_entry"] == {"code": "D-INIT", "label": "Deleted initial"}
    assert "event_id" not in deleted.json()["initial_entry"]


@pytest.mark.asyncio
async def test_batch_detail_rejects_mixed_and_corrupt_and_marks_legacy_or_irrelevant(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _seed_history_project(db_session)
    db_session.add_all(
        [
            ChangeEvent(
                project_id=project_id,
                event_type=ChangeEventType.BACKBONE_COPY,
                actor="dev-admin",
                batch_id="batch-1",
                origin="backbone",
                layer_key="L1",
                payload={},
            ),
            ChangeEvent(
                project_id=project_id,
                event_type=ChangeEventType.BACKBONE_COPY,
                actor="dev-admin",
                batch_id="legacy-batch",
                origin="backbone",
                layer_key="L1",
                payload={},
            ),
            ChangeEvent(
                project_id=project_id,
                event_type=ChangeEventType.PROJECT_PROFILE_UPDATE,
                actor="dev-admin",
                batch_id="irrelevant-batch",
                payload={"profile": "SECRET_PROFILE_DATA"},
            ),
            ChangeEvent(
                project_id=project_id,
                event_type=ChangeEventType.BACKBONE_COPY,
                actor="dev-admin",
                batch_id="corrupt-batch",
                origin="backbone",
                layer_key="L1",
                payload={"payload_schema_version": 2, "detail": [], "capture": "broken"},
            ),
        ]
    )
    await db_session.commit()

    mixed = await db_client.get(
        f"/api/projects/{project_id}/event-batches/batch-1",
        params={"scope": _scope(project_id, "batch-1")},
    )
    corrupt = await db_client.get(
        f"/api/projects/{project_id}/event-batches/corrupt-batch",
        params={"scope": _scope(project_id, "corrupt-batch")},
    )
    legacy = await db_client.get(
        f"/api/projects/{project_id}/event-batches/legacy-batch",
        params={"scope": _scope(project_id, "legacy-batch")},
    )
    irrelevant = await db_client.get(
        f"/api/projects/{project_id}/event-batches/irrelevant-batch",
        params={"scope": _scope(project_id, "irrelevant-batch")},
    )
    missing = await db_client.get(
        f"/api/projects/{project_id}/event-batches/missing-batch",
        params={"scope": _scope(project_id, "missing-batch")},
    )

    assert mixed.status_code == 409
    assert mixed.json()["code"] == "invalid_event_batch"
    assert corrupt.status_code == 409
    assert corrupt.json()["code"] == "invalid_event_batch"
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["order_kind"] == "capture_asc"
    assert legacy.json()["detail_status"] == "legacy_unavailable"
    assert legacy.json()["items"] == []
    assert irrelevant.status_code == 200, irrelevant.text
    assert irrelevant.json()["order_kind"] == "event_desc"
    assert irrelevant.json()["detail_status"] == "not_applicable"
    assert irrelevant.json()["items"] == []
    assert missing.status_code == 404
    assert missing.json()["code"] == "not_found"


@pytest.mark.asyncio
async def test_batch_detail_missing_project_or_batch_uses_one_sql_statement(
    db_client: AsyncClient,
    db_session: AsyncSession,
    db_engine: AsyncEngine,
) -> None:
    project_id = await _seed_history_project(db_session)

    with _record_sql(db_engine) as missing_project_statements:
        missing_project = await db_client.get(
            "/api/projects/999999/event-batches/missing-batch",
            params={"scope": _scope(999999, "missing-batch")},
        )
    with _record_sql(db_engine) as missing_batch_statements:
        missing_batch = await db_client.get(
            f"/api/projects/{project_id}/event-batches/missing-batch",
            params={"scope": _scope(project_id, "missing-batch")},
        )

    assert missing_project.status_code == 404
    assert missing_batch.status_code == 404
    assert len(missing_project_statements) == 1
    assert len(missing_batch_statements) == 1


@pytest.mark.asyncio
async def test_valid_v2_capture_detail_uses_three_sql_statements_and_exact_layer_sort(
    db_client: AsyncClient,
    db_session: AsyncSession,
    db_engine: AsyncEngine,
) -> None:
    project_id, batch_id = await _seed_valid_capture_batch(db_session)

    with _record_sql(db_engine) as statements:
        response = await db_client.get(
            f"/api/projects/{project_id}/event-batches/{batch_id}",
            params={"scope": _scope(project_id, batch_id)},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["detail_status"] == "available"
    assert body["items"][0]["capture_tuple"]["target_layer_sort"] == 3
    assert body["items"][0]["jump_target"]["jump_status"] == "available"
    assert len(statements) == 3


@pytest.mark.asyncio
async def test_capture_detail_structurally_pages_complete_repository_rows(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    project_id = 42
    batch_id = "complete-capture-batch"
    scope_value = _scope(project_id, batch_id)
    scope = decode_history_detail_scope(scope_value)
    row = HistoryEventRow(
        event_id=10,
        event_type=ChangeEventType.BACKBONE_COPY.value,
        actor="capture-operator",
        created_at=datetime(2026, 7, 1, 0, 2, tzinfo=UTC),
        batch_id=batch_id,
        origin="backbone",
        layer_key="TARGET-L1",
        layer_sort_order=3,
        schema_version=2,
        detail=_capture_detail(),
        capture=_capture_snapshot(),
    )
    calls = {"proof": 0}

    async def _describe(
        self: HistoryRepository,
        requested_project_id: int,
        requested_batch_id: str,
        **kwargs: object,
    ) -> HistoryBatchDescriptor:
        del self, kwargs
        exists = requested_project_id == project_id and requested_batch_id == batch_id
        return HistoryBatchDescriptor(
            project_id=requested_project_id,
            batch_id=requested_batch_id,
            project_exists=requested_project_id == project_id,
            batch_exists=exists,
            total_event_count=1 if exists else 0,
            cell_event_count=0,
            capture_event_count=1 if exists else 0,
            other_event_count=0,
        )

    async def _load(
        self: HistoryRepository, *args: object, **kwargs: object
    ) -> tuple[HistoryEventRow, ...]:
        del self, args, kwargs
        return (row,)

    async def _proof(
        self: HistoryRepository,
        requested_project_id: int,
        coordinates: Sequence[HistoryCellCoordinateKey],
    ) -> dict[HistoryCellCoordinateKey, HistoryCellCoordinateProof]:
        del self
        calls["proof"] += 1
        return {
            coordinate: HistoryCellCoordinateProof(
                state="deleted",
                project_id=requested_project_id,
                condition_id=coordinate[0],
                parameter_code=coordinate[1],
                layer_key="TARGET-L1",
                current_event_id=None,
                remove_event_id=99,
                latest_event_id=10,
            )
            for coordinate in coordinates
        }

    monkeypatch.setattr(HistoryRepository, "describe_batch", _describe)
    monkeypatch.setattr(HistoryRepository, "load_capture_batch_rows", _load)
    monkeypatch.setattr(HistoryRepository, "prove_cell_coordinates", _proof)

    wrong_order = encode_history_detail_cursor(
        HistoryDetailCursor(
            version=1,
            scope=scope,
            order_kind="event_desc",
            last_event_id=10,
        )
    )
    mismatch = await db_client.get(
        f"/api/projects/{project_id}/event-batches/{batch_id}",
        params={"scope": scope_value, "cursor": wrong_order},
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["code"] == "invalid_cursor"
    assert calls["proof"] == 0

    first = await db_client.get(
        f"/api/projects/{project_id}/event-batches/{batch_id}",
        params={"scope": scope_value, "limit": 1},
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["order_kind"] == "capture_asc"
    assert first_body["detail_status"] == "available"
    assert first_body["items"][0]["capture_tuple"]["parameter_code"] == "alpha"
    assert first_body["items"][0]["jump_target"]["jump_status"] == "deleted"
    assert first_body["next_cursor"] is not None

    second = await db_client.get(
        f"/api/projects/{project_id}/event-batches/{batch_id}",
        params={"scope": scope_value, "cursor": first_body["next_cursor"], "limit": 1},
    )
    assert second.status_code == 200, second.text
    assert second.json()["items"][0]["capture_tuple"]["parameter_code"] == "beta"
    assert second.json()["next_cursor"] is None
