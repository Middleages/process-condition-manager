"""Extend export_column_mappings table to support external data sources

Adds source_type, data_source_id, source_column_name columns and makes
column_id nullable to support both condition-based and external-source mappings.

Revision ID: 012_extend_export_column_mappings
Revises: 011_export_data_sources
Create Date: 2026-02-20
"""
import sqlalchemy as sa
from alembic import op

revision = "012_extend_ecm_for_ext_sources"
down_revision = "011_export_data_sources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add source_type column with DEFAULT 'condition'
    op.add_column(
        "export_column_mappings",
        sa.Column(
            "source_type",
            sa.String(length=20),
            nullable=False,
            server_default="condition",
        ),
    )

    # 2. Add data_source_id nullable FK -> export_data_sources.id
    op.add_column(
        "export_column_mappings",
        sa.Column("data_source_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_export_column_mappings_data_source_id",
        "export_column_mappings",
        "export_data_sources",
        ["data_source_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 3. Add source_column_name nullable column
    op.add_column(
        "export_column_mappings",
        sa.Column("source_column_name", sa.String(length=200), nullable=True),
    )

    # 4. Alter column_id from NOT NULL to nullable
    op.alter_column(
        "export_column_mappings",
        "column_id",
        existing_type=sa.Integer(),
        nullable=True,
    )

    # 5. Existing rows already have source_type='condition' via server_default
    #    and column_id set (NOT NULL before this migration), so no data migration needed.

    # 6. Add CHECK constraint ensuring data integrity between source types
    op.create_check_constraint(
        "ck_export_column_mappings_source_type",
        "export_column_mappings",
        "(source_type = 'condition' AND column_id IS NOT NULL AND data_source_id IS NULL) "
        "OR (source_type = 'external' AND data_source_id IS NOT NULL "
        "AND source_column_name IS NOT NULL AND column_id IS NULL)",
    )


def downgrade() -> None:
    # Drop CHECK constraint first
    op.drop_constraint(
        "ck_export_column_mappings_source_type",
        "export_column_mappings",
        type_="check",
    )

    # Restore column_id to NOT NULL (only safe if all rows have column_id set)
    op.alter_column(
        "export_column_mappings",
        "column_id",
        existing_type=sa.Integer(),
        nullable=False,
    )

    # Drop source_column_name
    op.drop_column("export_column_mappings", "source_column_name")

    # Drop FK and data_source_id
    op.drop_constraint(
        "fk_export_column_mappings_data_source_id",
        "export_column_mappings",
        type_="foreignkey",
    )
    op.drop_column("export_column_mappings", "data_source_id")

    # Drop source_type
    op.drop_column("export_column_mappings", "source_type")
