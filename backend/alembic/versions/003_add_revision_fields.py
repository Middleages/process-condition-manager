"""Add revision, parent_project_id, is_latest to projects

Revision ID: 003_revision_fields
Revises: 002_add_lines
Create Date: 2026-02-13
"""
from alembic import op
import sqlalchemy as sa

revision = "003_revision_fields"
down_revision = "002_add_lines"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column(
        "revision", sa.Integer(), nullable=False, server_default="1"
    ))
    op.add_column("projects", sa.Column(
        "parent_project_id", sa.Integer(),
        sa.ForeignKey("projects.id"), nullable=True
    ))
    op.add_column("projects", sa.Column(
        "is_latest", sa.Boolean(), nullable=False, server_default=sa.text("true")
    ))

    # Indexes for efficient querying
    op.create_index(
        "idx_projects_product_latest",
        "projects",
        ["product_id", "is_latest"],
        postgresql_where=sa.text("is_latest = true"),
    )
    op.create_index(
        "idx_projects_product_revision",
        "projects",
        ["product_id", sa.text("revision DESC")],
    )

    # Data migration: all existing projects are latest
    op.execute("UPDATE projects SET is_latest = true, revision = 1")


def downgrade() -> None:
    op.drop_index("idx_projects_product_revision", table_name="projects")
    op.drop_index("idx_projects_product_latest", table_name="projects")
    op.drop_column("projects", "is_latest")
    op.drop_column("projects", "parent_project_id")
    op.drop_column("projects", "revision")
