from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.line import Line


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(100))
    # 다중 역할 지원: editor / reviewer / admin / developer
    roles: Mapped[list[str]] = mapped_column(
        ARRAY(String(20)), default=["editor"], server_default="{editor}"
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    password_hash: Mapped[str] = mapped_column(String(255), server_default="")
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)
    # 사용자 소속 라인 (설정 변경 합의 투표 시 사용)
    line_id: Mapped[int | None] = mapped_column(
        ForeignKey("lines.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    line: Mapped["Line | None"] = relationship("Line", foreign_keys=[line_id])

    def has_role(self, role_name: str) -> bool:
        """주어진 역할이 사용자의 역할 목록에 포함되어 있는지 확인."""
        return role_name in (self.roles or [])
