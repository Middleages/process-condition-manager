"""
Project core CRUD service.

Handles project creation, retrieval, listing, revision, and product revisions.
"""
import copy

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models import Product, ProductLayer, Project, ProjectLayer

# Re-exports for backward compatibility (used by tests and other modules)
from app.services.project_status_service import update_project_status  # noqa: F401
from app.services.project_analytics_service import get_change_summary, get_version_history  # noqa: F401


async def create_project(
    db: AsyncSession,
    product_id: int,
    backbone_product_id: int,
    created_by: int,
) -> Project:
    """Create a project by copying backbone conditions to the target product's layers."""

    # 1. Validate target product exists and load its product_layers
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    result = await db.execute(
        select(ProductLayer)
        .options(selectinload(ProductLayer.layer))
        .where(ProductLayer.product_id == product_id)
    )
    target_product_layers = result.scalars().all()
    if not target_product_layers:
        raise HTTPException(status_code=400, detail="Product has no layers assigned")

    # 2. Validate backbone exists and is_backbone=True
    backbone = await db.get(Product, backbone_product_id)
    if not backbone:
        raise HTTPException(status_code=404, detail="Backbone product not found")
    if not backbone.is_backbone:
        raise HTTPException(status_code=400, detail="Selected product is not a backbone")

    # 3. Build backbone lookup: {layer_id: conditions}
    result = await db.execute(
        select(ProductLayer)
        .where(ProductLayer.product_id == backbone_product_id)
    )
    backbone_layers = result.scalars().all()
    backbone_map: dict[int, dict] = {bl.layer_id: bl.conditions for bl in backbone_layers}

    # 4. Check no active (draft/review) project for same product
    result = await db.execute(
        select(Project)
        .where(
            Project.product_id == product_id,
            Project.status.in_(["draft", "review"]),
        )
    )
    existing = result.scalars().first()
    if existing:
        raise HTTPException(status_code=409, detail="Active project already exists for this product")

    # 5. Create Project
    project = Project(
        product_id=product_id,
        main_backbone_id=backbone_product_id,
        status="draft",
        created_by=created_by,
    )
    db.add(project)
    await db.flush()

    # 6. Create ProjectLayers with backbone copy
    for tpl in target_product_layers:
        layer_id = tpl.layer_id
        bb_cond = backbone_map.get(layer_id)

        if bb_cond is not None:
            conditions = copy.deepcopy(bb_cond)
            backbone_conditions = copy.deepcopy(bb_cond)
            bb_product_id = backbone_product_id
        else:
            conditions = {}
            backbone_conditions = {}
            bb_product_id = None

        project_layer = ProjectLayer(
            project_id=project.id,
            layer_id=layer_id,
            backbone_product_id=bb_product_id,
            conditions=conditions,
            backbone_conditions=backbone_conditions,
            sort_order=tpl.layer.sort_order,
        )
        db.add(project_layer)

    await db.commit()

    # 7. Re-query with eager loading
    return await get_project_detail(db, project.id)


async def get_project_detail(db: AsyncSession, project_id: int) -> Project:
    """Fetch a project with all relationships eager-loaded."""
    result = await db.execute(
        select(Project)
        .options(
            selectinload(Project.product).selectinload(Product.line),
            selectinload(Project.backbone),
            selectinload(Project.creator),
            selectinload(Project.layers).selectinload(ProjectLayer.layer),
            selectinload(Project.layers).selectinload(ProjectLayer.backbone_product),
        )
        .where(Project.id == project_id)
    )
    project = result.scalars().first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def get_projects_list(
    db: AsyncSession,
    status: str | None = None,
    product_id: int | None = None,
    include_all_versions: bool = False,
    is_latest: bool | None = None,
    line_id: int | None = None,
) -> list[tuple[Project, int]]:
    """List projects with optional filters, returning (project, layer_count) tuples.

    By default, only returns the latest version per product (is_latest=True).
    Set include_all_versions=True to return all versions.
    Explicit is_latest filter overrides include_all_versions.
    """
    layer_count_sq = (
        select(func.count(ProjectLayer.id))
        .where(ProjectLayer.project_id == Project.id)
        .correlate(Project)
        .scalar_subquery()
        .label("layer_count")
    )
    query = (
        select(Project, layer_count_sq)
        .options(
            selectinload(Project.product).selectinload(Product.line),
            selectinload(Project.backbone),
            selectinload(Project.creator),
        )
        .order_by(Project.updated_at.desc())
    )
    if is_latest is not None:
        query = query.where(Project.is_latest == is_latest)
    elif not include_all_versions:
        query = query.where(Project.is_latest == True)
    if status:
        query = query.where(Project.status == status)
    if product_id is not None:
        query = query.where(Project.product_id == product_id)
    if line_id is not None:
        query = query.join(Product, Project.product_id == Product.id).where(Product.line_id == line_id)

    result = await db.execute(query)
    return list(result.unique().all())


async def revise_project(
    db: AsyncSession,
    project_id: int,
    revision_reason: str | None = None,
) -> Project:
    """Create a new revision (Draft) from an Approved project.

    1. Validates project exists and status == "approved"
    2. Checks no active (draft/review) project exists for the same product_id
    3. In single transaction:
       a. Archive original: status="archived", is_latest=False
       b. Create new project: same product_id, status="draft", revision=original.revision+1,
          parent_project_id=original.id, is_latest=True
       c. Deep-copy project_layers: conditions from original,
          backbone_conditions = original's conditions (important: use approved conditions as new baseline)
    4. Commit and return new project via get_project_detail
    """

    # 1. Load project with layers
    result = await db.execute(
        select(Project)
        .options(
            selectinload(Project.layers).selectinload(ProjectLayer.layer),
            selectinload(Project.product),
        )
        .where(Project.id == project_id)
    )
    original = result.scalars().first()
    if not original:
        raise HTTPException(status_code=404, detail="Project not found")
    if original.status != "approved":
        raise HTTPException(status_code=400, detail=f"Can only revise approved projects. Current status: {original.status}")

    # 2. Check no active project exists for same product
    result = await db.execute(
        select(Project)
        .where(
            Project.product_id == original.product_id,
            Project.status.in_(["draft", "review"]),
        )
    )
    existing = result.scalars().first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Active project (status={existing.status}) already exists for this product")

    # 3. Archive original
    original.status = "archived"
    original.is_latest = False

    # 4. Create new project
    new_project = Project(
        product_id=original.product_id,
        main_backbone_id=original.main_backbone_id,
        status="draft",
        revision=original.revision + 1,
        parent_project_id=original.id,
        is_latest=True,
        created_by=original.created_by,
    )
    if revision_reason:
        new_project.revision_reason = revision_reason
    db.add(new_project)
    await db.flush()

    # 5. Deep-copy project_layers: backbone_conditions = original's conditions
    for original_layer in original.layers:
        new_layer = ProjectLayer(
            project_id=new_project.id,
            layer_id=original_layer.layer_id,
            backbone_product_id=original_layer.backbone_product_id,
            conditions=copy.deepcopy(original_layer.conditions),
            backbone_conditions=copy.deepcopy(original_layer.conditions),
            sort_order=original_layer.sort_order,
        )
        db.add(new_layer)

    await db.commit()

    # 6. Return new project with all relationships loaded
    return await get_project_detail(db, new_project.id)


async def get_product_revisions(
    db: AsyncSession,
    product_id: int,
) -> list[Project]:
    """Get all revision history for a product, ordered by revision DESC."""
    result = await db.execute(
        select(Project)
        .options(
            selectinload(Project.creator),
        )
        .where(Project.product_id == product_id)
        .order_by(Project.revision.desc())
    )
    return list(result.scalars().all())
