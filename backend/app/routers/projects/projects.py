import logging
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.dependencies.auth import get_current_user, require_active_user
from app.schemas.project import (
    ProjectCreateRequestV2,
    ProjectResponse,
    ProjectDetailResponse,
    ProjectLayerResponse,
)
from app.services.project import service as project_service
from app.repositories.backbone_repository import BackboneRepository

router = APIRouter(prefix="/process-conditions", tags=["projects"])
logger = logging.getLogger(__name__)


def _build_project_response(project, *, layer_count: int = 0) -> ProjectResponse:
    line_id = project.line_id
    line_name = project.line.line_name if project.line else None
    condition_name = (
        f"{project.process} | {project.part_id}"
        if project.process and project.part_id
        else f"PC-{project.id}"
    )

    backbone = project.backbone
    backbone_name = None
    if backbone is not None:
        bb_process = getattr(backbone, "process", None)
        bb_part = getattr(backbone, "part_id", None)
        bb_product_name = getattr(backbone, "product_name", None)
        if bb_process and bb_part:
            backbone_name = f"{bb_process} | {bb_part}"
        elif bb_product_name:
            backbone_name = bb_product_name

    return ProjectResponse(
        id=project.id,
        condition_name=condition_name,
        line_id=line_id,
        line_name=line_name,
        main_backbone_condition_id=(
            project.main_backbone_condition_id
            if project.main_backbone_condition_id is not None
            else project.main_backbone_id
        ),
        backbone_condition_name=backbone_name,
        status=project.status,
        revision=project.revision,
        parent_project_id=project.parent_project_id,
        is_latest=project.is_latest,
        created_by=project.created_by,
        creator_name=project.creator.userid,
        layer_count=layer_count,
        created_at=project.created_at,
        updated_at=project.updated_at,
        process=project.process,
        device_type=project.device_type,
        header_metadata=project.header_metadata,
        part_id=project.part_id,
    )


def _build_project_detail_response(project) -> ProjectDetailResponse:
    layers = []
    for pl in project.layers:
        bb_condition = pl.backbone_product
        layers.append(ProjectLayerResponse(
            id=pl.id,
            layer_id=pl.layer_id,
            layer_name=pl.layer_name or "",
            step_seq=pl.step_seq or "",
            layer_number=pl.layer_id,
            backbone_condition_id=(
                pl.backbone_source_condition_id
                if pl.backbone_source_condition_id is not None
                else pl.backbone_product_id
            ),
            backbone_condition_name=(
                f"{getattr(bb_condition, 'process', None)} | {getattr(bb_condition, 'part_id', None)}"
                if bb_condition and getattr(bb_condition, "process", None) and getattr(bb_condition, "part_id", None)
                else getattr(bb_condition, "product_name", None)
            ),
            conditions=pl.conditions,
            backbone_conditions=pl.backbone_conditions,
            sort_order=pl.sort_order,
            updated_at=pl.updated_at,
        ))
    layers.sort(key=lambda x: x.sort_order)

    line_id = project.line_id
    line_name = project.line.line_name if project.line else None
    condition_name = (
        f"{project.process} | {project.part_id}"
        if project.process and project.part_id
        else f"PC-{project.id}"
    )

    backbone = project.backbone
    backbone_name = None
    if backbone is not None:
        bb_process = getattr(backbone, "process", None)
        bb_part = getattr(backbone, "part_id", None)
        bb_product_name = getattr(backbone, "product_name", None)
        if bb_process and bb_part:
            backbone_name = f"{bb_process} | {bb_part}"
        elif bb_product_name:
            backbone_name = bb_product_name

    return ProjectDetailResponse(
        id=project.id,
        condition_name=condition_name,
        line_id=line_id,
        line_name=line_name,
        main_backbone_condition_id=(
            project.main_backbone_condition_id
            if project.main_backbone_condition_id is not None
            else project.main_backbone_id
        ),
        backbone_condition_name=backbone_name,
        status=project.status,
        revision=project.revision,
        parent_project_id=project.parent_project_id,
        is_latest=project.is_latest,
        created_by=project.created_by,
        creator_name=project.creator.userid,
        created_at=project.created_at,
        updated_at=project.updated_at,
        layers=layers,
        process=project.process,
        device_type=project.device_type,
        header_metadata=project.header_metadata,
        part_id=project.part_id,
    )


@router.post("/v2", response_model=ProjectDetailResponse, status_code=201)
async def create_project_v2(
    req: ProjectCreateRequestV2,
    current_user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a project using step-current-ref based V2 flow (SPEC-PROJECT-002).

    Uses (line_id, process, part_id) + selected_layer_refs to validate against step_current,
    then optionally applies backbone conditions.
    """
    started = perf_counter()
    try:
        project = await project_service.create_project_v2(
            db,
            line_id=req.line_id,
            process=req.process,
            part_id=req.part_id,
            device_type=req.device_type,
            selected_layer_refs=[(ref.layer_id, ref.step_seq) for ref in req.selected_layer_refs],
            backbone_condition_id=req.backbone_condition_id,
            created_by=current_user.id,
        )
        duration_ms = round((perf_counter() - started) * 1000, 2)
        logger.info(
            "process_condition.create_v2 outcome=success status_code=201 line_id=%s process=%s part_id=%s duration_ms=%s",
            req.line_id,
            req.process,
            req.part_id,
            duration_ms,
        )
        return _build_project_detail_response(project)
    except HTTPException as exc:
        duration_ms = round((perf_counter() - started) * 1000, 2)
        outcome = "client_error" if 400 <= exc.status_code < 500 else "server_error"
        logger.warning(
            "process_condition.create_v2 outcome=%s status_code=%s line_id=%s process=%s part_id=%s duration_ms=%s detail=%s",
            outcome,
            exc.status_code,
            req.line_id,
            req.process,
            req.part_id,
            duration_ms,
            exc.detail,
        )
        raise
    except Exception:
        duration_ms = round((perf_counter() - started) * 1000, 2)
        logger.exception(
            "process_condition.create_v2 outcome=server_error status_code=500 line_id=%s process=%s part_id=%s duration_ms=%s",
            req.line_id,
            req.process,
            req.part_id,
            duration_ms,
        )
        raise




@router.get("/backbones")
async def list_backbone_conditions(
    line_id: int | None = None,
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List approved/latest process-conditions that can be selected as backbone."""
    return await BackboneRepository.list_backbone_conditions(db, line_id=line_id)


@router.get("/backbones/{condition_id}/layers")
async def list_backbone_layers_by_condition(
    condition_id: int,
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List layers from an approved/latest backbone condition."""
    return await BackboneRepository.get_backbone_layers_by_condition(db, condition_id)


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    status: str | None = None,
    line_id: int | None = None,
    is_latest: bool | None = Query(None, description="Filter by is_latest flag"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    results = await project_service.list_projects(
        db, status, is_latest=is_latest, line_id=line_id,
    )
    return [_build_project_response(p, layer_count=lc) for p, lc in results]


@router.get("/{project_id}", response_model=ProjectDetailResponse)
async def get_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.get_project_detail(db, project_id)
    return _build_project_detail_response(project)
