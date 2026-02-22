"""Add partial index for backbone lookup queries on projects table.

The partial index ix_projects_backbone_lookup covers projects where
status='approved' AND is_latest=true. This accelerates the common query
pattern used by BackboneRepository to find the canonical backbone project
for a given product_id.

Revision ID: 013_add_backbone_lookup_partial_index
Revises: 012_extend_ecm_for_ext_sources
Create Date: 2026-02-22
"""
import sqlalchemy as sa
from alembic import op

revision = "013_backbone_lookup_idx"
down_revision = "012_extend_ecm_for_ext_sources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Partial index: only approved + latest projects are indexed.
    # This is far smaller than a full index and covers the hot path used
    # by BackboneRepository.get_approved_project_for_product().
    op.create_index(
        "ix_projects_backbone_lookup",
        "projects",
        ["product_id", "status", "is_latest"],
        postgresql_where=sa.text("status = 'approved' AND is_latest = true"),
    )


def downgrade() -> None:
    op.drop_index("ix_projects_backbone_lookup", table_name="projects")
