"""parameter registry (fresh start)

Revision ID: 0001
Revises:
Create Date: Phase 0 T3

파라미터 레지스트리 3테이블: parameter_category, parameter, parameter_option.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "parameter_category",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column(
            "sort_order", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default="true"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_parameter_category_code", "parameter_category", ["code"], unique=True
    )

    op.create_table(
        "parameter",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.String(length=512), nullable=True),
        sa.Column(
            "value_type",
            sa.Enum(
                "number",
                "text",
                "choice",
                name="value_type",
                native_enum=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("parameter_category.id"),
            nullable=True,
        ),
        sa.Column("unit", sa.String(length=32), nullable=True),
        sa.Column("min_value", sa.Float(), nullable=True),
        sa.Column("max_value", sa.Float(), nullable=True),
        sa.Column(
            "sort_order", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default="true"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_parameter_code", "parameter", ["code"], unique=True)
    op.create_index(
        "ix_parameter_category_id", "parameter", ["category_id"], unique=False
    )

    op.create_table(
        "parameter_option",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "parameter_id",
            sa.Integer(),
            sa.ForeignKey("parameter.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("value", sa.String(length=128), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column(
            "sort_order", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default="true"
        ),
        sa.UniqueConstraint("parameter_id", "value", name="uq_option_param_value"),
    )
    op.create_index(
        "ix_parameter_option_parameter_id",
        "parameter_option",
        ["parameter_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("parameter_option")
    op.drop_index("ix_parameter_category_id", table_name="parameter")
    op.drop_index("ix_parameter_code", table_name="parameter")
    op.drop_table("parameter")
    op.drop_index("ix_parameter_category_code", table_name="parameter_category")
    op.drop_table("parameter_category")
