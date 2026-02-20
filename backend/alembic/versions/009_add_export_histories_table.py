"""Add export_histories table for tracking export downloads

Revision ID: 009_add_export_histories_table
Revises: 008_add_auth_fields_to_users
Create Date: 2026-02-20
"""
from alembic import op
import sqlalchemy as sa


revision = "009_add_export_histories_table"
down_revision = "008_add_auth_fields_to_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "export_histories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "export_system_id",
            sa.Integer(),
            sa.ForeignKey("export_systems.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "exported_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("export_type", sa.String(10), nullable=False),
        sa.Column("file_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("total_rows", sa.Integer(), nullable=False),
        sa.Column(
            "exported_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Composite index on (project_id, exported_at) for efficient querying
    op.create_index(
        "idx_export_histories_project_exported_at",
        "export_histories",
        ["project_id", "exported_at"],
    )

    # Single-column index on project_id for FK lookups
    op.create_index(
        "idx_export_histories_project_id",
        "export_histories",
        ["project_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_export_histories_project_id", table_name="export_histories")
    op.drop_index(
        "idx_export_histories_project_exported_at", table_name="export_histories"
    )
    op.drop_table("export_histories")
