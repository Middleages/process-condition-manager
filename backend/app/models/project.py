from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    main_backbone_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft / review / approved / rejected
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    product: Mapped["Product"] = relationship(foreign_keys=[product_id])
    backbone: Mapped["Product"] = relationship(foreign_keys=[main_backbone_id])
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


# 순환 import 방지
from app.models.product import Product  # noqa: E402
from app.models.user import User  # noqa: E402
