"""Rename project tables to process-condition table names.

Revision ID: 029_rename_project_tables_to_process_condition
Revises: 028_add_process_condition_backbone_refs
Create Date: 2026-04-09
"""

from alembic import op

revision = "029_rename_project_tables_to_process_condition"
down_revision = "028_add_process_condition_backbone_refs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("projects", "process_conditions")
    op.rename_table("project_layers", "process_condition_layers")
    op.rename_table("project_status_logs", "process_condition_status_logs")


def downgrade() -> None:
    op.rename_table("process_condition_status_logs", "project_status_logs")
    op.rename_table("process_condition_layers", "project_layers")
    op.rename_table("process_conditions", "projects")
