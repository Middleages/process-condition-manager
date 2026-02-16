from fastapi import APIRouter, Depends, Query, UploadFile, File, Form
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
    ChangeLogListResponse,
)
from app.schemas.backbone import (
    BackboneReplaceRequest,
    BackboneReplaceResponse,
    LayerAddRequest,
    LayerAddResponse,
)
from app.schemas.recipe import (
    RecipeUploadResponse,
    RecipeApplyRequest,
    RecipeApplyResponse,
)
from app.services import project_service, condition_service, validation_service, change_log_service
from app.services import backbone_service, recipe_service

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _build_project_response(project, *, layer_count: int = 0) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        product_id=project.product_id,
        product_name=project.product.product_name,
        main_backbone_id=project.main_backbone_id,
        backbone_name=project.backbone.product_name,
        status=project.status,
        revision=project.revision,
        parent_project_id=project.parent_project_id,
        is_latest=project.is_latest,
        created_by=project.created_by,
        creator_name=project.creator.display_name,
        layer_count=layer_count,
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
        revision=project.revision,
        parent_project_id=project.parent_project_id,
        is_latest=project.is_latest,
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
    results = await project_service.get_projects_list(db, status, product_id)
    return [_build_project_response(p, layer_count=lc) for p, lc in results]


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


@router.get("/{project_id}/change-logs", response_model=ChangeLogListResponse)
async def get_change_logs(
    project_id: int,
    layer_id: int | None = Query(None, description="Filter by layer_id"),
    column_name: str | None = Query(None, description="Filter by column_name"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await change_log_service.get_change_logs(
        db, project_id, layer_id=layer_id, column_name=column_name,
        limit=limit, offset=offset,
    )


# --- Backbone replacement ---

@router.put("/{project_id}/layers/{project_layer_id}/backbone", response_model=BackboneReplaceResponse)
async def replace_layer_backbone(
    project_id: int,
    project_layer_id: int,
    request: BackboneReplaceRequest,
    db: AsyncSession = Depends(get_db),
):
    from app.models import Product
    pl, changed_count = await backbone_service.replace_layer_backbone(
        db,
        project_id=project_id,
        project_layer_id=project_layer_id,
        source_product_id=request.source_product_id,
        source_layer_name=request.source_layer_name,
        changed_by=request.changed_by,
    )
    bb_product = await db.get(Product, pl.backbone_product_id) if pl.backbone_product_id else None
    return BackboneReplaceResponse(
        project_layer_id=pl.id,
        backbone_product_id=pl.backbone_product_id,
        backbone_product_name=bb_product.product_name if bb_product else "",
        changed_columns=changed_count,
        conditions=pl.conditions,
        backbone_conditions=pl.backbone_conditions,
    )


# --- Layer add/delete ---

@router.post("/{project_id}/layers", response_model=LayerAddResponse, status_code=201)
async def add_project_layer(
    project_id: int,
    request: LayerAddRequest,
    db: AsyncSession = Depends(get_db),
):
    pl = await backbone_service.add_layer(
        db,
        project_id=project_id,
        layer_id=request.layer_id,
        changed_by=request.changed_by,
        source_product_id=request.source_product_id,
        source_layer_name=request.source_layer_name,
    )
    # Eager-load relationships for response
    from app.models import Layer, Product
    layer = await db.get(Layer, pl.layer_id)
    bb_product = await db.get(Product, pl.backbone_product_id) if pl.backbone_product_id else None
    return LayerAddResponse(
        project_layer_id=pl.id,
        layer_id=pl.layer_id,
        layer_name=layer.layer_name if layer else "",
        backbone_product_id=pl.backbone_product_id,
        backbone_product_name=bb_product.product_name if bb_product else None,
        conditions=pl.conditions,
        sort_order=pl.sort_order,
    )


@router.delete("/{project_id}/layers/{project_layer_id}", status_code=204)
async def delete_project_layer(
    project_id: int,
    project_layer_id: int,
    db: AsyncSession = Depends(get_db),
):
    await backbone_service.delete_layer(db, project_id, project_layer_id)


# --- Recipe XML upload + apply ---

@router.post("/{project_id}/recipe/upload", response_model=RecipeUploadResponse)
async def upload_recipe_xml(
    project_id: int,
    files: list[UploadFile] = File(...),
    project_layer_id: int | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Upload one or more Recipe XML files.

    Returns diff results (no DB changes).
    Optionally specify ``project_layer_id`` to target a specific layer.
    """
    results = []
    for f in files:
        content = await f.read()
        diff = await recipe_service.parse_recipe_xml(
            db,
            project_id=project_id,
            xml_content=content,
            filename=f.filename,
        )
        # Override target layer if explicitly specified
        if project_layer_id is not None and diff.project_layer_id is None:
            diff.project_layer_id = project_layer_id
        results.append(diff)
    return RecipeUploadResponse(results=results)


@router.post("/{project_id}/recipe/apply", response_model=RecipeApplyResponse)
async def apply_recipe(
    project_id: int,
    request: RecipeApplyRequest,
    db: AsyncSession = Depends(get_db),
):
    """Apply selected recipe diff changes to project conditions."""
    return await recipe_service.apply_recipe_changes(db, project_id, request)
