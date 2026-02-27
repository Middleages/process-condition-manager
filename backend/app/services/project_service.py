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
from app.repositories.backbone_repository import BackboneRepository
from app.services import device_master_query_service

# Re-exports for backward compatibility (used by tests and other modules)
from app.services.project_status_service import update_project_status  # noqa: F401
from app.services.project_analytics_service import get_change_summary, list_version_history  # noqa: F401


async def create_project(
    db: AsyncSession,
    product_id: int,
    backbone_product_id: int,
    created_by: int,
) -> Project:
    """Create a project by copying backbone conditions from the source Approved project.

    The backbone source is now the Approved project for backbone_product_id
    (instead of product_layers). This allows dynamic backbone updates as
    backbone products get revised and re-approved.
    """

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

    # 2. Validate backbone source: must have an Approved project (raises 400 if not)
    backbone_product = await db.get(Product, backbone_product_id)
    if not backbone_product:
        raise HTTPException(status_code=404, detail="Backbone product not found")

    # validate_backbone_source raises 400 if no Approved project found
    await BackboneRepository.validate_backbone_source(db, backbone_product_id)

    # 3. Build backbone lookup: {layer_id: conditions} from Approved project's layers
    backbone_map: dict[str, dict] = await BackboneRepository.get_backbone_layer_map(
        db, backbone_product_id
    )

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
        layer_number = tpl.layer.layer_number
        bb_cond = backbone_map.get(layer_number)

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
            layer_id=tpl.layer.layer_number,
            layer_name=tpl.layer.layer_name,
            step_seq=tpl.layer.step_seq,
            backbone_product_id=bb_product_id,
            conditions=conditions,
            backbone_conditions=backbone_conditions,
            sort_order=tpl.layer.sort_order,
        )
        db.add(project_layer)

    await db.commit()

    # 7. Re-query with eager loading
    return await get_project_detail(db, project.id)


async def create_project_v2(
    db: AsyncSession,
    line_id: int,
    product_name: str,
    process: str,
    part_id: str,
    device_type: str,
    selected_layer_ids: list[str],
    backbone_product_id: int | None,
    created_by: int,
) -> Project:
    """Create a V2 project using DeviceMaster references (SPEC-PROJECT-002).

    V2 flow replaces the legacy product/backbone selection with a device-centric
    approach: the user selects a device (line + product_name + process + part_id),
    picks layers from the device's layer_master, and optionally provides a
    backbone source for condition copy.

    Args:
        db: Async database session.
        line_id: Line FK for device lookup.
        product_name: Device product name.
        process: Process identifier (e.g. "PHOTO").
        part_id: Part identifier for the device.
        device_type: "full" or "short".
        selected_layer_ids: Layer numbers to include (e.g. ["1.0", "2.0"]).
        backbone_product_id: Optional product whose Approved project provides
            backbone conditions. If None, project is created without backbone.
        created_by: User FK for the creator.

    Returns:
        Newly created Project with layers eagerly loaded.

    Raises:
        HTTPException(404): Device not found.
        HTTPException(400): Invalid device_type or invalid layer IDs.
        HTTPException(409): Active project already exists for this device.
    """

    # 1. Validate device_type
    if device_type not in ("full", "short"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid device_type '{device_type}'. Must be 'full' or 'short'.",
        )

    # 2. Find device_master by composite key
    device = await device_master_query_service.get_device_by_ref(
        db, line_id, product_name, process, part_id,
    )
    if device is None:
        raise HTTPException(
            status_code=404,
            detail=f"Device not found for line_id={line_id}, product_name='{product_name}', "
                   f"process='{process}', part_id='{part_id}'.",
        )

    # 3. Check no active (draft/review) project for same device_master_id
    result = await db.execute(
        select(Project).where(
            Project.device_master_id == device.id,
            Project.status.in_(["draft", "review"]),
        )
    )
    existing = result.scalars().first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Active project (status={existing.status}) already exists for this device.",
        )

    # 4. Determine backbone source and build layer map
    backbone_map: dict[str, dict] = {}
    if backbone_product_id is not None:
        await BackboneRepository.validate_backbone_source(db, backbone_product_id)
        backbone_map = await BackboneRepository.get_backbone_layer_map(db, backbone_product_id)

    # 5. Validate selected_layer_ids against device's layers
    device_layers = await device_master_query_service.get_device_layers(db, device.id)
    device_layer_map = {lm.layer_id: lm for lm in device_layers}
    invalid_ids = set(selected_layer_ids) - set(device_layer_map.keys())
    if invalid_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid layer IDs not in device: {sorted(invalid_ids)}",
        )

    # 6. Create Project
    project = Project(
        product_id=None,
        device_master_id=device.id,
        process=process,
        device_type=device_type,
        line_id=line_id,
        product_name=product_name,
        part_id=part_id,
        main_backbone_id=backbone_product_id,
        header_metadata=copy.deepcopy(device.enrichment) if device.enrichment else None,
        status="draft",
        created_by=created_by,
    )
    db.add(project)
    await db.flush()

    # 7. Create ProjectLayers for selected layers
    for layer_id_str in selected_layer_ids:
        lm = device_layer_map[layer_id_str]
        bb_cond = backbone_map.get(layer_id_str)

        if bb_cond is not None:
            conditions = copy.deepcopy(bb_cond)
            backbone_conditions = copy.deepcopy(bb_cond)
        else:
            conditions = {}
            backbone_conditions = {}

        project_layer = ProjectLayer(
            project_id=project.id,
            layer_id=layer_id_str,
            layer_name=lm.descript,
            step_seq=lm.step_seq,
            backbone_product_id=backbone_product_id if bb_cond is not None else None,
            conditions=conditions,
            backbone_conditions=backbone_conditions,
            sort_order=0,  # LayerMaster does not have sort_order; use index-based
        )
        db.add(project_layer)

    await db.commit()

    # 8. Re-query with eager loading
    return await get_project_detail(db, project.id)


async def get_project_detail(db: AsyncSession, project_id: int) -> Project:
    """Fetch a project with all relationships eager-loaded."""
    result = await db.execute(
        select(Project)
        .options(
            selectinload(Project.product).selectinload(Product.line),
            selectinload(Project.backbone),
            selectinload(Project.line),
            selectinload(Project.creator),
            selectinload(Project.layers).selectinload(ProjectLayer.backbone_product),
        )
        .where(Project.id == project_id)
    )
    project = result.scalars().first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def list_projects(
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
            selectinload(Project.line),
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
        # Support both V1 (product-based) and V2 (direct line_id) projects
        from sqlalchemy import or_
        query = query.outerjoin(Product, Project.product_id == Product.id).where(
            or_(
                Product.line_id == line_id,
                Project.line_id == line_id,
            )
        )

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
            selectinload(Project.layers),
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
        # SPEC-PROJECT-002 V2 fields (copy from original)
        device_master_id=original.device_master_id,
        process=original.process,
        device_type=original.device_type,
        header_metadata=copy.deepcopy(original.header_metadata) if original.header_metadata else None,
        line_id=original.line_id,
        product_name=original.product_name,
        part_id=original.part_id,
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
            layer_name=original_layer.layer_name,
            step_seq=original_layer.step_seq,
            backbone_product_id=original_layer.backbone_product_id,
            conditions=copy.deepcopy(original_layer.conditions),
            backbone_conditions=copy.deepcopy(original_layer.conditions),
            sort_order=original_layer.sort_order,
        )
        db.add(new_layer)

    await db.commit()

    # 6. Return new project with all relationships loaded
    return await get_project_detail(db, new_project.id)


async def list_product_revisions(
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
