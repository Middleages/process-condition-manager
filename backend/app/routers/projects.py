from datetime import datetime
from fastapi import APIRouter, Depends, Query, UploadFile, File, Form, HTTPException
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
    ReviseProjectRequest,
    RevisionItem,
    RevisionListResponse,
    StatusTransitionRequest,
    StatusTransitionResponse,
    StatusHistoryResponse,
    StatusHistoryItem,
    ChangeSummaryResponse,
    TimelineResponse,
    CellHistoryResponse,
    VersionHistoryResponse,
    VersionDiffResponse,
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
from app.services import backbone_service, recipe_service, diff_service

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
    is_latest: bool | None = Query(None, description="Filter by is_latest flag"),
    db: AsyncSession = Depends(get_db),
):
    results = await project_service.get_projects_list(db, status, product_id, is_latest=is_latest)
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
    change_type: str | None = Query(None, description="Filter by change_type (manual/backbone/recipe)"),
    changed_by: int | None = Query(None, description="Filter by user ID"),
    date_from: datetime | None = Query(None, description="Filter changes from this datetime"),
    date_to: datetime | None = Query(None, description="Filter changes to this datetime"),
    page: int = Query(1, ge=1, description="Page number for pagination"),
    db: AsyncSession = Depends(get_db),
):
    return await change_log_service.get_change_logs(
        db, project_id, layer_id=layer_id, column_name=column_name,
        limit=limit, offset=offset, change_type=change_type,
        changed_by=changed_by, date_from=date_from, date_to=date_to, page=page,
    )


@router.get("/{project_id}/changelog/timeline", response_model=TimelineResponse)
async def get_timeline(
    project_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    layer_id: int | None = Query(None, description="Filter by layer ID"),
    change_type: str | None = Query(None, description="Filter by change type: manual, backbone, recipe"),
    changed_by: int | None = Query(None, description="Filter by user ID"),
    db: AsyncSession = Depends(get_db),
):
    return await change_log_service.get_timeline(
        db, project_id,
        page=page,
        limit=limit,
        layer_id=layer_id,
        change_type=change_type,
        changed_by=changed_by,
    )


@router.get("/{project_id}/changelog/cell", response_model=CellHistoryResponse)
async def get_cell_history(
    project_id: int,
    project_layer_id: int = Query(..., description="Project layer ID"),
    column_name: str = Query(..., description="Column name"),
    db: AsyncSession = Depends(get_db),
):
    return await change_log_service.get_cell_history(
        db, project_id, project_layer_id=project_layer_id, column_name=column_name,
    )


@router.get("/{project_id}/versions", response_model=VersionHistoryResponse)
async def get_version_history(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    return await project_service.get_version_history(db, project_id)


@router.get("/{project_id}/versions/{compare_project_id}/diff", response_model=VersionDiffResponse)
async def get_version_diff(
    project_id: int,
    compare_project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """두 프로젝트 버전 간의 조건 데이터 차이를 반환한다."""
    return await diff_service.get_version_diff(db, project_id, compare_project_id)


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


# --- Revision feature ---

@router.post("/{project_id}/revise", response_model=ProjectDetailResponse, status_code=201)
async def revise_project(
    project_id: int,
    request: ReviseProjectRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Create a new revision from an approved project.

    - Original project becomes status='archived', is_latest=False
    - New project: status='draft', revision=original.revision+1, is_latest=True
    - Layers are deep-copied with backbone_conditions set to approved conditions
    """
    description = request.description if request else None
    project = await project_service.revise_project(db, project_id, description)
    return _build_project_detail_response(project)


@router.get("/by-product/{product_id}/revisions", response_model=RevisionListResponse)
async def get_product_revisions(
    product_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get revision history for a product."""
    from app.models import Product
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "Product not found")

    projects = await project_service.get_product_revisions(db, product_id)
    revisions = [
        RevisionItem(
            id=p.id,
            revision=p.revision,
            status=p.status,
            description=None,  # Add description field to Project model if needed
            created_by=p.creator.display_name if p.creator else None,
            created_at=p.created_at,
            is_latest=p.is_latest,
        )
        for p in projects
    ]

    return RevisionListResponse(
        product_id=product_id,
        product_name=product.product_name,
        revisions=revisions,
    )


@router.patch("/{project_id}/status", response_model=StatusTransitionResponse)
async def update_status(
    project_id: int,
    data: StatusTransitionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update project status with state machine validation."""
    result = await project_service.update_project_status(
        db=db,
        project_id=project_id,
        new_status=data.new_status,
        changed_by=data.changed_by,
        comment=data.comment,
    )
    return result


@router.get("/{project_id}/status-history", response_model=StatusHistoryResponse)
async def get_status_history(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get status change history for a project."""
    from app.models import ProjectStatusLog, User
    from sqlalchemy import select

    # Query status logs with user join
    result = await db.execute(
        select(ProjectStatusLog, User)
        .join(User, ProjectStatusLog.changed_by == User.id)
        .where(ProjectStatusLog.project_id == project_id)
        .order_by(ProjectStatusLog.changed_at.desc())
    )
    rows = result.fetchall()

    history = [
        StatusHistoryItem(
            id=log.id,
            from_status=log.from_status,
            to_status=log.to_status,
            changed_by=log.changed_by,
            changer_name=user.display_name,
            comment=log.comment,
            changed_at=log.changed_at,
        )
        for log, user in rows
    ]

    return StatusHistoryResponse(history=history)


@router.get("/{project_id}/change-summary", response_model=ChangeSummaryResponse)
async def get_change_summary(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get change summary statistics for a project."""
    result = await project_service.get_change_summary(db, project_id)
    return result
