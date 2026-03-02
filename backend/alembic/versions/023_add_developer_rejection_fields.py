"""개발자 반려 필드 추가 (rejected_by, rejection_reason).

승인된 요청을 개발자가 반려할 수 있도록
config_change_requests 테이블에 반려자/사유 컬럼을 추가한다.

Revision ID: 023_add_developer_rejection_fields
Revises: 022_change_vote_to_role_based
Create Date: 2026-03-02
"""

import sqlalchemy as sa
from alembic import op

revision = "023_add_developer_rejection_fields"
down_revision = "022_change_vote_to_role_based"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "config_change_requests",
        sa.Column(
            "rejected_by",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "config_change_requests",
        sa.Column("rejection_reason", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("config_change_requests", "rejection_reason")
    op.drop_column("config_change_requests", "rejected_by")
