"""project and backbone tables

Revision ID: 0002
Revises: 0001
Create Date: Phase 1 T1
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# change_event.payload: PostgreSQL은 JSONB, 그 외는 JSON.
_JSON_PAYLOAD = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("line_id", sa.String(length=64), nullable=False),
        sa.Column("process_id", sa.String(length=128), nullable=False),
        sa.Column("part_id", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("description", sa.String(length=1024), nullable=True),
        sa.Column(
            "status",
            sa.Enum("draft", name="project_status", native_enum=False, length=32),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("line_id", "process_id", "part_id", name="uq_project_process_part"),
    )
    op.create_index("ix_project_line_id", "project", ["line_id"])
    op.create_index("ix_project_process_id", "project", ["process_id"])
    op.create_index("ix_project_part_id", "project", ["part_id"])

    op.create_table(
        "sheet_layer",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id", ondelete="CASCADE")),
        sa.Column("layer_key", sa.String(length=256), nullable=False),
        sa.Column("step_seq", sa.String(length=64), nullable=False),
        sa.Column("layer_id", sa.String(length=64), nullable=False),
        sa.Column("eqp_type", sa.String(length=128), nullable=True),
        sa.Column("eqp_type_desc", sa.String(length=256), nullable=True),
        sa.Column("area_name", sa.String(length=128), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source_project_id", sa.Integer(), nullable=True),
        sa.Column("source_layer_key", sa.String(length=256), nullable=True),
        sa.UniqueConstraint("project_id", "layer_key", name="uq_sheet_layer_key"),
    )
    op.create_index("ix_sheet_layer_project_id", "sheet_layer", ["project_id"])
    op.create_index("ix_sheet_layer_step_seq", "sheet_layer", ["step_seq"])
    op.create_index("ix_sheet_layer_layer_id", "sheet_layer", ["layer_id"])

    op.create_table(
        "layer_condition",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("layer_id", sa.Integer(), sa.ForeignKey("sheet_layer.id", ondelete="CASCADE")),
        sa.Column("label", sa.String(length=128), nullable=False, server_default="base"),
        sa.Column("condition_index", sa.Integer(), nullable=False),
        sa.Column("is_por", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("source_condition_id", sa.Integer(), nullable=True),
        sa.UniqueConstraint("layer_id", "condition_index", name="uq_condition_index"),
    )
    op.create_index("ix_layer_condition_layer_id", "layer_condition", ["layer_id"])
    op.create_index(
        "uq_layer_condition_por",
        "layer_condition",
        ["layer_id"],
        unique=True,
        postgresql_where=sa.text("is_por"),
    )

    op.create_table(
        "cell_value",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "condition_id", sa.Integer(), sa.ForeignKey("layer_condition.id", ondelete="CASCADE")
        ),
        sa.Column("parameter_code", sa.String(length=64), nullable=False),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.UniqueConstraint("condition_id", "parameter_code", name="uq_cell_condition_param"),
    )
    op.create_index("ix_cell_value_condition_id", "cell_value", ["condition_id"])
    op.create_index("ix_cell_value_parameter_code", "cell_value", ["parameter_code"])

    op.create_table(
        "change_event",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id", ondelete="CASCADE")),
        sa.Column(
            "event_type",
            sa.Enum(
                "project_create",
                "backbone_copy",
                "backbone_layer_replace",
                name="change_event_type",
                native_enum=False,
                length=64,
            ),
            nullable=False,
        ),
        sa.Column("actor", sa.String(length=128), nullable=False, server_default="system"),
        sa.Column("payload", _JSON_PAYLOAD, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_change_event_project_id", "change_event", ["project_id"])
    op.create_index("ix_change_event_event_type", "change_event", ["event_type"])


def downgrade() -> None:
    op.drop_index("ix_change_event_event_type", table_name="change_event")
    op.drop_index("ix_change_event_project_id", table_name="change_event")
    op.drop_table("change_event")
    op.drop_index("ix_cell_value_parameter_code", table_name="cell_value")
    op.drop_index("ix_cell_value_condition_id", table_name="cell_value")
    op.drop_table("cell_value")
    op.drop_index("uq_layer_condition_por", table_name="layer_condition")
    op.drop_index("ix_layer_condition_layer_id", table_name="layer_condition")
    op.drop_table("layer_condition")
    op.drop_index("ix_sheet_layer_layer_id", table_name="sheet_layer")
    op.drop_index("ix_sheet_layer_step_seq", table_name="sheet_layer")
    op.drop_index("ix_sheet_layer_project_id", table_name="sheet_layer")
    op.drop_table("sheet_layer")
    op.drop_index("ix_project_part_id", table_name="project")
    op.drop_index("ix_project_process_id", table_name="project")
    op.drop_index("ix_project_line_id", table_name="project")
    op.drop_table("project")
