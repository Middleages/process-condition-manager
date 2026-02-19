from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.dependencies.auth import get_current_user, require_active_user
from app.schemas.project import (
    ProjectDetailResponse,
    ReviseProjectRequest,
    RevisionItem,
    RevisionListResponse,
    StatusTransitionRequest,
    StatusTransitionResponse,
    StatusHistoryResponse,
    StatusHistoryItem,
    ChangeSummaryResponse,
)
from app.services import project_service, project_status_service, project_analytics_service
from app.routers.projects import _build_project_detail_response

router = APIRouter(prefix="/api/projects", tags=["project-lifecycle"])


# --- Revision feature ---

@router.post("/{project_id}/revise", response_model=ProjectDetailResponse, status_code=201)
async def revise_project(
    project_id: int,
    request: ReviseProjectRequest | None = None,
    _current_user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new revision from an approved project.

    - Original project becomes status='archived', is_latest=False
    - New project: status='draft', revision=original.revision+1, is_latest=True
    - Layers are deep-copied with backbone_conditions set to approved conditions
    """
    revision_reason = request.revision_reason if request else None
    project = await project_service.revise_project(db, project_id, revision_reason)
    return _build_project_detail_response(project)


@router.get("/by-product/{product_id}/revisions", response_model=RevisionListResponse)
async def get_product_revisions(
    product_id: int,
    _current_user: User = Depends(get_current_user),
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
            revision_reason=p.revision_reason,
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


# --- Status management ---

@router.patch("/{project_id}/status", response_model=StatusTransitionResponse)
async def update_status(
    project_id: int,
    data: StatusTransitionRequest,
    current_user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Update project status with state machine validation.

    Role requirements:
    - 'review' status: project owner or admin
    - 'approved' / 'rejected' status: reviewer or admin only
    """
    if data.new_status in ("approved", "rejected") and current_user.role not in ("reviewer", "admin"):
        raise HTTPException(
            status_code=403,
            detail="Reviewer or admin access required for approve/reject",
        )
    result = await project_status_service.update_project_status(
        db=db,
        project_id=project_id,
        new_status=data.new_status,
        changed_by=current_user.id,
        comment=data.comment,
    )
    return result


@router.get("/{project_id}/status-history", response_model=StatusHistoryResponse)
async def get_status_history(
    project_id: int,
    _current_user: User = Depends(get_current_user),
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
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get change summary statistics for a project."""
    result = await project_analytics_service.get_change_summary(db, project_id)
    return result
