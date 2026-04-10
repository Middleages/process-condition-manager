"""Process-condition core CRUD service."""
import copy
import logging
from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.config import settings
from app.models import Product, Project, ProjectLayer
from app.repositories.backbone_repository import BackboneRepository
from app.services.step_master import query_service as step_master_query_service

# Re-exports for backward compatibility (used by tests and other modules)
from app.services.project.status_service import update_project_status  # noqa: F401
from app.services.project.analytics_service import get_change_summary, list_version_history  # noqa: F401

logger = logging.getLogger(__name__)


async def create_project_v2(
    db: AsyncSession,
    line_id: int,
    process: str,
    part_id: str,
    device_type: str,
    selected_layer_refs: list[tuple[str, str]],
    backbone_condition_id: int | None,
    created_by: int,
) -> Project:
    """Create a V2 project using step_current references (SPEC-PROJECT-002).

    V2 flow replaces the legacy product/backbone selection with a step-centric
    approach: the user selects line/process/part refs and explicit step_current
    layer refs(layer_id + step_seq), then optionally provides a backbone source
    for condition copy.

    Args:
        db: Async database session.
        line_id: Line FK for step_current lookup.
        process: Process identifier (e.g. "PHOTO").
        part_id: Part identifier for project identity.
        device_type: "full" or "short".
        selected_layer_refs: Explicit refs [(layer_id, step_seq), ...].
        backbone_condition_id: Optional approved process-condition id whose layers
            provide backbone conditions. If None, project is created without backbone.
        created_by: User FK for the creator.

    Returns:
        Newly created Project with layers eagerly loaded.

    Raises:
        HTTPException(404): step_current source not found.
        HTTPException(400): Invalid device_type or invalid layer IDs.
        HTTPException(409): Active project already exists for this ref.
    """

    # 1. Validate device_type
    if device_type not in ("full", "short"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid device_type '{device_type}'. Must be 'full' or 'short'.",
        )

    # 2. step_current 기반 검증/선택 수행 (device_master 비의존)
    normalized_part_id = part_id.strip()
    step_layers = await step_master_query_service.get_step_layers(db, line_id, process, normalized_part_id)
    selected_layer_refs = selected_layer_refs or []

    if settings.STEP_CURRENT_ENFORCE_FRESHNESS and step_layers:
        last_success_at = await step_master_query_service.get_last_successful_full_sync_at(db)
        is_fresh = step_master_query_service.is_within_freshness_sla(
            last_success_at=last_success_at,
            now_utc=datetime.now(timezone.utc),
            sla_minutes=settings.STEP_CURRENT_FRESHNESS_SLA_MINUTES,
        )
        if not is_fresh:
            logger.warning(
                "step_current freshness SLA breached. line_id=%s process=%s last_success_at=%s sla_minutes=%s",
                line_id,
                process,
                last_success_at.isoformat() if last_success_at else None,
                settings.STEP_CURRENT_FRESHNESS_SLA_MINUTES,
            )
            raise HTTPException(
                status_code=503,
                detail=(
                    "step_current is stale. "
                    f"last_success_at={last_success_at.isoformat() if last_success_at else 'none'}, "
                    f"sla_minutes={settings.STEP_CURRENT_FRESHNESS_SLA_MINUTES}"
                ),
            )

    if not step_layers:
        raise HTTPException(
            status_code=400,
            detail=(
                "선택한 line/process에 대한 step_current 데이터가 없습니다. "
                "동기화 완료 후 다시 시도해주세요."
            ),
        )

    # 3. Check no active (draft/review) project for same natural key
    result = await db.execute(
        select(Project).where(
            Project.line_id == line_id,
            Project.process == process,
            Project.part_id == normalized_part_id,
            Project.status.in_(["draft", "review"]),
            Project.is_latest.is_(True),
        )
    )
    existing = result.scalars().first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Active project (status={existing.status}) already exists for this reference.",
        )

    # 4. Determine backbone source and build layer map
    backbone_map: dict[str, dict] = {}
    if backbone_condition_id is not None:
        await BackboneRepository.validate_backbone_source(db, backbone_condition_id)
        backbone_map = await BackboneRepository.get_backbone_layer_map(db, backbone_condition_id)

    # 5. Create entries from step_current layers
    step_ref_map = {
        (sl.layer_id, sl.step_seq): sl
        for sl in step_layers
        if sl.layer_id and sl.step_seq
    }
    if not step_ref_map:
        raise HTTPException(status_code=400, detail="step_current에서 생성 가능한 레이어가 없습니다.")

    if device_type == "short" and not selected_layer_refs:
        raise HTTPException(status_code=422, detail="short 모드에서는 selected_layer_refs가 필요합니다.")

    if selected_layer_refs:
        invalid_refs = sorted([f"{layer}/{step}" for layer, step in selected_layer_refs if (layer, step) not in step_ref_map])
        if invalid_refs:
            raise HTTPException(status_code=400, detail=f"Invalid layer refs not in step_current: {invalid_refs}")
        selected_entries: list[tuple[str, str]] = [(layer, step) for layer, step in selected_layer_refs]
    else:
        selected_entries = sorted(
            [(sl.layer_id, sl.step_seq) for sl in step_layers if sl.layer_id and sl.step_seq],
            key=lambda it: (it[0], it[1]),
        )

    # 6. Create Project
    project = Project(
        product_id=None,
        device_master_id=None,
        process=process,
        device_type=device_type,
        line_id=line_id,
        product_name=None,
        part_id=normalized_part_id,
        main_backbone_id=backbone_condition_id,
        main_backbone_condition_id=backbone_condition_id,
        header_metadata=None,
        status="draft",
        created_by=created_by,
    )
    db.add(project)
    await db.flush()

    # 7. Create ProjectLayers for selected layers
    for sort_order, (layer_id_str, step_seq_ref) in enumerate(selected_entries):
        bb_cond = backbone_map.get(layer_id_str)

        if bb_cond is not None:
            conditions = copy.deepcopy(bb_cond)
            backbone_conditions = copy.deepcopy(bb_cond)
        else:
            conditions = {}
            backbone_conditions = {}

        src = step_ref_map[(layer_id_str, step_seq_ref)]
        layer_name = src.descript or src.step_name or layer_id_str
        step_seq = src.step_seq

        project_layer = ProjectLayer(
            project_id=project.id,
            layer_id=layer_id_str,
            layer_name=layer_name,
            step_seq=step_seq,
            backbone_product_id=backbone_condition_id if bb_cond is not None else None,
            backbone_source_condition_id=backbone_condition_id if bb_cond is not None else None,
            conditions=conditions,
            backbone_conditions=backbone_conditions,
            sort_order=sort_order,
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
    include_all_versions: bool = False,
    is_latest: bool | None = None,
    line_id: int | None = None,
) -> list[tuple[Project, int]]:
    """List projects with optional filters, returning (project, layer_count) tuples.

    By default, only returns the latest version per natural-key (is_latest=True).
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
        query = query.where(Project.is_latest == True)  # noqa: E712
    if status:
        query = query.where(Project.status == status)
    if line_id is not None:
        query = query.where(Project.line_id == line_id)

    result = await db.execute(query)
    return list(result.unique().all())


async def revise_project(
    db: AsyncSession,
    project_id: int,
    revision_reason: str | None = None,
) -> Project:
    """Create a new revision (Draft) from an Approved project.

    1. Validates project exists and status == "approved"
    2. Checks no active (draft/review) project exists for the same natural key
    3. In single transaction:
       a. Archive original: status="archived", is_latest=False
       b. Create new project: same natural key, status="draft", revision=original.revision+1,
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

    # 2. Check no active project exists for same natural key
    if not (original.line_id and original.process and original.part_id):
        raise HTTPException(status_code=400, detail="Natural key fields are required for revise")
    result = await db.execute(
        select(Project)
        .where(
            Project.line_id == original.line_id,
            Project.process == original.process,
            Project.part_id == original.part_id,
            Project.status.in_(["draft", "review"]),
            Project.is_latest.is_(True),
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
        product_id=None,
        main_backbone_id=original.main_backbone_id,
        main_backbone_condition_id=(
            original.main_backbone_condition_id
            if original.main_backbone_condition_id is not None
            else original.main_backbone_id
        ),
        status="draft",
        revision=original.revision + 1,
        parent_project_id=original.id,
        is_latest=True,
        created_by=original.created_by,
        # Natural-key path only: do not carry legacy device master reference.
        device_master_id=None,
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
            backbone_source_condition_id=(
                original_layer.backbone_source_condition_id
                if original_layer.backbone_source_condition_id is not None
                else original_layer.backbone_product_id
            ),
            conditions=copy.deepcopy(original_layer.conditions),
            backbone_conditions=copy.deepcopy(original_layer.conditions),
            sort_order=original_layer.sort_order,
        )
        db.add(new_layer)

    await db.commit()

    # 6. Return new project with all relationships loaded
    return await get_project_detail(db, new_project.id)


async def list_natural_key_revisions(
    db: AsyncSession,
    *,
    line_id: int,
    process: str,
    part_id: str,
) -> list[Project]:
    """Get all revision history for a natural key, ordered by revision DESC."""
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.creator))
        .where(
            Project.line_id == line_id,
            Project.process == process,
            Project.part_id == part_id,
        )
        .order_by(Project.revision.desc())
    )
    return list(result.scalars().all())
