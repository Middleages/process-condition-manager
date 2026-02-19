"""
Repository layer for ChangeLog and ProjectStatusLog queries.

All query logic is centralized here, using efficient JOINs and conditional
aggregation to minimize round trips and avoid N+1 problems.
Business logic (HTTPException, validation) remains in the service layer.
"""
from datetime import datetime

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChangeLog, ProjectLayer, ProjectStatusLog, User
from app.models.product import Layer


class ChangeLogRepository:
    """Data access layer for ChangeLog with optimized JOIN and aggregation queries."""

    @staticmethod
    async def fetch_project_layer_map(
        db: AsyncSession,
        project_id: int,
        layer_id: int | None = None,
    ) -> dict[int, str]:
        """Fetch {project_layer_id: layer_name} map for a project.

        Optionally filter by layer_id (the layer master table ID).

        Args:
            db: Async database session
            project_id: Project to fetch layer map for
            layer_id: Optional filter by specific layer

        Returns:
            Dict mapping project_layer_id -> layer_name
        """
        query = (
            select(ProjectLayer.id, Layer.layer_name)
            .join(Layer, ProjectLayer.layer_id == Layer.id)
            .where(ProjectLayer.project_id == project_id)
        )
        if layer_id is not None:
            query = query.where(ProjectLayer.layer_id == layer_id)

        result = await db.execute(query)
        rows = result.all()
        return {row[0]: row[1] for row in rows}

    @staticmethod
    async def fetch_change_logs(
        db: AsyncSession,
        project_layer_ids: list[int],
        *,
        column_name: str | None = None,
        change_type: str | None = None,
        changed_by: int | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[tuple], int]:
        """Fetch change logs with User join. Returns (rows, total_count).

        Each row is a (ChangeLog, display_name) tuple.

        Args:
            db: Async database session
            project_layer_ids: List of project_layer IDs to filter by
            column_name: Optional filter by column name
            change_type: Optional filter by change type
            changed_by: Optional filter by user ID
            date_from: Optional lower bound on changed_at
            date_to: Optional upper bound on changed_at
            limit: Page size
            offset: Row offset for pagination

        Returns:
            Tuple of (list of (ChangeLog, display_name) rows, total count)
        """
        base_filter = ChangeLog.project_layer_id.in_(project_layer_ids)
        if column_name:
            base_filter = base_filter & (ChangeLog.column_name == column_name)
        if change_type:
            base_filter = base_filter & (ChangeLog.change_type == change_type)
        if changed_by:
            base_filter = base_filter & (ChangeLog.changed_by == changed_by)
        if date_from:
            base_filter = base_filter & (ChangeLog.changed_at >= date_from)
        if date_to:
            base_filter = base_filter & (ChangeLog.changed_at <= date_to)

        count_query = select(func.count()).select_from(ChangeLog).where(base_filter)
        total = (await db.execute(count_query)).scalar() or 0

        items_query = (
            select(ChangeLog, User.display_name)
            .join(User, ChangeLog.changed_by == User.id)
            .where(base_filter)
            .order_by(ChangeLog.changed_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await db.execute(items_query)
        rows = result.all()
        return rows, total

    @staticmethod
    async def fetch_status_logs(
        db: AsyncSession,
        project_id: int,
        *,
        changed_by: int | None = None,
    ) -> list[tuple]:
        """Fetch status logs with User join.

        Each row is a (ProjectStatusLog, display_name, user_id) tuple.

        Args:
            db: Async database session
            project_id: Project to fetch status logs for
            changed_by: Optional filter by user ID

        Returns:
            List of (ProjectStatusLog, display_name, user_id) tuples
        """
        query = (
            select(ProjectStatusLog, User.display_name, User.id)
            .join(User, ProjectStatusLog.changed_by == User.id)
            .where(ProjectStatusLog.project_id == project_id)
        )
        if changed_by is not None:
            query = query.where(ProjectStatusLog.changed_by == changed_by)

        result = await db.execute(query)
        return result.all()

    @staticmethod
    async def fetch_cell_history(
        db: AsyncSession,
        project_layer_id: int,
        column_name: str,
    ) -> list[tuple]:
        """Fetch cell change history with User join.

        Each row is a (ChangeLog, display_name) tuple.

        Args:
            db: Async database session
            project_layer_id: Project layer to fetch history for
            column_name: Column name to fetch history for

        Returns:
            List of (ChangeLog, display_name) tuples ordered by changed_at DESC
        """
        query = (
            select(ChangeLog, User.display_name)
            .join(User, ChangeLog.changed_by == User.id)
            .where(
                ChangeLog.project_layer_id == project_layer_id,
                ChangeLog.column_name == column_name,
            )
            .order_by(ChangeLog.changed_at.desc())
        )
        result = await db.execute(query)
        return result.all()

    @staticmethod
    async def fetch_change_summary_stats(
        db: AsyncSession,
        project_layer_ids: list[int],
    ) -> dict:
        """Fetch all change summary statistics in a SINGLE query using conditional aggregation.

        Combines 4 separate COUNT queries into one round trip:
          - changed_layers_count: distinct project_layer_ids with any change
          - changed_cells_count: total change log rows
          - backbone_replacements_count: distinct layers with backbone change
          - recipe_applications_count: distinct layers with recipe change

        Args:
            db: Async database session
            project_layer_ids: List of project_layer IDs to aggregate over

        Returns:
            Dict with keys: changed_layers_count, changed_cells_count,
            backbone_replacements_count, recipe_applications_count
        """
        query = select(
            func.count(func.distinct(ChangeLog.project_layer_id)).label("changed_layers"),
            func.count(ChangeLog.id).label("changed_cells"),
            func.count(
                func.distinct(
                    case(
                        (ChangeLog.change_type == "backbone", ChangeLog.project_layer_id),
                    )
                )
            ).label("backbone_replacements"),
            func.count(
                func.distinct(
                    case(
                        (ChangeLog.change_type == "recipe", ChangeLog.project_layer_id),
                    )
                )
            ).label("recipe_applications"),
        ).where(ChangeLog.project_layer_id.in_(project_layer_ids))

        result = await db.execute(query)
        row = result.one()
        return {
            "changed_layers_count": row.changed_layers or 0,
            "changed_cells_count": row.changed_cells or 0,
            "backbone_replacements_count": row.backbone_replacements or 0,
            "recipe_applications_count": row.recipe_applications or 0,
        }
