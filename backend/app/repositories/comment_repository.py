"""
Repository layer for ReviewComment queries.

All query logic is centralized here, using efficient JOINs to avoid N+1 problems.
Business logic (authorization, validation) remains in comment_service.py.
"""
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models import ReviewComment, ProjectLayer, ColumnDefinition, User


class CommentRepository:
    """Data access layer for ReviewComment with optimized JOIN queries."""

    @staticmethod
    async def fetch_comments_with_joins(
        db: AsyncSession,
        project_id: int,
        *,
        is_resolved: bool | None = None,
        comment_type: str | None = None,
        project_layer_id: int | None = None,
    ) -> list[dict]:
        """Fetch all comments for a project with all joins in a SINGLE query.

        Uses aliased User for creator and resolver to allow two LEFT JOINs
        against the same users table without collision.

        Args:
            db: Async database session
            project_id: Project to fetch comments for
            is_resolved: Optional filter by resolution status
            comment_type: Optional filter by comment type string
            project_layer_id: Optional filter by specific project layer

        Returns:
            List of comment dicts matching the API contract
        """
        creator_user = aliased(User, name="creator_user")
        resolver_user = aliased(User, name="resolver_user")

        query = (
            select(
                ReviewComment,
                ProjectLayer.layer_name,
                ColumnDefinition.display_name,
                creator_user.display_name.label("creator_name"),
                creator_user.roles.label("creator_roles"),
                resolver_user.display_name.label("resolver_name"),
            )
            .where(ReviewComment.project_id == project_id)
            .outerjoin(ProjectLayer, ReviewComment.project_layer_id == ProjectLayer.id)
            .outerjoin(
                ColumnDefinition,
                ReviewComment.column_name == ColumnDefinition.column_name,
            )
            .outerjoin(creator_user, ReviewComment.created_by == creator_user.id)
            .outerjoin(resolver_user, ReviewComment.resolved_by == resolver_user.id)
            .order_by(ReviewComment.created_at.desc())
        )

        if is_resolved is not None:
            query = query.where(ReviewComment.is_resolved == is_resolved)
        if comment_type is not None:
            query = query.where(ReviewComment.comment_type == comment_type)
        if project_layer_id is not None:
            query = query.where(ReviewComment.project_layer_id == project_layer_id)

        result = await db.execute(query)
        rows = result.all()

        return [
            _row_to_dict(
                row.ReviewComment,
                project_id,
                row.layer_name,
                row.display_name,
                row.creator_name,
                row.creator_roles,
                row.resolver_name,
            )
            for row in rows
        ]

    @staticmethod
    async def fetch_comment_with_joins(
        db: AsyncSession,
        comment_id: int,
        project_id: int,
    ) -> dict | None:
        """Fetch a single comment with all joins in a SINGLE query.

        Args:
            db: Async database session
            comment_id: ID of the comment to fetch
            project_id: Project the comment belongs to (used in the result dict)

        Returns:
            Comment dict matching the API contract, or None if not found
        """
        creator_user = aliased(User, name="creator_user")
        resolver_user = aliased(User, name="resolver_user")

        query = (
            select(
                ReviewComment,
                ProjectLayer.layer_name,
                ColumnDefinition.display_name,
                creator_user.display_name.label("creator_name"),
                creator_user.roles.label("creator_roles"),
                resolver_user.display_name.label("resolver_name"),
            )
            .where(
                ReviewComment.id == comment_id,
                ReviewComment.project_id == project_id,
            )
            .outerjoin(ProjectLayer, ReviewComment.project_layer_id == ProjectLayer.id)
            .outerjoin(
                ColumnDefinition,
                ReviewComment.column_name == ColumnDefinition.column_name,
            )
            .outerjoin(creator_user, ReviewComment.created_by == creator_user.id)
            .outerjoin(resolver_user, ReviewComment.resolved_by == resolver_user.id)
        )

        result = await db.execute(query)
        row = result.first()

        if row is None:
            return None

        return _row_to_dict(
            row.ReviewComment,
            project_id,
            row.layer_name,
            row.display_name,
            row.creator_name,
            row.creator_roles,
            row.resolver_name,
        )

    @staticmethod
    async def count_unresolved(
        db: AsyncSession,
        project_id: int,
    ) -> int:
        """Count unresolved comments for a project.

        Args:
            db: Async database session
            project_id: Project to count comments for

        Returns:
            Integer count of unresolved comments
        """
        query = select(func.count(ReviewComment.id)).where(
            ReviewComment.project_id == project_id,
            ReviewComment.is_resolved == False,  # noqa: E712
        )
        result = await db.execute(query)
        return result.scalar() or 0


def _row_to_dict(
    comment: ReviewComment,
    project_id: int,
    layer_name: str | None,
    column_display_name: str | None,
    creator_name: str | None,
    creator_roles: list[str] | None,
    resolver_name: str | None,
) -> dict:
    """쿼리 결과 행을 표준 코멘트 응답 딕셔너리로 변환한다.

    Args:
        comment: ReviewComment ORM 인스턴스
        project_id: 딕셔너리에 포함할 프로젝트 ID
        layer_name: layers 테이블 LEFT JOIN으로 가져온 레이어명
        column_display_name: column_definitions LEFT JOIN으로 가져온 표시명
        creator_name: aliased User JOIN으로 가져온 작성자 이름
        creator_roles: aliased User JOIN으로 가져온 작성자 역할 목록
        resolver_name: aliased User JOIN으로 가져온 해결자 이름 (None 가능)

    Returns:
        API 응답 계약에 맞는 딕셔너리
    """
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
        "creator_name": creator_name,
        "creator_roles": creator_roles or [],
        "created_at": comment.created_at,
        "resolved_at": comment.resolved_at,
        "resolved_by": comment.resolved_by,
        "resolver_name": resolver_name,
    }
