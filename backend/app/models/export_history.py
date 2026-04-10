from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ExportHistory(Base):
    """Tracks every export download for audit and analytics purposes."""

    __tablename__ = "export_histories"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("process_conditions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    export_system_id: Mapped[int] = mapped_column(
        ForeignKey("export_systems.id", ondelete="RESTRICT"),
        nullable=False,
    )
    exported_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    export_type: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
    )  # 'single' or 'bulk'
    file_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    total_rows: Mapped[int] = mapped_column(Integer, nullable=False)
    exported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        Index("idx_export_histories_project_exported_at", "project_id", "exported_at"),
    )
