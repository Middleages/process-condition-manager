"""
API endpoints for review comments.
"""
from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
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
    x_user_id: int = Header(..., alias="X-User-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Update a comment."""
    result = await comment_service.update_comment(
        db, project_id, comment_id, data, x_user_id
    )
    return result


@router.delete("/{comment_id}", status_code=204)
async def delete_comment(
    project_id: int,
    comment_id: int,
    x_user_id: int = Header(..., alias="X-User-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Delete a comment."""
    await comment_service.delete_comment(db, project_id, comment_id, x_user_id)
    return None
