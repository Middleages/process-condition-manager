from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.column import ColumnDefinition
    from app.models.export_data_source import ExportDataSource


class ExportSystem(Base):
    __tablename__ = "export_systems"

    id: Mapped[int] = mapped_column(primary_key=True)
    system_name: Mapped[str] = mapped_column(String(100), unique=True)
    format_type: Mapped[str] = mapped_column(String(10))  # TYPE_A / TYPE_B / TYPE_C
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    additional_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    column_mappings: Mapped[list["ExportColumnMapping"]] = relationship(back_populates="export_system", cascade="all, delete-orphan")


class ExportColumnMapping(Base):
    __tablename__ = "export_column_mappings"

    id: Mapped[int] = mapped_column(primary_key=True)
    export_system_id: Mapped[int] = mapped_column(ForeignKey("export_systems.id", ondelete="CASCADE"))
    # source_type determines which source the data comes from: 'condition' or 'external'
    source_type: Mapped[str] = mapped_column(String(20), server_default="condition")
    # For source_type='condition': column_id is required, data_source_id/source_column_name are NULL
    column_id: Mapped[int | None] = mapped_column(ForeignKey("column_definitions.id"), nullable=True)
    # For source_type='external': data_source_id + source_column_name are required, column_id is NULL
    data_source_id: Mapped[int | None] = mapped_column(
        ForeignKey("export_data_sources.id", ondelete="SET NULL"), nullable=True
    )
    source_column_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    target_column_name: Mapped[str] = mapped_column(String(100))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)

    export_system: Mapped["ExportSystem"] = relationship(back_populates="column_mappings")
    column_definition: Mapped["ColumnDefinition | None"] = relationship()
    data_source: Mapped["ExportDataSource | None"] = relationship()


class RecipeXmlMapping(Base):
    __tablename__ = "recipe_xml_mappings"

    id: Mapped[int] = mapped_column(primary_key=True)
    xpath: Mapped[str] = mapped_column(String(300))
    column_id: Mapped[int] = mapped_column(ForeignKey("column_definitions.id"))
    value_transform: Mapped[str | None] = mapped_column(String(50), nullable=True)  # to_int, to_float, yn_to_bool
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


