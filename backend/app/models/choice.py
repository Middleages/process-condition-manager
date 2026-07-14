"""Reusable managed ChoiceSet aggregate."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class ChoiceSet(Base):
    __tablename__ = "choice_set"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    options: Mapped[list["ChoiceOption"]] = relationship(
        back_populates="choice_set",
        cascade="all, delete-orphan",
        order_by=lambda: (ChoiceOption.sort_order, ChoiceOption.code),
    )
class ChoiceOption(Base):
    __tablename__ = "choice_option"
    __table_args__ = (
        UniqueConstraint("choice_set_id", "code", name="uq_choice_option_set_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    choice_set_id: Mapped[int] = mapped_column(
        ForeignKey("choice_set.id", ondelete="CASCADE"), index=True
    )
    code: Mapped[str] = mapped_column(String(128))
    label: Mapped[str] = mapped_column(String(128))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    choice_set: Mapped[ChoiceSet] = relationship(back_populates="options")
