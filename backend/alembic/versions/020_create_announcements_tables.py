"""공지사항(announcements) 및 읽음 처리(announcement_reads) 테이블 생성.

Revision ID: 020_create_announcements_tables
Revises: 019_add_device_ref_to_projects
Create Date: 2026-03-02
"""

import sqlalchemy as sa
from alembic import op

revision = "020_create_announcements_tables"
down_revision = "019_add_device_ref_to_projects"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. announcements 테이블
    # ------------------------------------------------------------------
    op.create_table(
        "announcements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("category", sa.String(20), nullable=False, server_default="general"),
        sa.Column("priority", sa.String(20), nullable=False, server_default="normal"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # 인덱스: 활성 공지 필터링, 생성일 정렬
    op.create_index("ix_announcements_is_active", "announcements", ["is_active"])
    op.create_index("ix_announcements_created_at", "announcements", ["created_at"])

    # ------------------------------------------------------------------
    # 2. announcement_reads 테이블
    # ------------------------------------------------------------------
    op.create_table(
        "announcement_reads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "announcement_id",
            sa.Integer(),
            sa.ForeignKey("announcements.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("announcement_id", "user_id", name="uq_announcement_read_user"),
    )

    # 인덱스: 사용자별 읽음 조회 최적화
    op.create_index("ix_announcement_reads_user_id", "announcement_reads", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_announcement_reads_user_id", table_name="announcement_reads")
    op.drop_table("announcement_reads")
    op.drop_index("ix_announcements_created_at", table_name="announcements")
    op.drop_index("ix_announcements_is_active", table_name="announcements")
    op.drop_table("announcements")
