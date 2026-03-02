"""설정 변경 합의(Config Change Consensus) 테이블 생성 및 users.line_id 추가.

Revision ID: 021_add_config_change_consensus
Revises: 020_create_announcements_tables
Create Date: 2026-03-02
"""

import sqlalchemy as sa
from alembic import op

revision = "021_add_config_change_consensus"
down_revision = "020_create_announcements_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. users 테이블에 line_id 컬럼 추가
    # ------------------------------------------------------------------
    op.add_column(
        "users",
        sa.Column(
            "line_id", sa.Integer(),
            sa.ForeignKey("lines.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_users_line_id", "users", ["line_id"])

    # ------------------------------------------------------------------
    # 2. config_change_requests 테이블
    # ------------------------------------------------------------------
    op.create_table(
        "config_change_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("change_type", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "requested_by", sa.Integer(),
            sa.ForeignKey("users.id"), nullable=False,
        ),
        sa.Column(
            "implemented_by", sa.Integer(),
            sa.ForeignKey("users.id"), nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index(
        "ix_config_change_requests_status",
        "config_change_requests", ["status"],
    )
    op.create_index(
        "ix_config_change_requests_requested_by",
        "config_change_requests", ["requested_by"],
    )

    # ------------------------------------------------------------------
    # 3. config_change_votes 테이블
    # ------------------------------------------------------------------
    op.create_table(
        "config_change_votes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "request_id", sa.Integer(),
            sa.ForeignKey("config_change_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "line_id", sa.Integer(),
            sa.ForeignKey("lines.id"), nullable=False,
        ),
        sa.Column("vote", sa.String(10), nullable=True),
        sa.Column(
            "voted_by", sa.Integer(),
            sa.ForeignKey("users.id"), nullable=True,
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("voted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "request_id", "line_id",
            name="uq_config_change_vote_request_line",
        ),
    )

    op.create_index(
        "ix_config_change_votes_request_id",
        "config_change_votes", ["request_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_config_change_votes_request_id", table_name="config_change_votes")
    op.drop_table("config_change_votes")

    op.drop_index("ix_config_change_requests_requested_by", table_name="config_change_requests")
    op.drop_index("ix_config_change_requests_status", table_name="config_change_requests")
    op.drop_table("config_change_requests")

    op.drop_index("ix_users_line_id", table_name="users")
    op.drop_column("users", "line_id")
