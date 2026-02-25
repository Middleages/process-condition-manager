"""Equipment (scanner) master data model."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Equipment(Base):
    __tablename__ = "equipments"
    __table_args__ = (
        UniqueConstraint("line_id", "equipment_name", name="uq_equipments_line_name"),
        Index("idx_equipments_line_id", "line_id"),
        Index("idx_equipments_active", "line_id", "is_active", postgresql_where="is_active = true"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    line_id: Mapped[int] = mapped_column(ForeignKey("lines.id", ondelete="CASCADE"), nullable=False)
    equipment_name: Mapped[str] = mapped_column(String(100), nullable=False)
    equipment_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    prc: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    ftp_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ftp_pw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    line: Mapped["Line"] = relationship()
