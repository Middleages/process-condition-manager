"""설정 변경 합의(Config Change Consensus) 모델.

라인 관리자가 시스템 설정 변경을 요청하고, 모든 라인이 만장일치로
승인해야 개발자가 구현할 수 있는 합의 워크플로우를 관리한다.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime, ForeignKey, Index, String, Text, func, text,
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
    # 개발자 반려 시 사유 및 반려자
    rejected_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True,
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 관계
    requester: Mapped["User"] = relationship("User", foreign_keys=[requested_by])
    implementer: Mapped["User | None"] = relationship("User", foreign_keys=[implemented_by])
    rejector: Mapped["User | None"] = relationship("User", foreign_keys=[rejected_by])
    votes: Mapped[list["ConfigChangeVote"]] = relationship(
        back_populates="request", cascade="all, delete-orphan",
    )


class ConfigChangeVote(Base):
    """설정 변경 투표 테이블.

    요청 생성 시 라인별 투표 슬롯(라인 reviewer용)과
    관리자 투표 슬롯(admin용, line_id=NULL) 1개가 자동 생성된다.
    """
    __tablename__ = "config_change_votes"
    __table_args__ = (
        # 라인 투표: (request_id, line_id) 유니크 (line_id가 NOT NULL인 경우)
        Index(
            "uq_vote_request_line",
            "request_id", "line_id",
            unique=True,
            postgresql_where=text("line_id IS NOT NULL"),
        ),
        # 관리자 투표: request_id당 1개만 (line_id가 NULL인 경우)
        Index(
            "uq_vote_request_admin",
            "request_id",
            unique=True,
            postgresql_where=text("line_id IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("config_change_requests.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 라인 투표: line_id 설정 / 관리자 투표: line_id = NULL
    line_id: Mapped[int | None] = mapped_column(
        ForeignKey("lines.id"), nullable=True,
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
    line: Mapped["Line | None"] = relationship("Line", foreign_keys=[line_id])
    voter: Mapped["User | None"] = relationship("User", foreign_keys=[voted_by])
