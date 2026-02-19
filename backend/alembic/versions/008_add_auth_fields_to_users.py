"""users 테이블에 password_hash, email 컬럼 추가

Revision ID: 008_add_auth_fields_to_users
Revises: 007_add_revision_reason
Create Date: 2026-02-19
"""
from alembic import op
import sqlalchemy as sa

revision = "008_add_auth_fields_to_users"
down_revision = "007_add_revision_reason"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # password_hash 컬럼 추가 (NOT NULL, 기본값 빈 문자열)
    op.add_column(
        "users",
        sa.Column("password_hash", sa.String(255), nullable=False, server_default=""),
    )
    # email 컬럼 추가 (nullable, unique)
    op.add_column(
        "users",
        sa.Column("email", sa.String(255), nullable=True),
    )
    op.create_unique_constraint("uq_users_email", "users", ["email"])


def downgrade() -> None:
    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.drop_column("users", "email")
    op.drop_column("users", "password_hash")
