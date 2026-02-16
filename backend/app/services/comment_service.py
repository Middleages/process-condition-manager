"""
Service layer for review comments.
"""
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models import ReviewComment, Project, ProjectLayer, User, Layer, ColumnDefinition
from app.schemas.comment import CommentCreate, CommentUpdate, CommentResponse


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

    # Join user info for creator
    result = await db.execute(
        select(User).where(User.id == review_comment.created_by)
    )
    creator = result.scalar_one()

    # Build response with joined data
    response_data = {
        "id": review_comment.id,
        "project_id": project_id,
        "project_layer_id": review_comment.project_layer_id,
        "layer_name": None,
        "column_name": review_comment.column_name,
        "column_display_name": None,
        "content": review_comment.comment,
        "comment_type": review_comment.comment_type,
        "is_resolved": review_comment.is_resolved,
        "created_by": review_comment.created_by,
        "creator_name": creator.display_name,
        "creator_role": creator.role,
        "created_at": review_comment.created_at,
        "resolved_at": review_comment.resolved_at,
        "resolved_by": review_comment.resolved_by,
        "resolver_name": None,
    }

    # For cell/layer comments, join layer info
    if review_comment.project_layer_id:
        result = await db.execute(
            select(ProjectLayer, Layer)
            .join(Layer, ProjectLayer.layer_id == Layer.id)
            .where(ProjectLayer.id == review_comment.project_layer_id)
        )
        row = result.first()
        if row:
            _, layer = row
            response_data["layer_name"] = layer.layer_name

    # For cell comments, join column definition
    if review_comment.column_name:
        result = await db.execute(
            select(ColumnDefinition)
            .where(ColumnDefinition.column_name == review_comment.column_name)
        )
        col_def = result.scalar_one_or_none()
        if col_def:
            response_data["column_display_name"] = col_def.display_name

    await db.commit()

    return response_data


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
    # Base query - comments for this project
    query = select(ReviewComment).where(
        ReviewComment.project_id == project_id
    )

    # Apply filters
    if is_resolved is not None:
        query = query.where(ReviewComment.is_resolved == is_resolved)

    if comment_type is not None:
        query = query.where(ReviewComment.comment_type == comment_type)

    if project_layer_id is not None:
        query = query.where(ReviewComment.project_layer_id == project_layer_id)

    # Order by created_at descending
    query = query.order_by(ReviewComment.created_at.desc())

    # Execute query
    result = await db.execute(query)
    comments = result.scalars().all()

    # Build response with joined data
    response_comments = []
    for comment in comments:
        # Join creator info
        result = await db.execute(
            select(User).where(User.id == comment.created_by)
        )
        creator = result.scalar_one()

        # Join resolver info if resolved
        resolver_name = None
        if comment.resolved_by:
            result = await db.execute(
                select(User).where(User.id == comment.resolved_by)
            )
            resolver = result.scalar_one_or_none()
            if resolver:
                resolver_name = resolver.display_name

        # Join layer info if applicable
        layer_name = None
        if comment.project_layer_id:
            result = await db.execute(
                select(ProjectLayer, Layer)
                .join(Layer, ProjectLayer.layer_id == Layer.id)
                .where(ProjectLayer.id == comment.project_layer_id)
            )
            row = result.first()
            if row:
                _, layer = row
                layer_name = layer.layer_name

        # Join column definition if applicable
        column_display_name = None
        if comment.column_name:
            result = await db.execute(
                select(ColumnDefinition)
                .where(ColumnDefinition.column_name == comment.column_name)
            )
            col_def = result.scalar_one_or_none()
            if col_def:
                column_display_name = col_def.display_name

        response_comments.append({
            "id": comment.id,
            "project_id": project_id,
            "project_layer_id": comment.project_layer_id,
            "layer_name": layer_name,
            "column_name": comment.column_name,
            "column_display_name": column_display_name,
            "content": comment.comment,
            "comment_type": comment.comment_type,
            "is_resolved": comment.is_resolved,
            "created_by": comment.created_by,
            "creator_name": creator.display_name,
            "creator_role": creator.role,
            "created_at": comment.created_at,
            "resolved_at": comment.resolved_at,
            "resolved_by": comment.resolved_by,
            "resolver_name": resolver_name,
        })

    # Count unresolved comments
    unresolved_query = select(func.count(ReviewComment.id)).where(
        ReviewComment.project_id == project_id,
        ReviewComment.is_resolved == False,
    )
    unresolved_result = await db.execute(unresolved_query)
    unresolved_count = unresolved_result.scalar() or 0

    return {
        "comments": response_comments,
        "total": len(response_comments),
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

    # Build response with joins
    result = await db.execute(select(User).where(User.id == comment.created_by))
    creator = result.scalar_one()

    resolver_name = None
    if comment.resolved_by:
        result = await db.execute(select(User).where(User.id == comment.resolved_by))
        resolver = result.scalar_one_or_none()
        if resolver:
            resolver_name = resolver.display_name

    layer_name = None
    if comment.project_layer_id:
        result = await db.execute(
            select(ProjectLayer, Layer)
            .join(Layer, ProjectLayer.layer_id == Layer.id)
            .where(ProjectLayer.id == comment.project_layer_id)
        )
        row = result.first()
        if row:
            _, layer = row
            layer_name = layer.layer_name

    column_display_name = None
    if comment.column_name:
        result = await db.execute(
            select(ColumnDefinition)
            .where(ColumnDefinition.column_name == comment.column_name)
        )
        col_def = result.scalar_one_or_none()
        if col_def:
            column_display_name = col_def.display_name

    await db.commit()

    return {
        "id": comment.id,
        "project_id": project_id,
        "project_layer_id": comment.project_layer_id,
        "layer_name": layer_name,
        "column_name": comment.column_name,
        "column_display_name": column_display_name,
        "content": comment.comment,
        "comment_type": comment.comment_type,
        "is_resolved": comment.is_resolved,
        "created_by": comment.created_by,
        "creator_name": creator.display_name,
        "creator_role": creator.role,
        "created_at": comment.created_at,
        "resolved_at": comment.resolved_at,
        "resolved_by": comment.resolved_by,
        "resolver_name": resolver_name,
    }


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
    query = select(func.count(ReviewComment.id)).where(
        ReviewComment.project_id == project_id,
        ReviewComment.is_resolved == False,
    )
    result = await db.execute(query)
    return result.scalar() or 0
