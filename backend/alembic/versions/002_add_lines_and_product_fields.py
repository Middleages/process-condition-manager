"""Add lines table and product line_id/part_id fields

Revision ID: 002_add_lines
Revises: 001_initial
Create Date: 2026-02-12
"""
from alembic import op
import sqlalchemy as sa

revision = "002_add_lines"
down_revision = "001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create lines table
    op.create_table(
        "lines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("line_code", sa.String(50), unique=True, nullable=False),
        sa.Column("line_name", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_lines_line_code", "lines", ["line_code"])

    # Add columns to products
    op.add_column("products", sa.Column(
        "line_id", sa.Integer(), sa.ForeignKey("lines.id"), nullable=True
    ))
    op.add_column("products", sa.Column(
        "part_id", sa.String(100), nullable=True, unique=True
    ))
    op.create_index("ix_products_line_id", "products", ["line_id"])


def downgrade() -> None:
    op.drop_index("ix_products_line_id", table_name="products")
    op.drop_column("products", "part_id")
    op.drop_column("products", "line_id")
    op.drop_index("ix_lines_line_code", table_name="lines")
    op.drop_table("lines")
