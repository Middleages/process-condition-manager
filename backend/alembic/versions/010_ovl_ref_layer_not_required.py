"""Make OVL_REF_LAYER not required (first layer may have no OVL reference)

Revision ID: 010_ovl_ref_layer_not_required
Revises: 009_add_export_histories_table
Create Date: 2026-02-20
"""
from alembic import op


revision = "010_ovl_ref_layer_not_required"
down_revision = "009_add_export_histories_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE column_definitions SET is_required = false "
        "WHERE column_name = 'OVL_REF_LAYER'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE column_definitions SET is_required = true "
        "WHERE column_name = 'OVL_REF_LAYER'"
    )
