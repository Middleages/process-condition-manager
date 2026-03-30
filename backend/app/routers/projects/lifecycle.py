from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Product
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
    ChangeSummaryResponse,
)
from app.services.project import service as project_service
from app.services.project import status_service as project_status_service
from app.services.project import analytics_service as project_analytics_service
from app.services import change_log_service
from app.routers.projects.projects import _build_project_detail_response

router = APIRouter(prefix="/projects", tags=["project-lifecycle"])


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
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    projects = await project_service.list_product_revisions(db, product_id)
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
    result = await project_status_service.update_project_status(
        db=db,
        project_id=project_id,
        new_status=data.new_status,
        current_user=current_user,
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
    return await change_log_service.get_status_history(db, project_id)


@router.get("/{project_id}/change-summary", response_model=ChangeSummaryResponse)
async def get_change_summary(
    project_id: int,
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get change summary statistics for a project."""
    result = await project_analytics_service.get_change_summary(db, project_id)
    return result
