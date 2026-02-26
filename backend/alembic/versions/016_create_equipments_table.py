"""Create equipments master table.

Revision ID: 016_create_equipments_table
Revises: 015_eqp_replace_assignments
Create Date: 2026-02-25
"""
import sqlalchemy as sa
from alembic import op

revision = "016_create_equipments_table"
down_revision = "015_eqp_replace_assignments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "equipments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("line_id", sa.Integer(), sa.ForeignKey("lines.id", ondelete="CASCADE"), nullable=False),
        sa.Column("equipment_name", sa.String(100), nullable=False),
        sa.Column("equipment_model", sa.String(100), nullable=True),
        sa.Column("prc", sa.String(50), nullable=True),
        sa.Column("ip", sa.String(45), nullable=True),
        sa.Column("ftp_id", sa.String(100), nullable=True),
        sa.Column("ftp_pw", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("line_id", "equipment_name", name="uq_equipments_line_name"),
    )
    op.create_index("idx_equipments_line_id", "equipments", ["line_id"])
    op.create_index(
        "idx_equipments_active",
        "equipments",
        ["line_id", "is_active"],
        postgresql_where=sa.text("is_active = true"),
    )


def downgrade() -> None:
    op.drop_index("idx_equipments_active", table_name="equipments")
    op.drop_index("idx_equipments_line_id", table_name="equipments")
    op.drop_table("equipments")
