from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.line import Line


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    line_id: Mapped[int | None] = mapped_column(ForeignKey("lines.id"), nullable=True, index=True)
    part_id: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    line: Mapped["Line | None"] = relationship()
    layers: Mapped[list["ProductLayer"]] = relationship(back_populates="product", cascade="all, delete-orphan")


class Layer(Base):
    __tablename__ = "layers"

    id: Mapped[int] = mapped_column(primary_key=True)
    layer_name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    step_seq: Mapped[str] = mapped_column(String(10), unique=True, index=True)  # 설비 식별자 (예: ac100000)
    layer_number: Mapped[str] = mapped_column(String(10), unique=True)  # 레이어 번호 (예: 15.7)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProductLayer(Base):
    __tablename__ = "product_layers"
    __table_args__ = (UniqueConstraint("product_id", "layer_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    layer_id: Mapped[int] = mapped_column(ForeignKey("layers.id", ondelete="CASCADE"))
    conditions: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    product: Mapped["Product"] = relationship(back_populates="layers")
    layer: Mapped["Layer"] = relationship()
