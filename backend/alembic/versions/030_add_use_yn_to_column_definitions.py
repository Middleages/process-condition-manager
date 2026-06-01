"""Add use_yn flag to column_definitions for staged rollout (pre-register + open later).

Revision ID: 030_add_use_yn_to_column_definitions
Revises: 029_rename_project_tables_to_process_condition
Create Date: 2026-06-01
"""
import sqlalchemy as sa
from alembic import op


revision = "030_add_use_yn_to_column_definitions"
down_revision = "029_rename_project_tables_to_process_condition"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) NULL 허용으로 컬럼 추가 (기본값 FALSE)
    op.add_column(
        "column_definitions",
        sa.Column("use_yn", sa.Boolean(), nullable=True, server_default=sa.false()),
    )
    # 2) 기존 row는 TRUE로 백필 (이미 사용 중인 컬럼은 공개 유지)
    op.execute("UPDATE column_definitions SET use_yn = TRUE WHERE use_yn IS NULL")
    # 3) NOT NULL 제약 적용 + 신규 row 기본값은 FALSE (등록 즉시 비공개)
    op.alter_column("column_definitions", "use_yn", nullable=False)


def downgrade() -> None:
    op.drop_column("column_definitions", "use_yn")
