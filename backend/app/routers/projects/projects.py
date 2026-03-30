from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.dependencies.auth import get_current_user, require_active_user
from app.schemas.project import (
    ProjectCreateRequest,
    ProjectCreateRequestV2,
    ProjectResponse,
    ProjectDetailResponse,
    ProjectLayerResponse,
)
from app.services.project import service as project_service

router = APIRouter(prefix="/projects", tags=["projects"])


def _build_project_response(project, *, layer_count: int = 0) -> ProjectResponse:
    product = project.product
    # V2 projects (device-ref based) may have product=None
    if product is not None:
        product_name = product.product_name
        line_id = product.line_id
        line_name = product.line.line_name if product.line else None
    else:
        product_name = project.product_name or ""
        line_id = project.line_id
        line_name = project.line.line_name if project.line else None

    backbone = project.backbone
    backbone_name = backbone.product_name if backbone else None

    return ProjectResponse(
        id=project.id,
        product_id=project.product_id,
        product_name=product_name,
        line_id=line_id,
        line_name=line_name,
        main_backbone_id=project.main_backbone_id,
        backbone_name=backbone_name,
        status=project.status,
        revision=project.revision,
        parent_project_id=project.parent_project_id,
        is_latest=project.is_latest,
        created_by=project.created_by,
        creator_name=project.creator.userid,
        layer_count=layer_count,
        created_at=project.created_at,
        updated_at=project.updated_at,
        # SPEC-PROJECT-002 V2 fields
        device_master_id=project.device_master_id,
        process=project.process,
        device_type=project.device_type,
        header_metadata=project.header_metadata,
        part_id=project.part_id,
    )


def _build_project_detail_response(project) -> ProjectDetailResponse:
    layers = []
    for pl in project.layers:
        bb_product = pl.backbone_product
        layers.append(ProjectLayerResponse(
            id=pl.id,
            layer_id=pl.layer_id,
            layer_name=pl.layer_name or "",
            step_seq=pl.step_seq or "",
            layer_number=pl.layer_id,
            backbone_product_id=pl.backbone_product_id,
            backbone_product_name=bb_product.product_name if bb_product else None,
            conditions=pl.conditions,
            backbone_conditions=pl.backbone_conditions,
            sort_order=pl.sort_order,
            updated_at=pl.updated_at,
        ))
    layers.sort(key=lambda x: x.sort_order)

    product = project.product
    # V2 projects (device-ref based) may have product=None
    if product is not None:
        product_name = product.product_name
        line_id = product.line_id
        line_name = product.line.line_name if product.line else None
    else:
        product_name = project.product_name or ""
        line_id = project.line_id
        line_name = project.line.line_name if project.line else None

    backbone = project.backbone
    backbone_name = backbone.product_name if backbone else None

    return ProjectDetailResponse(
        id=project.id,
        product_id=project.product_id,
        product_name=product_name,
        line_id=line_id,
        line_name=line_name,
        main_backbone_id=project.main_backbone_id,
        backbone_name=backbone_name,
        status=project.status,
        revision=project.revision,
        parent_project_id=project.parent_project_id,
        is_latest=project.is_latest,
        created_by=project.created_by,
        creator_name=project.creator.userid,
        created_at=project.created_at,
        updated_at=project.updated_at,
        layers=layers,
        # SPEC-PROJECT-002 V2 fields
        device_master_id=project.device_master_id,
        process=project.process,
        device_type=project.device_type,
        header_metadata=project.header_metadata,
        part_id=project.part_id,
    )


@router.post("", response_model=ProjectDetailResponse, status_code=201)
async def create_project(
    request: ProjectCreateRequest,
    current_user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.create_project(
        db, request.product_id, request.backbone_product_id, current_user.id,
    )
    return _build_project_detail_response(project)


@router.post("/v2", response_model=ProjectDetailResponse, status_code=201)
async def create_project_v2(
    req: ProjectCreateRequestV2,
    current_user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a project using device-ref based V2 flow (SPEC-PROJECT-002).

    Resolves device_master by (line_id, product_name, process, part_id),
    copies layers from layer_master, and optionally applies backbone conditions.
    """
    project = await project_service.create_project_v2(
        db,
        line_id=req.line_id,
        product_name=req.product_name,
        process=req.process,
        part_id=req.part_id,
        device_type=req.device_type,
        selected_layer_ids=req.selected_layer_ids or [],
        backbone_product_id=req.backbone_product_id,
        created_by=current_user.id,
    )
    return _build_project_detail_response(project)


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    status: str | None = None,
    product_id: int | None = None,
    line_id: int | None = None,
    is_latest: bool | None = Query(None, description="Filter by is_latest flag"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    results = await project_service.list_projects(
        db, status, product_id, is_latest=is_latest, line_id=line_id,
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
