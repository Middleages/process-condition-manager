from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.project import (
    ProjectCreateRequest,
    ProjectResponse,
    ProjectDetailResponse,
    ProjectLayerResponse,
    BulkSaveRequest,
    BulkSaveResponse,
    ValidationResponse,
)
from app.services import project_service, condition_service, validation_service

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _build_project_response(project) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        product_id=project.product_id,
        product_name=project.product.product_name,
        main_backbone_id=project.main_backbone_id,
        backbone_name=project.backbone.product_name,
        status=project.status,
        created_by=project.created_by,
        creator_name=project.creator.display_name,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _build_project_detail_response(project) -> ProjectDetailResponse:
    layers = []
    for pl in project.layers:
        layer = pl.layer
        bb_product = pl.backbone_product
        layers.append(ProjectLayerResponse(
            id=pl.id,
            layer_id=pl.layer_id,
            layer_name=layer.layer_name,
            step_seq=layer.step_seq,
            layer_number=layer.layer_number,
            backbone_product_id=pl.backbone_product_id,
            backbone_product_name=bb_product.product_name if bb_product else None,
            conditions=pl.conditions,
            backbone_conditions=pl.backbone_conditions,
            sort_order=pl.sort_order,
            updated_at=pl.updated_at,
        ))
    layers.sort(key=lambda x: x.sort_order)

    return ProjectDetailResponse(
        id=project.id,
        product_id=project.product_id,
        product_name=project.product.product_name,
        main_backbone_id=project.main_backbone_id,
        backbone_name=project.backbone.product_name,
        status=project.status,
        created_by=project.created_by,
        creator_name=project.creator.display_name,
        created_at=project.created_at,
        updated_at=project.updated_at,
        layers=layers,
    )


@router.post("", response_model=ProjectDetailResponse, status_code=201)
async def create_project(
    request: ProjectCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.create_project(
        db, request.product_id, request.backbone_product_id, request.created_by,
    )
    return _build_project_detail_response(project)


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    status: str | None = None,
    product_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    projects = await project_service.get_projects_list(db, status, product_id)
    return [_build_project_response(p) for p in projects]


@router.get("/{project_id}", response_model=ProjectDetailResponse)
async def get_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.get_project_detail(db, project_id)
    return _build_project_detail_response(project)


@router.put("/{project_id}/conditions", response_model=BulkSaveResponse)
async def save_conditions(
    project_id: int,
    request: BulkSaveRequest,
    db: AsyncSession = Depends(get_db),
):
    return await condition_service.bulk_save_conditions(db, project_id, request)


@router.post("/{project_id}/validate", response_model=ValidationResponse)
async def validate_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    return await validation_service.validate_project(db, project_id)
