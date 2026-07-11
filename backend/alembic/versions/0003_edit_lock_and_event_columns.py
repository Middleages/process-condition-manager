"""edit_lock table and change_event cell columns

Revision ID: 0003
Revises: 0002
Create Date: Phase 2 T5

edit_lock(프로젝트당 1잠금, P2-D6 lock_token 포함) 생성 +
change_event 셀 단위 구조화 컬럼(P2-D7) 4개 추가.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "edit_lock",
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("project.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("locked_by", sa.String(length=128), nullable=False),
        sa.Column("lock_token", sa.String(length=64), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )

    # change_event 셀 단위 구조화 컬럼 (P2-D7) — 전부 nullable, 벌크 이벤트는 payload 사용.
    op.add_column("change_event", sa.Column("condition_id", sa.Integer(), nullable=True))
    op.add_column(
        "change_event", sa.Column("parameter_code", sa.String(length=64), nullable=True)
    )
    op.add_column("change_event", sa.Column("old_value", sa.Text(), nullable=True))
    op.add_column("change_event", sa.Column("new_value", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("change_event", "new_value")
    op.drop_column("change_event", "old_value")
    op.drop_column("change_event", "parameter_code")
    op.drop_column("change_event", "condition_id")
    op.drop_table("edit_lock")
