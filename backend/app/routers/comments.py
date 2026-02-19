"""
API endpoints for review comments.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.dependencies.auth import get_current_user
from app.schemas.comment import (
    CommentCreate, CommentUpdate, CommentResponse, CommentListResponse
)
from app.services import comment_service


router = APIRouter(prefix="/api/projects/{project_id}/comments", tags=["comments"])


@router.post("/", response_model=CommentResponse, status_code=201)
async def create_comment(
    project_id: int,
    data: CommentCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new review comment."""
    result = await comment_service.create_comment(db, project_id, data)
    return result


@router.get("/", response_model=CommentListResponse)
async def list_comments(
    project_id: int,
    is_resolved: bool | None = None,
    comment_type: str | None = None,
    project_layer_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List comments for a project with optional filters."""
    result = await comment_service.list_comments(
        db, project_id, is_resolved, comment_type, project_layer_id
    )
    return result


@router.patch("/{comment_id}", response_model=CommentResponse)
async def update_comment(
    project_id: int,
    comment_id: int,
    data: CommentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a comment."""
    result = await comment_service.update_comment(
        db, project_id, comment_id, data, current_user.id
    )
    return result


@router.delete("/{comment_id}", status_code=204)
async def delete_comment(
    project_id: int,
    comment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a comment."""
    await comment_service.delete_comment(db, project_id, comment_id, current_user.id)
    return None
