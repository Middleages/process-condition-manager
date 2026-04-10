"""Add part_id to step_current and optimize process/part lookup.

Revision ID: 027_add_part_id_to_step_current_and_indexes
Revises: 026_create_step_master_ingestion_tables
Create Date: 2026-04-09
"""

import sqlalchemy as sa
from alembic import op

revision = "027_add_part_id_to_step_current_and_indexes"
down_revision = "026_create_step_master_ingestion_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("step_current", sa.Column("part_id", sa.String(length=100), nullable=True))

    op.drop_constraint("uq_step_current_line_process_step", "step_current", type_="unique")
    op.create_unique_constraint(
        "uq_step_current_line_process_part_step",
        "step_current",
        ["line_id", "process_id", "part_id", "step_seq"],
    )

    op.create_index(
        "idx_step_current_line_process_part",
        "step_current",
        ["line_id", "process_id", "part_id"],
    )
    op.create_index(
        "idx_step_current_line_process_part_layer_step",
        "step_current",
        ["line_id", "process_id", "part_id", "layer_id", "step_seq"],
    )


def downgrade() -> None:
    op.drop_index("idx_step_current_line_process_part_layer_step", table_name="step_current")
    op.drop_index("idx_step_current_line_process_part", table_name="step_current")

    op.drop_constraint("uq_step_current_line_process_part_step", "step_current", type_="unique")
    op.create_unique_constraint(
        "uq_step_current_line_process_step",
        "step_current",
        ["line_id", "process_id", "step_seq"],
    )

    op.drop_column("step_current", "part_id")
