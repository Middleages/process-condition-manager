"""Create equipments master table and seed initial equipment data.

Creates the equipments table for managing semiconductor photo equipment (scanners)
per production line. Seeds 10 sample equipment records per existing line based on
SCANNER_TOOL_OPTIONS. Clears select_options from EQP name columns since equipment
names will now come from the equipments master table.

Revision ID: 016_create_equipments_table
Revises: 015_eqp_replace_assignments
Create Date: 2026-02-25
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "016_create_equipments_table"
down_revision = "015_eqp_replace_assignments"
branch_labels = None
depends_on = None

# Scanner tool options from seed/columns.py (lines 26-31)
_SCANNER_TOOL_OPTIONS = [
    "NSR-S322F-01", "NSR-S322F-02", "NSR-S322F-03",
    "NSR-S631E-01", "XT-1400E-01",
    "XT-1900Gi-01", "XT-1900Gi-02", "NXT-2000-01",
    "EUV-3400-01", "EUV-3400-02",
]

# Model mapping for equipment names
_EQUIPMENT_MODELS = {
    "NSR-S322F": "NSR-S322F",
    "NSR-S631E": "NSR-S631E",
    "XT-1400E": "XT-1400E",
    "XT-1900Gi": "XT-1900Gi",
    "NXT-2000": "NXT-2000",
    "EUV-3400": "EUV-3400",
}


def _get_model_for_name(name: str) -> str | None:
    """Extract equipment model from equipment name."""
    for prefix, model in _EQUIPMENT_MODELS.items():
        if name.startswith(prefix):
            return model
    return None


def upgrade() -> None:
    # 1. Create equipments table
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

    # 2. Seed initial equipment data: 10 records per existing line
    conn = op.get_bind()
    lines = conn.execute(sa.text("SELECT id FROM lines ORDER BY id")).fetchall()

    for line_row in lines:
        line_id = line_row[0]
        for sort_idx, eqp_name in enumerate(_SCANNER_TOOL_OPTIONS):
            eqp_model = _get_model_for_name(eqp_name)
            conn.execute(
                sa.text(
                    "INSERT INTO equipments (line_id, equipment_name, equipment_model, sort_order) "
                    "VALUES (:line_id, :name, :model, :sort)"
                ),
                {"line_id": line_id, "name": eqp_name, "model": eqp_model, "sort": sort_idx},
            )

    # 3. Clear select_options for EQP name columns (EQP_01..EQP_20, not ET/FOCUS)
    conn.execute(
        sa.text(
            "UPDATE column_definitions SET select_options = NULL "
            "WHERE column_name ~ '^EQP_\\d{2}$'"
        )
    )


def downgrade() -> None:
    # Restore select_options is not feasible since the original values are lost;
    # the seed script would need to re-run to restore them.
    op.drop_index("idx_equipments_active", table_name="equipments")
    op.drop_index("idx_equipments_line_id", table_name="equipments")
    op.drop_table("equipments")
