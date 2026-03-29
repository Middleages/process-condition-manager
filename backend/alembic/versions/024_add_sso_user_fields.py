"""add sso user fields

Revision ID: 024_add_sso_user_fields
Revises: 023_add_developer_rejection_fields
Create Date: 2026-03-27
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "024_add_sso_user_fields"
down_revision = "023_add_developer_rejection_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("department", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("last_login_ip", sa.String(length=50), nullable=True))
    op.alter_column("users", "display_name", server_default="")


def downgrade() -> None:
    op.alter_column("users", "display_name", server_default=None)
    op.drop_column("users", "last_login_ip")
    op.drop_column("users", "department")
