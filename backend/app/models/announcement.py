"""공지사항(Announcement) 모델.

사용자 대상 공지사항과 읽음 처리를 관리한다.
"""
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Announcement(Base):
    """공지사항 테이블."""
    __tablename__ = "announcements"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 카테고리: bug_fix / new_feature / rule_change / general
    category: Mapped[str] = mapped_column(String(20), default="general", server_default="general")
    # 우선순위: normal / important / critical
    priority: Mapped[str] = mapped_column(String(20), default="normal", server_default="normal")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AnnouncementRead(Base):
    """공지사항 읽음 처리 테이블."""
    __tablename__ = "announcement_reads"
    __table_args__ = (
        UniqueConstraint("announcement_id", "user_id", name="uq_announcement_read_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    announcement_id: Mapped[int] = mapped_column(
        ForeignKey("announcements.id", ondelete="CASCADE"), nullable=False,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
