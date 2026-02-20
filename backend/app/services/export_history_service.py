from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.export import ExportSystem
from app.models.export_history import ExportHistory
from app.models.project import Project
from app.models.user import User
from app.schemas.export import ExportHistoryResponse

logger = logging.getLogger(__name__)


class ExportHistoryService:
    """Service for logging and querying export history records."""

    @staticmethod
    async def log_export(
        db: AsyncSession,
        *,
        project_id: int,
        export_system_id: int,
        exported_by: int,
        export_type: str,
        file_count: int,
        total_rows: int,
    ) -> ExportHistory:
        """Create an ExportHistory record and return it."""
        record = ExportHistory(
            project_id=project_id,
            export_system_id=export_system_id,
            exported_by=exported_by,
            export_type=export_type,
            file_count=file_count,
            total_rows=total_rows,
        )
        db.add(record)
        await db.flush()
        await db.refresh(record)
        logger.info(
            "Export logged: project_id=%d system_id=%d type=%s",
            project_id,
            export_system_id,
            export_type,
        )
        return record

    @staticmethod
    async def get_project_history(
        db: AsyncSession,
        project_id: int,
        *,
        offset: int = 0,
        limit: int = 10,
    ) -> tuple[list[ExportHistoryResponse], int]:
        """Return paginated export history for a given project.

        Each item is enriched with system_name (from ExportSystem) and
        exported_by_name (from User.display_name).

        Returns (items, total) tuple.
        """
        base_stmt = (
            select(ExportHistory)
            .join(ExportSystem, ExportHistory.export_system_id == ExportSystem.id)
            .join(User, ExportHistory.exported_by == User.id)
            .where(ExportHistory.project_id == project_id)
        )

        # Total count
        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        total: int = (await db.execute(count_stmt)).scalar_one()

        # Paginated rows with eager columns from joined tables
        rows_stmt = (
            select(
                ExportHistory,
                ExportSystem.system_name,
                User.display_name,
            )
            .join(ExportSystem, ExportHistory.export_system_id == ExportSystem.id)
            .join(User, ExportHistory.exported_by == User.id)
            .where(ExportHistory.project_id == project_id)
            .order_by(ExportHistory.exported_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(rows_stmt)
        rows = result.all()

        items = [
            ExportHistoryResponse(
                id=history.id,
                project_id=history.project_id,
                export_system_id=history.export_system_id,
                system_name=system_name,
                exported_by=history.exported_by,
                exported_by_name=display_name,
                export_type=history.export_type,
                file_count=history.file_count,
                total_rows=history.total_rows,
                exported_at=history.exported_at,
            )
            for history, system_name, display_name in rows
        ]
        return items, total

    @staticmethod
    async def get_all_history(
        db: AsyncSession,
        *,
        offset: int = 0,
        limit: int = 20,
    ) -> tuple[list[ExportHistoryResponse], int]:
        """Return paginated export history across all projects (admin endpoint).

        Each item is enriched with system_name and exported_by_name.

        Returns (items, total) tuple.
        """
        base_stmt = (
            select(ExportHistory)
            .join(ExportSystem, ExportHistory.export_system_id == ExportSystem.id)
            .join(User, ExportHistory.exported_by == User.id)
            .join(Project, ExportHistory.project_id == Project.id)
        )

        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        total: int = (await db.execute(count_stmt)).scalar_one()

        rows_stmt = (
            select(
                ExportHistory,
                ExportSystem.system_name,
                User.display_name,
            )
            .join(ExportSystem, ExportHistory.export_system_id == ExportSystem.id)
            .join(User, ExportHistory.exported_by == User.id)
            .join(Project, ExportHistory.project_id == Project.id)
            .order_by(ExportHistory.exported_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(rows_stmt)
        rows = result.all()

        items = [
            ExportHistoryResponse(
                id=history.id,
                project_id=history.project_id,
                export_system_id=history.export_system_id,
                system_name=system_name,
                exported_by=history.exported_by,
                exported_by_name=display_name,
                export_type=history.export_type,
                file_count=history.file_count,
                total_rows=history.total_rows,
                exported_at=history.exported_at,
            )
            for history, system_name, display_name in rows
        ]
        return items, total
