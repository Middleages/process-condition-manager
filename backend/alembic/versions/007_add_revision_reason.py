"""projects 테이블에 revision_reason 컬럼 추가

Revision ID: 007_add_revision_reason
Revises: 006_cleanup_changelogs
Create Date: 2026-02-18
"""
from alembic import op
import sqlalchemy as sa

revision = "007_add_revision_reason"
down_revision = "006_cleanup_changelogs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # revision_reason 컬럼 추가 (nullable TEXT)
    op.add_column(
        "projects",
        sa.Column("revision_reason", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    # revision_reason 컬럼 제거
    op.drop_column("projects", "revision_reason")
