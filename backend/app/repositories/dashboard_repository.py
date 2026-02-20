"""Repository layer for Dashboard queries.

Optimized SQL queries with JOINs and subqueries to avoid N+1 problems.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChangeLog, Project, ProjectLayer, ProjectStatusLog, User
from app.models.product import Product


class DashboardRepository:
    """Data access layer for Dashboard with optimized aggregation queries."""

    @staticmethod
    async def fetch_status_counts(
        db: AsyncSession, line_id: int | None = None
    ) -> dict[str, int]:
        """Fetch project counts per status using PostgreSQL FILTER clause.

        Only counts latest revisions (is_latest=true), excludes archived.
        """
        query = select(
            func.count().filter(Project.status == "draft").label("draft"),
            func.count().filter(Project.status == "review").label("review"),
            func.count().filter(Project.status == "approved").label("approved"),
            func.count().filter(Project.status == "rejected").label("rejected"),
        ).where(Project.is_latest.is_(True))
        if line_id is not None:
            query = query.join(Product, Project.product_id == Product.id).where(
                Product.line_id == line_id
            )

        result = await db.execute(query)
        row = result.one()
        return {
            "draft": row.draft or 0,
            "review": row.review or 0,
            "approved": row.approved or 0,
            "rejected": row.rejected or 0,
        }

    @staticmethod
    async def fetch_my_recent_projects(
        db: AsyncSession, user_id: int, limit: int = 5, line_id: int | None = None
    ) -> list[dict]:
        """Fetch user's recent projects with changed_cells_count subquery."""
        changed_cells_subq = (
            select(func.count(ChangeLog.id))
            .join(ProjectLayer, ChangeLog.project_layer_id == ProjectLayer.id)
            .where(ProjectLayer.project_id == Project.id)
            .correlate(Project)
            .scalar_subquery()
            .label("changed_cells_count")
        )

        query = (
            select(
                Project.id,
                Product.product_name,
                Project.status,
                Project.revision,
                changed_cells_subq,
                Project.updated_at,
            )
            .join(Product, Project.product_id == Product.id)
            .where(Project.created_by == user_id, Project.is_latest.is_(True))
            .order_by(Project.updated_at.desc())
            .limit(limit)
        )
        if line_id is not None:
            query = query.where(Product.line_id == line_id)

        result = await db.execute(query)
        return [
            {
                "id": row.id,
                "product_name": row.product_name,
                "status": row.status,
                "revision": row.revision,
                "changed_cells_count": row.changed_cells_count or 0,
                "updated_at": row.updated_at,
            }
            for row in result.all()
        ]

    @staticmethod
    async def fetch_review_pending(
        db: AsyncSession, limit: int = 5, line_id: int | None = None
    ) -> list[dict]:
        """Fetch projects in review status with creator info and review_requested_at."""
        changed_cells_subq = (
            select(func.count(ChangeLog.id))
            .join(ProjectLayer, ChangeLog.project_layer_id == ProjectLayer.id)
            .where(ProjectLayer.project_id == Project.id)
            .correlate(Project)
            .scalar_subquery()
            .label("changed_cells_count")
        )

        review_requested_subq = (
            select(func.max(ProjectStatusLog.changed_at))
            .where(
                ProjectStatusLog.project_id == Project.id,
                ProjectStatusLog.to_status == "review",
            )
            .correlate(Project)
            .scalar_subquery()
            .label("review_requested_at")
        )

        creator = User.__table__.alias("creator")

        query = (
            select(
                Project.id,
                Product.product_name,
                creator.c.display_name.label("creator_name"),
                changed_cells_subq,
                review_requested_subq,
            )
            .join(Product, Project.product_id == Product.id)
            .join(creator, Project.created_by == creator.c.id)
            .where(Project.status == "review", Project.is_latest.is_(True))
            .order_by(review_requested_subq.desc())
            .limit(limit)
        )
        if line_id is not None:
            query = query.where(Product.line_id == line_id)

        result = await db.execute(query)
        return [
            {
                "id": row.id,
                "product_name": row.product_name,
                "creator_name": row.creator_name,
                "changed_cells_count": row.changed_cells_count or 0,
                "review_requested_at": row.review_requested_at,
            }
            for row in result.all()
        ]

    @staticmethod
    async def fetch_recent_activity(
        db: AsyncSession, limit: int = 5, line_id: int | None = None
    ) -> list[dict]:
        """Fetch recent status change events for the activity timeline."""
        query = (
            select(
                ProjectStatusLog.id,
                ProjectStatusLog.project_id,
                Product.product_name,
                ProjectStatusLog.from_status,
                ProjectStatusLog.to_status,
                User.display_name.label("changer_name"),
                ProjectStatusLog.comment,
                ProjectStatusLog.changed_at,
            )
            .join(Project, ProjectStatusLog.project_id == Project.id)
            .join(Product, Project.product_id == Product.id)
            .join(User, ProjectStatusLog.changed_by == User.id)
            .order_by(ProjectStatusLog.changed_at.desc())
            .limit(limit)
        )
        if line_id is not None:
            query = query.where(Product.line_id == line_id)

        result = await db.execute(query)
        return [
            {
                "id": row.id,
                "project_id": row.project_id,
                "product_name": row.product_name,
                "from_status": row.from_status,
                "to_status": row.to_status,
                "changer_name": row.changer_name,
                "comment": row.comment,
                "changed_at": row.changed_at,
            }
            for row in result.all()
        ]
