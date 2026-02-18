"""Add equipment_assignments table for Type B export scanner assignments

Revision ID: 005_equipment_assignments
Revises: 004_review_comments
Create Date: 2026-02-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "005_equipment_assignments"
down_revision = "004_review_comments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "equipment_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "project_layer_id",
            sa.Integer(),
            sa.ForeignKey("project_layers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("equipment_id", sa.String(50), nullable=False),
        sa.Column("equipment_params", JSONB(), nullable=True, server_default="{}"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "idx_equipment_assignments_project_layer_id",
        "equipment_assignments",
        ["project_layer_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_equipment_assignments_project_layer_id",
        table_name="equipment_assignments",
    )
    op.drop_table("equipment_assignments")
