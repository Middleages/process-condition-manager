"""Add comment_type, resolved_by, project_id to review_comments; make project_layer_id nullable

Revision ID: 004_review_comments
Revises: 003_revision_fields
Create Date: 2026-02-16
"""
from alembic import op
import sqlalchemy as sa

revision = "004_review_comments"
down_revision = "003_revision_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add comment_type column with default value
    op.add_column("review_comments", sa.Column(
        "comment_type", sa.String(20), nullable=False, server_default="general"
    ))

    # Add resolved_by column (nullable, FK to users)
    op.add_column("review_comments", sa.Column(
        "resolved_by", sa.Integer(),
        sa.ForeignKey("users.id"), nullable=True
    ))

    # Add project_id column (nullable, FK to projects)
    op.add_column("review_comments", sa.Column(
        "project_id", sa.Integer(),
        sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    ))

    # Create index for project_id for efficient querying
    op.create_index(
        "idx_review_comments_project_id",
        "review_comments",
        ["project_id"],
    )

    # Make project_layer_id nullable
    # First, we need to check if there are existing records and handle them
    # For SQLite compatibility, we'll handle this differently
    with op.batch_alter_table("review_comments") as batch_op:
        batch_op.alter_column(
            "project_layer_id",
            existing_type=sa.Integer(),
            nullable=True,
        )


def downgrade() -> None:
    # Drop index
    op.drop_index("idx_review_comments_project_id", table_name="review_comments")

    # Make project_layer_id NOT NULL again (assume no NULL values)
    with op.batch_alter_table("review_comments") as batch_op:
        batch_op.alter_column(
            "project_layer_id",
            existing_type=sa.Integer(),
            nullable=False,
        )

    # Drop added columns
    op.drop_column("review_comments", "project_id")
    op.drop_column("review_comments", "resolved_by")
    op.drop_column("review_comments", "comment_type")
