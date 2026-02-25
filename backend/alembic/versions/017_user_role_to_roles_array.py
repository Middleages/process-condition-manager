"""단일 role 컬럼을 다중 역할 roles ARRAY 컬럼으로 마이그레이션.

기존 단일 역할(role VARCHAR(20))을 PostgreSQL ARRAY(VARCHAR(20))로 변환하여
사용자가 여러 역할을 동시에 가질 수 있도록 지원한다.

Revision ID: 017_user_role_to_roles_array
Revises: 016_create_equipments_table
Create Date: 2026-02-25
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision = "017_user_role_to_roles_array"
down_revision = "016_create_equipments_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 1: roles ARRAY 컬럼 추가 (nullable 상태로 시작)
    op.add_column(
        "users",
        sa.Column("roles", ARRAY(sa.String(20)), nullable=True),
    )

    # Step 2: 기존 role 값을 roles 배열로 복사
    op.execute("UPDATE users SET roles = ARRAY[role]")

    # Step 3: NOT NULL 제약조건 + 기본값 설정
    op.alter_column(
        "users",
        "roles",
        nullable=False,
        server_default="{editor}",
    )

    # Step 4: 기존 role 컬럼 삭제
    op.drop_column("users", "role")


def downgrade() -> None:
    # Step 1: role 컬럼 복원
    op.add_column(
        "users",
        sa.Column("role", sa.String(20), nullable=True),
    )

    # Step 2: roles 배열의 첫 번째 요소를 role로 복사
    op.execute("UPDATE users SET role = roles[1]")

    # Step 3: NOT NULL 제약조건 + 기본값 설정
    op.alter_column(
        "users",
        "role",
        nullable=False,
        server_default="editor",
    )

    # Step 4: roles 컬럼 삭제
    op.drop_column("users", "roles")
