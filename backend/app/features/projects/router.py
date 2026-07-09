"""프로젝트/백본 라우터."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import UserContext, get_current_user
from app.core.db import get_app_session
from app.features.projects.repository import ProjectRepository
from app.features.projects.schema import (
    BackboneCandidateOut,
    BackboneReplaceIn,
    LayerOut,
    MatchPreviewIn,
    MatchPreviewOut,
    ProjectCreate,
    ProjectListOut,
    ProjectOut,
    ProjectSummaryOut,
)
from app.features.projects.service import ProjectService
from app.ingest.fixture_reader import get_ingest_reader
from app.ingest.reader import IngestReader
from app.models.project import Project

router = APIRouter(
    prefix="/projects",
    tags=["projects"],
    dependencies=[Depends(get_current_user)],
)


async def get_service(
    session: Annotated[AsyncSession, Depends(get_app_session)],
    reader: Annotated[IngestReader, Depends(get_ingest_reader)],
) -> AsyncIterator[ProjectService]:
    service = ProjectService(ProjectRepository(session), reader)
    yield service
    await session.commit()


ServiceDep = Annotated[ProjectService, Depends(get_service)]
UserDep = Annotated[UserContext, Depends(get_current_user)]


@router.get("/backbone-candidates", response_model=list[BackboneCandidateOut])
async def backbone_candidates(
    service: ServiceDep, line_id: str, process_id: str
) -> list[BackboneCandidateOut]:
    ranked = await service.list_backbone_candidates(line_id, process_id)
    return [
        BackboneCandidateOut(
            id=project.id,
            name=project.name,
            line_id=project.line_id,
            process_id=project.process_id,
            part_id=project.part_id,
            status=project.status.value,
            layer_count=len(project.layers),
            match_rate=result.match_rate,
            matched_count=result.matched_count,
            unmatched_count=result.unmatched_count,
        )
        for project, result in ranked
    ]


@router.post("/backbone-preview", response_model=MatchPreviewOut)
async def preview_backbone(data: MatchPreviewIn, service: ServiceDep) -> MatchPreviewOut:
    return await service.preview_match(data)


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    data: ProjectCreate, service: ServiceDep, user: UserDep
) -> ProjectOut:
    project = await service.create_project(data, actor=user.id)
    return _project_out(project)


@router.post("/{project_id}/layers/{layer_key}/backbone-replace", response_model=ProjectOut)
async def replace_layer_backbone(
    project_id: int,
    layer_key: str,
    data: BackboneReplaceIn,
    service: ServiceDep,
    user: UserDep,
) -> ProjectOut:
    project = await service.replace_layer_backbone(project_id, layer_key, data, actor=user.id)
    return _project_out(project)


@router.get("", response_model=ProjectListOut)
async def list_projects(
    service: ServiceDep,
    query: str | None = None,
    status: str | None = None,
    cursor: int | None = None,
    limit: int = 50,
) -> ProjectListOut:
    limit = max(1, min(limit, 200))
    summaries, next_cursor = await service.list_projects(
        query=query, status=status, cursor=cursor, limit=limit
    )
    return ProjectListOut(
        items=[
            ProjectSummaryOut(
                id=project.id,
                line_id=project.line_id,
                process_id=project.process_id,
                part_id=project.part_id,
                name=project.name,
                description=project.description,
                status=project.status.value,
                layer_count=layer_count,
                cell_count=cell_count,
            )
            for project, layer_count, cell_count in summaries
        ],
        next_cursor=next_cursor,
    )


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: int, service: ServiceDep) -> ProjectOut:
    return _project_out(await service.get_project(project_id))


def _project_out(project: Project) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        line_id=project.line_id,
        process_id=project.process_id,
        part_id=project.part_id,
        name=project.name,
        description=project.description,
        status=project.status.value,
        layers=[
            LayerOut(
                id=layer.id,
                layer_key=layer.layer_key,
                step_seq=layer.step_seq,
                layer_id=layer.layer_id,
                eqp_type=layer.eqp_type,
                eqp_type_desc=layer.eqp_type_desc,
                area_name=layer.area_name,
                sort_order=layer.sort_order,
                condition_count=len(layer.conditions),
                cell_count=sum(len(condition.cell_values) for condition in layer.conditions),
                source_project_id=layer.source_project_id,
                source_layer_key=layer.source_layer_key,
            )
            for layer in project.layers
        ],
    )
