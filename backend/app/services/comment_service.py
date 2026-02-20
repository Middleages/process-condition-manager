"""
Service layer for review comments.

Business logic (authorization, validation, state transitions) lives here.
All query logic is delegated to CommentRepository to avoid N+1 problems.
"""
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ReviewComment, Project, User
from app.repositories import CommentRepository
from app.schemas.comment import CommentCreate, CommentUpdate


async def create_comment(
    db: AsyncSession,
    project_id: int,
    data: CommentCreate,
) -> dict:
    """
    Create a new review comment.

    Args:
        db: Database session
        project_id: Project ID the comment belongs to
        data: Comment creation data

    Returns:
        Dictionary with comment data and joined user/layer/column info

    Raises:
        HTTPException: 404 if project not found, 403 if project is archived,
                       400 if invalid targeting (column without layer)
    """
    # Check project exists and not archived
    result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.status == "archived":
        raise HTTPException(status_code=403, detail="Cannot add comments to archived project")

    # Validate targeting: column_name without project_layer_id is invalid
    if data.column_name and not data.project_layer_id:
        raise HTTPException(
            status_code=400,
            detail="column_name requires project_layer_id to be specified"
        )

    # Create the comment
    review_comment = ReviewComment(
        project_id=project_id,
        project_layer_id=data.project_layer_id,
        column_name=data.column_name,
        comment=data.content,
        comment_type=data.comment_type,
        created_by=data.user_id,
        is_resolved=False,
    )

    db.add(review_comment)
    await db.flush()
    await db.refresh(review_comment)

    # Fetch the newly created comment with all joins in a single query
    comment_data = await CommentRepository.fetch_comment_with_joins(
        db, review_comment.id, project_id
    )

    await db.commit()

    return comment_data


async def list_comments(
    db: AsyncSession,
    project_id: int,
    is_resolved: bool | None = None,
    comment_type: str | None = None,
    project_layer_id: int | None = None,
) -> dict:
    """
    List comments for a project with optional filters.

    Args:
        db: Database session
        project_id: Project ID to query comments for
        is_resolved: Filter by resolution status
        comment_type: Filter by comment type
        project_layer_id: Filter by specific layer

    Returns:
        Dictionary with comments list, total count, and unresolved count
    """
    # Fetch all comments with a single JOIN query (replaces N+1 loop)
    comments = await CommentRepository.fetch_comments_with_joins(
        db,
        project_id,
        is_resolved=is_resolved,
        comment_type=comment_type,
        project_layer_id=project_layer_id,
    )

    # Count unresolved comments with a single COUNT query
    unresolved_count = await CommentRepository.count_unresolved(db, project_id)

    return {
        "comments": comments,
        "total": len(comments),
        "unresolved_count": unresolved_count,
    }


async def update_comment(
    db: AsyncSession,
    project_id: int,
    comment_id: int,
    data: CommentUpdate,
    user_id: int,
) -> dict:
    """
    Update a comment.

    Args:
        db: Database session
        project_id: Project ID (for validation)
        comment_id: Comment ID to update
        data: Update data
        user_id: User making the update

    Returns:
        Dictionary with updated comment data and joins

    Raises:
        HTTPException: 404 if comment not found, 403 if not authorized
    """
    # Fetch comment for authorization check
    result = await db.execute(
        select(ReviewComment).where(
            ReviewComment.id == comment_id,
            ReviewComment.project_id == project_id,
        )
    )
    comment = result.scalar_one_or_none()

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Ownership check: only creator or admin can modify
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if comment.created_by != user_id and user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Only the comment creator or admin can modify this comment"
        )

    # Apply updates
    if data.content is not None:
        comment.comment = data.content

    if data.is_resolved is not None:
        comment.is_resolved = data.is_resolved
        if data.is_resolved:
            comment.resolved_at = datetime.now(timezone.utc)
            comment.resolved_by = user_id
        else:
            comment.resolved_at = None
            comment.resolved_by = None

    if data.resolved_by is not None:
        comment.resolved_by = data.resolved_by

    await db.flush()
    await db.refresh(comment)

    # Fetch the updated comment with all joins in a single query
    comment_data = await CommentRepository.fetch_comment_with_joins(
        db, comment_id, project_id
    )

    await db.commit()

    return comment_data


async def delete_comment(
    db: AsyncSession,
    project_id: int,
    comment_id: int,
    user_id: int,
) -> None:
    """
    Delete a comment.

    Args:
        db: Database session
        project_id: Project ID (for validation)
        comment_id: Comment ID to delete
        user_id: User making the deletion

    Raises:
        HTTPException: 404 if comment not found, 403 if not authorized
    """
    # Fetch comment
    result = await db.execute(
        select(ReviewComment).where(
            ReviewComment.id == comment_id,
            ReviewComment.project_id == project_id,
        )
    )
    comment = result.scalar_one_or_none()

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Ownership check: only creator or admin
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if comment.created_by != user_id and user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Only the comment creator or admin can delete this comment"
        )

    # Hard delete
    await db.delete(comment)
    await db.commit()


async def get_unresolved_count(db: AsyncSession, project_id: int) -> int:
    """
    Get count of unresolved comments for a project.

    Args:
        db: Database session
        project_id: Project ID

    Returns:
        Count of unresolved comments
    """
    return await CommentRepository.count_unresolved(db, project_id)
