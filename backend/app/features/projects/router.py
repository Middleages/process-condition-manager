"""프로젝트/백본 라우터."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import UserContext, get_current_user
from app.core.db import get_app_session
from app.core.locks import require_edit_lock
from app.features.projects.repository import ProjectRepository
from app.features.projects.schema import (
    BackboneCandidateOut,
    BackboneReplaceIn,
    ChoiceValueOut,
    LayerOut,
    MatchPreviewIn,
    MatchPreviewOut,
    ProjectCreate,
    ProjectListOut,
    ProjectOut,
    ProjectProfileOut,
    ProjectProfilePatchIn,
    ProjectSummaryOut,
)
from app.features.projects.service import ProjectService
from app.ingest.fixture_reader import get_ingest_reader
from app.ingest.reader import IngestReader
from app.models.project import Project
from app.project_metadata import (
    ProjectMetadataProvider,
    get_project_metadata_provider,
)

router = APIRouter(
    prefix="/projects",
    tags=["projects"],
    dependencies=[Depends(get_current_user)],
)


async def get_service(
    session: Annotated[AsyncSession, Depends(get_app_session)],
    reader: Annotated[IngestReader, Depends(get_ingest_reader)],
    metadata_provider: Annotated[
        ProjectMetadataProvider, Depends(get_project_metadata_provider)
    ],
) -> AsyncIterator[ProjectService]:
    service = ProjectService(ProjectRepository(session), reader, metadata_provider)
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
    return _project_out(project, await service.profile_out(project.profile))


@router.post(
    "/{project_id}/layers/{layer_key}/backbone-replace",
    response_model=ProjectOut,
    dependencies=[Depends(require_edit_lock)],
)
async def replace_layer_backbone(
    project_id: int,
    layer_key: str,
    data: BackboneReplaceIn,
    service: ServiceDep,
    user: UserDep,
) -> ProjectOut:
    project = await service.replace_layer_backbone(project_id, layer_key, data, actor=user.id)
    return _project_out(project, await service.profile_out(project.profile))


@router.get("", response_model=ProjectListOut)
async def list_projects(
    service: ServiceDep,
    query: str | None = None,
    status: str | None = None,
    device_type_code: str | None = None,
    project_category_code: str | None = None,
    cursor: int | None = None,
    limit: int = 50,
) -> ProjectListOut:
    limit = max(1, min(limit, 200))
    summaries, next_cursor = await service.list_projects(
        query=query,
        status=status,
        device_type_code=device_type_code,
        project_category_code=project_category_code,
        cursor=cursor,
        limit=limit,
    )
    return ProjectListOut(
        items=[
            ProjectSummaryOut(
                id=summary.project.id,
                line_id=summary.project.line_id,
                process_id=summary.project.process_id,
                part_id=summary.project.part_id,
                name=summary.project.name,
                status=summary.project.status.value,
                device_type=ChoiceValueOut(
                    code=summary.device_type.option_code,
                    label=summary.device_type.label,
                    is_active=summary.device_type.effective_is_active,
                ),
                project_category=ChoiceValueOut(
                    code=summary.project_category.option_code,
                    label=summary.project_category.label,
                    is_active=summary.project_category.effective_is_active,
                ),
                layer_total=summary.profile.layer_total,
                updated_at=summary.project.updated_at,
                layer_count=summary.layer_count,
                cell_count=summary.cell_count,
            )
            for summary in summaries
        ],
        next_cursor=next_cursor,
    )


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: int, service: ServiceDep) -> ProjectOut:
    project = await service.get_project(project_id)
    return _project_out(project, await service.profile_out(project.profile))


@router.get("/{project_id}/profile", response_model=ProjectProfileOut)
async def get_profile(project_id: int, service: ServiceDep) -> ProjectProfileOut:
    return await service.get_profile_out(project_id)


@router.patch(
    "/{project_id}/profile",
    response_model=ProjectProfileOut,
    dependencies=[Depends(require_edit_lock)],
)
async def patch_profile(
    project_id: int,
    data: ProjectProfilePatchIn,
    service: ServiceDep,
    user: UserDep,
) -> ProjectProfileOut:
    return await service.patch_profile(project_id, data, actor=user.id)


def _project_out(project: Project, profile: ProjectProfileOut) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        line_id=project.line_id,
        process_id=project.process_id,
        part_id=project.part_id,
        name=project.name,
        status=project.status.value,
        profile=profile,
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
