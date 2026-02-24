"""Drop is_backbone column from products table.

Backbone eligibility is now determined dynamically by checking whether a
product has an Approved project with is_latest=True (via BackboneRepository).
The static is_backbone flag is no longer needed and is removed in this migration.

Revision ID: 014_drop_is_backbone_column
Revises: 013_backbone_lookup_idx
Create Date: 2026-02-22
"""
import sqlalchemy as sa
from alembic import op

revision = "014_drop_is_backbone_column"
down_revision = "013_backbone_lookup_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("products", "is_backbone")


def downgrade() -> None:
    # Restore the column as nullable so existing rows are not affected.
    # All restored rows will have NULL (treated as False in application code).
    op.add_column(
        "products",
        sa.Column(
            "is_backbone",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
    )
