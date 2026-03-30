"""rename users.username to userid and drop display_name

Revision ID: 025_users_userid_and_drop_display_name
Revises: 024_add_sso_user_fields
Create Date: 2026-03-30

Data-loss notice:
- This migration permanently drops `users.display_name`.
- Run backup script `backend/scripts/backup_users_display_name.sql` before upgrade if you need rollback-safe archival.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "025_users_userid_and_drop_display_name"
down_revision = "024_add_sso_user_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            RAISE NOTICE 'users.display_name column will be dropped. Run backup_users_display_name.sql before applying if archival is needed.';
        END $$;
        """
    )

    op.alter_column("users", "username", new_column_name="userid", existing_type=sa.String(length=50))
    op.drop_column("users", "display_name")

    op.execute("ALTER INDEX IF EXISTS ix_users_username RENAME TO ix_users_userid")
    op.execute("ALTER INDEX IF EXISTS users_username_key RENAME TO users_userid_key")


def downgrade() -> None:
    op.alter_column("users", "userid", new_column_name="username", existing_type=sa.String(length=50))

    op.add_column(
        "users",
        sa.Column("display_name", sa.String(length=100), nullable=False, server_default=""),
    )
    op.execute("UPDATE users SET display_name = username WHERE display_name = ''")

    op.execute("ALTER INDEX IF EXISTS ix_users_userid RENAME TO ix_users_username")
    op.execute("ALTER INDEX IF EXISTS users_userid_key RENAME TO users_username_key")
