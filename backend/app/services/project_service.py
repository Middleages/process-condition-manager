import copy

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models import (
    Product, ProductLayer, Project, ProjectLayer, Layer,
    ProjectStatusLog, ChangeLog, User
)
from app.services import validation_service
from app.services.comment_service import get_unresolved_count


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
    is_latest: bool | None = None,
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
            selectinload(Project.product),
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

    result = await db.execute(query)
    return list(result.unique().all())


async def revise_project(
    db: AsyncSession,
    project_id: int,
    description: str | None = None,
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
        raise HTTPException(404, "Project not found")
    if original.status != "approved":
        raise HTTPException(400, f"Can only revise approved projects. Current status: {original.status}")

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
        raise HTTPException(409, f"Active project (status={existing.status}) already exists for this product")

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
        created_by=original.created_by,  # Inherit creator or could be parameterized
    )
    db.add(new_project)
    await db.flush()

    # 5. Deep-copy project_layers: backbone_conditions = original's conditions
    for original_layer in original.layers:
        new_layer = ProjectLayer(
            project_id=new_project.id,
            layer_id=original_layer.layer_id,
            backbone_product_id=original_layer.backbone_product_id,
            conditions=copy.deepcopy(original_layer.conditions),
            backbone_conditions=copy.deepcopy(original_layer.conditions),  # Important: use approved conditions
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


async def update_project_status(
    db: AsyncSession,
    project_id: int,
    new_status: str,
    changed_by: int,
    comment: str | None = None,
) -> dict:
    """
    Update project status with state machine validation.

    State transitions:
    - draft → review (requires validation errors = 0)
    - review → approved (requires reviewer/admin role)
    - review → rejected (requires reviewer/admin role + unresolved comments > 0)
    - approved → archived

    Args:
        db: Database session
        project_id: Project ID
        new_status: Target status
        changed_by: User ID making the change
        comment: Optional comment for the transition

    Returns:
        Dictionary with id, status, previous_status, changed_by, changed_at

    Raises:
        HTTPException: 404 if project not found, 400 for invalid transitions,
                       403 for insufficient permissions
    """
    VALID_TRANSITIONS = {
        "draft": ["review"],
        "review": ["approved", "rejected"],
        "approved": ["archived"],
    }

    # Fetch project
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    current_status = project.status

    # Check archived status blocked
    if current_status == "archived":
        raise HTTPException(
            status_code=400,
            detail="Cannot change status of archived project"
        )

    # Check transition validity
    allowed_transitions = VALID_TRANSITIONS.get(current_status, [])
    if new_status not in allowed_transitions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status transition from {current_status} to {new_status}"
        )

    # For Draft → Review: validate no errors
    if current_status == "draft" and new_status == "review":
        validation_result = await validation_service.validate_project(db, project_id)
        if validation_result.error_count > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot submit for review: {validation_result.error_count} validation errors found"
            )

    # For Review → Approved/Rejected: check role
    if current_status == "review" and new_status in ["approved", "rejected"]:
        user = await db.get(User, changed_by)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if user.role not in ["reviewer", "admin"]:
            raise HTTPException(
                status_code=403,
                detail="Only reviewers can approve or reject projects"
            )

    # For Review → Rejected: check unresolved comments
    if current_status == "review" and new_status == "rejected":
        unresolved_count = await get_unresolved_count(db, project_id)
        if unresolved_count == 0:
            raise HTTPException(
                status_code=400,
                detail="At least one comment is required for rejection"
            )

        # Rejection creates dual log: review→rejected + rejected→draft
        # Set project status to draft (not permanently rejected)
        log_rejected = ProjectStatusLog(
            project_id=project_id,
            from_status=current_status,
            to_status="rejected",
            changed_by=changed_by,
            comment=comment,
        )
        db.add(log_rejected)
        await db.flush()

        log_to_draft = ProjectStatusLog(
            project_id=project_id,
            from_status="rejected",
            to_status="draft",
            changed_by=changed_by,
            comment="Automatic transition after rejection",
        )
        db.add(log_to_draft)
        await db.flush()

        project.status = "draft"
        await db.commit()

        return {
            "id": project.id,
            "status": "draft",
            "previous_status": current_status,
            "changed_by": changed_by,
            "changed_at": log_to_draft.changed_at,
        }

    # For all other transitions: create single status log
    status_log = ProjectStatusLog(
        project_id=project_id,
        from_status=current_status,
        to_status=new_status,
        changed_by=changed_by,
        comment=comment,
    )
    db.add(status_log)

    # Update project status
    project.status = new_status
    await db.flush()
    await db.commit()

    return {
        "id": project.id,
        "status": new_status,
        "previous_status": current_status,
        "changed_by": changed_by,
        "changed_at": status_log.changed_at,
    }


async def get_change_summary(db: AsyncSession, project_id: int) -> dict:
    """
    Get change summary statistics for a project.

    Returns:
        Dictionary with:
        - validation_error_count
        - changed_layers_count
        - total_layers_count
        - changed_cells_count
        - backbone_replacements_count
        - recipe_applications_count
    """
    # Get validation error count
    validation_result = await validation_service.validate_project(db, project_id)
    validation_error_count = validation_result.error_count

    # Get total layers count
    total_layers_result = await db.execute(
        select(func.count(ProjectLayer.id))
        .where(ProjectLayer.project_id == project_id)
    )
    total_layers_count = total_layers_result.scalar() or 0

    # Get project layer IDs
    project_layers_result = await db.execute(
        select(ProjectLayer.id)
        .where(ProjectLayer.project_id == project_id)
    )
    project_layer_ids = [row[0] for row in project_layers_result.fetchall()]

    if not project_layer_ids:
        return {
            "validation_error_count": validation_error_count,
            "changed_layers_count": 0,
            "total_layers_count": total_layers_count,
            "changed_cells_count": 0,
            "backbone_replacements_count": 0,
            "recipe_applications_count": 0,
        }

    # Count distinct layers with changes
    changed_layers_result = await db.execute(
        select(func.count(func.distinct(ChangeLog.project_layer_id)))
        .where(ChangeLog.project_layer_id.in_(project_layer_ids))
    )
    changed_layers_count = changed_layers_result.scalar() or 0

    # Count total changed cells
    changed_cells_result = await db.execute(
        select(func.count(ChangeLog.id))
        .where(ChangeLog.project_layer_id.in_(project_layer_ids))
    )
    changed_cells_count = changed_cells_result.scalar() or 0

    # Count backbone replacements (distinct layers)
    backbone_replacements_result = await db.execute(
        select(func.count(func.distinct(ChangeLog.project_layer_id)))
        .where(
            ChangeLog.project_layer_id.in_(project_layer_ids),
            ChangeLog.change_type == "backbone",
        )
    )
    backbone_replacements_count = backbone_replacements_result.scalar() or 0

    # Count recipe applications (distinct layers)
    recipe_applications_result = await db.execute(
        select(func.count(func.distinct(ChangeLog.project_layer_id)))
        .where(
            ChangeLog.project_layer_id.in_(project_layer_ids),
            ChangeLog.change_type == "recipe",
        )
    )
    recipe_applications_count = recipe_applications_result.scalar() or 0

    return {
        "validation_error_count": validation_error_count,
        "changed_layers_count": changed_layers_count,
        "total_layers_count": total_layers_count,
        "changed_cells_count": changed_cells_count,
        "backbone_replacements_count": backbone_replacements_count,
        "recipe_applications_count": recipe_applications_count,
    }
