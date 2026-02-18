from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.product import Product
    from app.models.user import User


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    main_backbone_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft / review / approved / rejected / archived
    revision: Mapped[int] = mapped_column(Integer, default=1)
    parent_project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    is_latest: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 개정 생성 시 작성자가 입력한 개정 사유 (선택 입력)
    revision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    product: Mapped["Product"] = relationship(foreign_keys=[product_id])
    backbone: Mapped["Product"] = relationship(foreign_keys=[main_backbone_id])
    parent_project: Mapped["Project | None"] = relationship(
        remote_side="Project.id", foreign_keys=[parent_project_id]
    )
    creator: Mapped["User"] = relationship(foreign_keys=[created_by])
    reviewer: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by])
    layers: Mapped[list["ProjectLayer"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class ProjectLayer(Base):
    __tablename__ = "project_layers"
    __table_args__ = (UniqueConstraint("project_id", "layer_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    layer_id: Mapped[int] = mapped_column(ForeignKey("layers.id"))
    backbone_product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    conditions: Mapped[dict] = mapped_column(JSONB, default=dict)
    backbone_conditions: Mapped[dict] = mapped_column(JSONB, default=dict)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    project: Mapped["Project"] = relationship(back_populates="layers")
    layer: Mapped["Layer"] = relationship()
    backbone_product: Mapped["Product | None"] = relationship(foreign_keys=[backbone_product_id])
