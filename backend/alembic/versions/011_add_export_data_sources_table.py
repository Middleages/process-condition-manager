"""Add export_data_sources table for external data source registration

Revision ID: 011_export_data_sources
Revises: 010_ovl_ref_layer_not_required
Create Date: 2026-02-20
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "011_export_data_sources"
down_revision = "010_ovl_ref_layer_not_required"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "export_data_sources",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_name", sa.String(length=100), nullable=False),
        sa.Column("table_name", sa.String(length=200), nullable=False),
        sa.Column("schema_name", sa.String(length=50), server_default="public", nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("join_key_mappings", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, default=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_name"),
    )
    op.create_index(
        op.f("ix_export_data_sources_source_name"),
        "export_data_sources",
        ["source_name"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_export_data_sources_source_name"),
        table_name="export_data_sources",
    )
    op.drop_table("export_data_sources")
