from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ExportDataSource(Base):
    """External data source that can be linked to PCM export data."""

    __tablename__ = "export_data_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_name: Mapped[str] = mapped_column(String(100), unique=True)
    table_name: Mapped[str] = mapped_column(String(200))
    schema_name: Mapped[str] = mapped_column(String(50), server_default="public")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    join_key_mappings: Mapped[list] = mapped_column(JSONB)  # [{external_column, pcm_field}]
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
