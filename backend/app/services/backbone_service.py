import copy
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models import (
    Product, ProductLayer, Project, ProjectLayer, Layer, ChangeLog,
)
from app.repositories.backbone_repository import BackboneRepository
from app.utils.comparison import values_differ


async def replace_layer_backbone(
    db: AsyncSession,
    project_id: int,
    project_layer_id: int,
    source_product_id: int,
    source_layer_name: str | None,
    changed_by: int,
) -> tuple[ProjectLayer, int]:
    """Replace a layer's backbone with conditions from another product.

    Returns (updated_project_layer, changed_column_count).
    """

    # 1. Load project, verify status == 'draft'
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status != "draft":
        raise HTTPException(status_code=400, detail="Can only replace backbone in draft projects")

    # 2. Load the target project_layer
    result = await db.execute(
        select(ProjectLayer)
        .options(selectinload(ProjectLayer.layer))
        .where(
            ProjectLayer.id == project_layer_id,
            ProjectLayer.project_id == project_id,
        )
    )
    target_pl = result.scalars().first()
    if not target_pl:
        raise HTTPException(status_code=404, detail="Project layer not found")

    # 3. Validate source product exists and has an Approved project (backbone source)
    source_product = await db.get(Product, source_product_id)
    if not source_product:
        raise HTTPException(status_code=404, detail="Source product not found")

    # validate_backbone_source raises 400 if no Approved project found
    approved_project = await BackboneRepository.validate_backbone_source(db, source_product_id)

    # 4. Find matching layer in source product's Approved project layers
    layer_name = source_layer_name or target_pl.layer.layer_name
    result = await db.execute(
        select(ProjectLayer)
        .join(Layer, ProjectLayer.layer_id == Layer.id)
        .where(
            ProjectLayer.project_id == approved_project.id,
            Layer.layer_name == layer_name,
        )
    )
    source_pl = result.scalars().first()
    if not source_pl:
        raise HTTPException(
            status_code=404,
            detail=f"Layer '{layer_name}' not found in approved project for '{source_product.product_name}'"
        )

    # 5. Compute diff and create change_logs
    old_conditions = target_pl.conditions or {}
    new_conditions = copy.deepcopy(source_pl.conditions or {})
    all_keys = set(old_conditions.keys()) | set(new_conditions.keys())
    changed_count = 0

    for key in all_keys:
        old_val = old_conditions.get(key)
        new_val = new_conditions.get(key)
        if values_differ(old_val, new_val):
            db.add(ChangeLog(
                project_layer_id=project_layer_id,
                column_name=key,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(new_val) if new_val is not None else None,
                change_type="backbone",
                changed_by=changed_by,
            ))
            changed_count += 1

    # 6. Update project_layer
    target_pl.conditions = new_conditions
    target_pl.backbone_conditions = copy.deepcopy(new_conditions)
    target_pl.backbone_product_id = source_product_id

    # 7. Touch project.updated_at
    project.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(target_pl)

    return target_pl, changed_count


async def add_layer(
    db: AsyncSession,
    project_id: int,
    layer_id: int,
    changed_by: int,
    source_product_id: int | None = None,
    source_layer_name: str | None = None,
) -> ProjectLayer:
    """Add a new layer to a project.

    If source_product_id is provided, copies conditions from that product's matching layer.
    Otherwise creates an empty layer.
    """

    # 1. Verify project status == 'draft'
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status != "draft":
        raise HTTPException(status_code=400, detail="Can only add layers in draft projects")

    # 2. Verify layer exists
    layer = await db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(status_code=404, detail="Layer not found")

    # 3. Check not already in project
    result = await db.execute(
        select(ProjectLayer).where(
            ProjectLayer.project_id == project_id,
            ProjectLayer.layer_id == layer_id,
        )
    )
    if result.scalars().first():
        raise HTTPException(status_code=409, detail=f"Layer '{layer.layer_name}' already exists in this project")

    # 4. Get conditions from source if provided
    conditions = {}
    backbone_conditions = {}
    bb_product_id = None

    if source_product_id is not None:
        source_product = await db.get(Product, source_product_id)
        if not source_product:
            raise HTTPException(status_code=404, detail="Source product not found")

        # validate_backbone_source raises 400 if no Approved project found
        approved_project = await BackboneRepository.validate_backbone_source(db, source_product_id)

        # Find the matching layer in the Approved project
        match_name = source_layer_name or layer.layer_name
        result = await db.execute(
            select(ProjectLayer)
            .join(Layer, ProjectLayer.layer_id == Layer.id)
            .where(
                ProjectLayer.project_id == approved_project.id,
                Layer.layer_name == match_name,
            )
        )
        source_pl = result.scalars().first()
        if source_pl:
            conditions = copy.deepcopy(source_pl.conditions or {})
            backbone_conditions = copy.deepcopy(source_pl.conditions or {})
            bb_product_id = source_product_id

    # 5. Create project_layer
    new_pl = ProjectLayer(
        project_id=project_id,
        layer_id=layer_id,
        backbone_product_id=bb_product_id,
        conditions=conditions,
        backbone_conditions=backbone_conditions,
        sort_order=layer.sort_order,
    )
    db.add(new_pl)

    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(new_pl)

    return new_pl


async def delete_layer(
    db: AsyncSession,
    project_id: int,
    project_layer_id: int,
) -> None:
    """Delete a layer from a project. Only allowed in draft status."""

    # 1. Verify project status == 'draft'
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status != "draft":
        raise HTTPException(status_code=400, detail="Can only delete layers in draft projects")

    # 2. Verify project_layer belongs to this project
    result = await db.execute(
        select(ProjectLayer).where(
            ProjectLayer.id == project_layer_id,
            ProjectLayer.project_id == project_id,
        )
    )
    pl = result.scalars().first()
    if not pl:
        raise HTTPException(status_code=404, detail="Project layer not found")

    # 3. Delete (change_logs cascade via FK)
    await db.delete(pl)

    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
