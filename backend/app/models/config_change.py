"""설정 변경 합의(Config Change Consensus) 모델.

라인 관리자가 시스템 설정 변경을 요청하고, 모든 라인이 만장일치로
승인해야 개발자가 구현할 수 있는 합의 워크플로우를 관리한다.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime, ForeignKey, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.line import Line
    from app.models.user import User


class ConfigChangeRequest(Base):
    """설정 변경 요청 테이블."""
    __tablename__ = "config_change_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    # 변경 유형: column_add / column_modify / validation_change
    change_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # 요청 상태: pending / approved / rejected / in_progress / completed / cancelled
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    requested_by: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False,
    )
    implemented_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    # 관계
    requester: Mapped["User"] = relationship("User", foreign_keys=[requested_by])
    implementer: Mapped["User | None"] = relationship("User", foreign_keys=[implemented_by])
    votes: Mapped[list["ConfigChangeVote"]] = relationship(
        back_populates="request", cascade="all, delete-orphan",
    )


class ConfigChangeVote(Base):
    """설정 변경 투표 테이블.

    요청 생성 시 모든 라인에 대해 자동 생성되며,
    각 라인의 reviewer/admin 이 승인 또는 반려 투표를 한다.
    """
    __tablename__ = "config_change_votes"
    __table_args__ = (
        UniqueConstraint("request_id", "line_id", name="uq_config_change_vote_request_line"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("config_change_requests.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    line_id: Mapped[int] = mapped_column(
        ForeignKey("lines.id"), nullable=False,
    )
    # 투표: approve / reject / null(미투표)
    vote: Mapped[str | None] = mapped_column(String(10), nullable=True)
    voted_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True,
    )
    # 반려 시 사유 필수, 승인 시 선택
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    voted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    # 관계
    request: Mapped["ConfigChangeRequest"] = relationship(back_populates="votes")
    line: Mapped["Line"] = relationship("Line", foreign_keys=[line_id])
    voter: Mapped["User | None"] = relationship("User", foreign_keys=[voted_by])
