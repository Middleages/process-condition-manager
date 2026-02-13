import copy

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models import Product, ProductLayer, Project, ProjectLayer, Layer


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
        raise HTTPException(404, "Product not found")

    result = await db.execute(
        select(ProductLayer)
        .options(selectinload(ProductLayer.layer))
        .where(ProductLayer.product_id == product_id)
    )
    target_product_layers = result.scalars().all()
    if not target_product_layers:
        raise HTTPException(400, "Product has no layers assigned")

    # 2. Validate backbone exists and is_backbone=True
    backbone = await db.get(Product, backbone_product_id)
    if not backbone:
        raise HTTPException(404, "Backbone product not found")
    if not backbone.is_backbone:
        raise HTTPException(400, "Selected product is not a backbone")

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
        raise HTTPException(409, "Active project already exists for this product")

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
            selectinload(Project.product),
            selectinload(Project.backbone),
            selectinload(Project.creator),
            selectinload(Project.layers).selectinload(ProjectLayer.layer),
            selectinload(Project.layers).selectinload(ProjectLayer.backbone_product),
        )
        .where(Project.id == project_id)
    )
    project = result.scalars().first()
    if not project:
        raise HTTPException(404, "Project not found")
    return project


async def get_projects_list(
    db: AsyncSession,
    status: str | None = None,
    product_id: int | None = None,
    include_all_versions: bool = False,
) -> list[tuple[Project, int]]:
    """List projects with optional filters, returning (project, layer_count) tuples.

    By default, only returns the latest version per product (is_latest=True).
    Set include_all_versions=True to return all versions.
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
            selectinload(Project.product),
            selectinload(Project.backbone),
            selectinload(Project.creator),
        )
        .order_by(Project.updated_at.desc())
    )
    if not include_all_versions:
        query = query.where(Project.is_latest == True)
    if status:
        query = query.where(Project.status == status)
    if product_id is not None:
        query = query.where(Project.product_id == product_id)

    result = await db.execute(query)
    return list(result.unique().all())
