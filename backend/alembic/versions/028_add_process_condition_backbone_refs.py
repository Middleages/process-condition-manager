"""Add process-condition backbone reference columns.

Revision ID: 028_add_process_condition_backbone_refs
Revises: 027_add_part_id_to_step_current_and_indexes
Create Date: 2026-04-09
"""

import sqlalchemy as sa
from alembic import op

revision = "028_add_process_condition_backbone_refs"
down_revision = "027_add_part_id_to_step_current_and_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("main_backbone_condition_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_projects_main_backbone_condition_id_projects",
        "projects",
        "projects",
        ["main_backbone_condition_id"],
        ["id"],
    )
    op.create_index(
        "ix_projects_main_backbone_condition_id",
        "projects",
        ["main_backbone_condition_id"],
    )

    op.add_column(
        "project_layers",
        sa.Column("backbone_source_condition_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_project_layers_backbone_source_condition_id_projects",
        "project_layers",
        "projects",
        ["backbone_source_condition_id"],
        ["id"],
    )
    op.create_index(
        "ix_project_layers_backbone_source_condition_id",
        "project_layers",
        ["backbone_source_condition_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_project_layers_backbone_source_condition_id",
        table_name="project_layers",
    )
    op.drop_constraint(
        "fk_project_layers_backbone_source_condition_id_projects",
        "project_layers",
        type_="foreignkey",
    )
    op.drop_column("project_layers", "backbone_source_condition_id")

    op.drop_index(
        "ix_projects_main_backbone_condition_id",
        table_name="projects",
    )
    op.drop_constraint(
        "fk_projects_main_backbone_condition_id_projects",
        "projects",
        type_="foreignkey",
    )
    op.drop_column("projects", "main_backbone_condition_id")
