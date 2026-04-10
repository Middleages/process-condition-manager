from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.dependencies.auth import require_project_owner
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
from app.models import Project
from app.services import backbone_service, recipe_service

router = APIRouter(prefix="/process-conditions", tags=["project-layers"])


# --- Backbone replacement ---

@router.put("/{project_id}/layers/{project_layer_id}/backbone", response_model=BackboneReplaceResponse)
async def replace_layer_backbone(
    project_id: int,
    project_layer_id: int,
    request: BackboneReplaceRequest,
    current_user: User = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    pl, changed_count = await backbone_service.replace_layer_backbone(
        db,
        project_id=project_id,
        project_layer_id=project_layer_id,
        source_condition_id=request.source_condition_id,
        source_layer_name=request.source_layer_name,
        changed_by=current_user.id,
    )
    bb_condition_id = (
        pl.backbone_source_condition_id
        if pl.backbone_source_condition_id is not None
        else pl.backbone_product_id
    )
    bb_condition = await db.get(Project, bb_condition_id) if bb_condition_id else None
    bb_name = (
        f"{bb_condition.process} | {bb_condition.part_id} (v{bb_condition.revision})"
        if bb_condition and bb_condition.process and bb_condition.part_id
        else ""
    )
    return BackboneReplaceResponse(
        project_layer_id=pl.id,
        backbone_condition_id=bb_condition_id,
        backbone_condition_name=bb_name,
        changed_columns=changed_count,
        conditions=pl.conditions,
        backbone_conditions=pl.backbone_conditions,
    )


# --- Layer add/delete ---

@router.post("/{project_id}/layers", response_model=LayerAddResponse, status_code=201)
async def add_project_layer(
    project_id: int,
    request: LayerAddRequest,
    current_user: User = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    pl = await backbone_service.add_layer(
        db,
        project_id=project_id,
        layer_id=request.layer_id,
        changed_by=current_user.id,
        source_condition_id=request.source_condition_id,
        source_layer_name=request.source_layer_name,
    )
    # Use denormalized fields from project_layer (works for both V1 and V2)
    bb_condition_id = (
        pl.backbone_source_condition_id
        if pl.backbone_source_condition_id is not None
        else pl.backbone_product_id
    )
    bb_condition = await db.get(Project, bb_condition_id) if bb_condition_id else None
    bb_name = (
        f"{bb_condition.process} | {bb_condition.part_id} (v{bb_condition.revision})"
        if bb_condition and bb_condition.process and bb_condition.part_id
        else None
    )
    return LayerAddResponse(
        project_layer_id=pl.id,
        layer_id=pl.layer_id,
        layer_name=pl.layer_name or "",
        backbone_condition_id=bb_condition_id,
        backbone_condition_name=bb_name,
        conditions=pl.conditions,
        sort_order=pl.sort_order,
    )


@router.delete("/{project_id}/layers/{project_layer_id}", status_code=204)
async def delete_project_layer(
    project_id: int,
    project_layer_id: int,
    _current_user: User = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    await backbone_service.delete_layer(db, project_id, project_layer_id)


# --- Recipe XML upload + apply ---

@router.post("/{project_id}/recipe/upload", response_model=RecipeUploadResponse)
async def upload_recipe_xml(
    project_id: int,
    files: list[UploadFile] = File(...),
    project_layer_id: int | None = Form(None),
    _current_user: User = Depends(require_project_owner),
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
    _current_user: User = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    """Apply selected recipe diff changes to project conditions."""
    return await recipe_service.apply_recipe_changes(db, project_id, request)
