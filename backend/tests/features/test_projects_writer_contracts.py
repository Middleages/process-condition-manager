"""Project writer contract tests for the Task 9 backbone capture handoff."""

import re

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.features.projects.repository import ProjectRepository
from app.features.projects.schema import BackboneReplaceIn, ProjectCreate
from app.features.projects.service import ProjectService
from app.ingest.fixture_reader import FixtureIngestReader
from app.ingest.reader import IngestReader, LayerInfo, ProcessInfo, process_key
from app.models.project import ChangeEvent, ChangeEventType, Project
from app.project_metadata.manual import ManualProjectMetadataProvider
from tests.factories import seed_required_profile_choice_sets


class UnmatchedReader(IngestReader):
    """Reader fixture with an intentional no-match target process."""

    async def list_processes(self) -> list[ProcessInfo]:
        return []

    async def get_process(self, line_id: str, process_id: str) -> ProcessInfo:
        return ProcessInfo(
            key=process_key(line_id, process_id),
            line_id=line_id,
            process_id=process_id,
            display_name=f"{line_id} / {process_id}",
        )

    async def get_layers(self, line_id: str, process_id: str) -> list[LayerInfo]:
        return [
            LayerInfo(
                key=f"{line_id}::{process_id}::999::MISSING",
                step_seq="999",
                layer_id="MISSING",
                eqp_type="MISSING",
                eqp_type_desc="Intentional no-match",
                area_name="MISSING",
                sort_order=99,
            )
        ]


async def _seed_required_choices(db_session: AsyncSession) -> None:
    await seed_required_profile_choice_sets(db_session)
    await db_session.commit()


def _service(db_session: AsyncSession, reader: IngestReader | None = None) -> ProjectService:
    return ProjectService(
        ProjectRepository(db_session),
        reader or FixtureIngestReader(),
        ManualProjectMetadataProvider(),
    )


async def _create_project(
    service: ProjectService,
    *,
    process_id: str,
    part_id: str,
    backbone_project_id: int | None = None,
    reader_name: str = "Task9 writer",
) -> Project:
    return await service.create_project(
        ProjectCreate(
            line_id="L1",
            process_id=process_id,
            part_id=part_id,
            name=f"{reader_name} {part_id}",
            device_type_code="DEFAULT",
            project_category_code="DEFAULT",
            backbone_project_id=backbone_project_id,
        ),
        actor="worker-2",
    )


async def _change_events(
    db_session: AsyncSession,
    project_id: int,
    event_type: ChangeEventType | None = None,
) -> list[ChangeEvent]:
    stmt = select(ChangeEvent).where(ChangeEvent.project_id == project_id)
    if event_type is not None:
        stmt = stmt.where(ChangeEvent.event_type == event_type)
    rows = await db_session.execute(stmt.order_by(ChangeEvent.id))
    return list(rows.scalars())


async def _project_count(db_session: AsyncSession) -> int:
    count = await db_session.scalar(select(func.count(Project.id)))
    assert count is not None
    return int(count)


async def _event_count(db_session: AsyncSession) -> int:
    count = await db_session.scalar(select(func.count(ChangeEvent.id)))
    assert count is not None
    return int(count)


async def test_create_captures_source_before_graph_use(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _seed_required_choices(db_session)
    service = _service(db_session)

    source = await _create_project(service, process_id="PROC_ALPHA", part_id="SRC")
    await db_session.commit()

    calls: list[tuple[str, int]] = []
    original_capture = ProjectRepository.capture_source_project
    original_get = ProjectRepository.get

    async def capture_spy(
        self: ProjectRepository, project_id: int, *, locked_target: Project | None = None
    ) -> Project | None:
        calls.append(("capture", project_id))
        return await original_capture(self, project_id, locked_target=locked_target)

    async def get_spy(self: ProjectRepository, project_id: int) -> Project | None:
        calls.append(("get", project_id))
        return await original_get(self, project_id)

    monkeypatch.setattr(ProjectRepository, "capture_source_project", capture_spy)
    monkeypatch.setattr(ProjectRepository, "get", get_spy)

    await _create_project(
        service,
        process_id="PROC_BETA",
        part_id="TGT",
        backbone_project_id=source.id,
    )

    assert calls and calls[0] == ("capture", source.id)
    assert ("get", source.id) not in calls


async def test_create_emits_per_layer_copy_events_with_shared_batch_and_captured_at(
    db_session: AsyncSession,
) -> None:
    await _seed_required_choices(db_session)
    service = _service(db_session)

    source = await _create_project(service, process_id="PROC_ALPHA", part_id="SRC")
    target = await _create_project(
        service,
        process_id="PROC_ALPHA",
        part_id="TGT",
        backbone_project_id=source.id,
    )

    matched_layers = [
        layer
        for layer in target.layers
        if layer.source_project_id == source.id and layer.source_layer_key is not None
    ]
    copy_events = await _change_events(db_session, target.id, ChangeEventType.BACKBONE_COPY)

    assert len(copy_events) == len(matched_layers) > 0
    assert len({event.payload["batch_id"] for event in copy_events}) == 1
    for layer, event in zip(matched_layers, copy_events, strict=True):
        snapshot = layer.backbone_snapshot
        assert snapshot is not None
        assert snapshot["schema_version"] == 1
        assert snapshot["capture_batch_id"] == event.payload["batch_id"]
        assert snapshot["captured_at"] == event.payload["captured_at"]
        assert snapshot["source"]["project_id"] == source.id
        assert snapshot["source"]["layer_key"] == layer.source_layer_key
        assert re.fullmatch(r"[0-9a-f]{32}", snapshot["capture_batch_id"])
        assert re.fullmatch(r"[0-9a-f]{32}", event.payload["batch_id"])


async def test_create_leaves_no_copy_events_for_unmatched_layers(
    db_session: AsyncSession,
) -> None:
    await _seed_required_choices(db_session)
    service = _service(db_session, reader=UnmatchedReader())

    source = await _create_project(service, process_id="PROC_ALPHA", part_id="SRC")
    target = await _create_project(
        service,
        process_id="PROC_GAMMA",
        part_id="TGT",
        backbone_project_id=source.id,
    )

    copy_events = await _change_events(db_session, target.id, ChangeEventType.BACKBONE_COPY)

    assert copy_events == []
    assert all(layer.source_project_id is None for layer in target.layers)
    assert all(layer.backbone_snapshot is None for layer in target.layers)


async def test_create_rolls_back_when_source_capture_seam_fails(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _seed_required_choices(db_session)
    service = _service(db_session)

    source = await _create_project(service, process_id="PROC_ALPHA", part_id="SRC")
    await db_session.commit()

    async def fail_capture(
        self: ProjectRepository, project_id: int, *, locked_target: Project | None = None
    ) -> Project | None:
        raise ConflictError(
            "소스 프로젝트를 점유할 수 없다: " + str(project_id),
            code="source_project_busy",
            details={"project_id": project_id, "retryable": True},
        )

    monkeypatch.setattr(ProjectRepository, "capture_source_project", fail_capture)

    with pytest.raises(ConflictError, match="소스 프로젝트를 점유할 수 없다"):
        await _create_project(
            service,
            process_id="PROC_BETA",
            part_id="TGT",
            backbone_project_id=source.id,
        )

    assert await _project_count(db_session) == 1
    assert await _event_count(db_session) == 1


async def test_replace_resets_target_baseline_and_records_structured_event(
    db_session: AsyncSession,
) -> None:
    await _seed_required_choices(db_session)
    service = _service(db_session)

    source_a = await _create_project(service, process_id="PROC_ALPHA", part_id="SRC-A")
    source_b = await _create_project(service, process_id="PROC_BETA", part_id="SRC-B")
    target = await _create_project(
        service,
        process_id="PROC_BETA",
        part_id="TGT",
        backbone_project_id=source_a.id,
    )

    target_layer = next(layer for layer in target.layers if layer.source_project_id == source_a.id)
    replaced = await service.replace_layer_backbone(
        target.id,
        target_layer.layer_key,
        BackboneReplaceIn(
            source_project_id=source_b.id,
            source_layer_key=source_b.layers[0].layer_key,
        ),
        actor="worker-2",
    )

    replaced_layer = next(
        layer for layer in replaced.layers if layer.layer_key == target_layer.layer_key
    )
    replace_events = await _change_events(
        db_session, target.id, ChangeEventType.BACKBONE_LAYER_REPLACE
    )
    event = replace_events[-1]

    snapshot = replaced_layer.backbone_snapshot
    assert snapshot is not None
    assert snapshot["schema_version"] == 1
    assert snapshot["capture_batch_id"] == event.payload["batch_id"]
    assert snapshot["captured_at"] == event.payload["captured_at"]
    assert snapshot["source"]["project_id"] == source_b.id
    assert snapshot["source"]["layer_key"] == source_b.layers[0].layer_key
    assert event.payload["source"]["project_id"] == source_b.id
    assert event.payload["source"]["layer_key"] == source_b.layers[0].layer_key
    assert event.payload["target"]["project_id"] == target.id
    assert event.payload["target"]["layer_key"] == target_layer.layer_key
    assert re.fullmatch(r"[0-9a-f]{32}", event.payload["batch_id"])
