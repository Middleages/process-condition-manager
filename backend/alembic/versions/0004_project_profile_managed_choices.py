"""Reset-only Project Profile and managed-choice cutover.

Revision ID: 0004
Revises: 0003

No legacy data migration is approved.  The upgrade therefore locks and verifies every
mutable application table before its first schema-changing operation.
"""

import re
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MUTABLE_TABLES = (
    "parameter_category",
    "parameter",
    "parameter_option",
    "project",
    "sheet_layer",
    "layer_condition",
    "cell_value",
    "change_event",
    "edit_lock",
)

_IDENTIFIER_RE = re.compile(r"^[a-z][a-z0-9_]*$")
_FIXED_CHOICE_SETS = (
    ("device_type", "Device Type"),
    ("project_category", "Project Category"),
    ("active_direction", "Active Direction"),
    ("gate_direction", "Gate Direction"),
)
_PROFILE_TEXT_COLUMNS = (
    "gross_die",
    "pitch_x",
    "pitch_y",
    "shot_x",
    "shot_y",
    "slit_occupancy",
    "lens_occupancy",
    "map_offset_x",
    "map_offset_y",
    "scribe_lane_x",
    "scribe_lane_y",
    "shot_count",
    "full_shot",
    "layer_total",
    "euv",
    "imm",
    "arf",
    "krf",
    "iline",
    "soh",
    "pspi",
    "metal_layer_count",
)


def _assert_disposable_database(bind: Connection) -> None:
    for table_name in MUTABLE_TABLES:
        if _IDENTIFIER_RE.fullmatch(table_name) is None:
            raise RuntimeError(f"invalid migration table identifier: {table_name!r}")

    # Every application write takes ROW EXCLUSIVE.  Acquiring SHARE on all mutable
    # tables in one deterministic statement closes the check/DDL race while still
    # allowing ordinary readers.  The locks live through the Alembic transaction.
    locked_tables = ", ".join(MUTABLE_TABLES)
    bind.execute(sa.text(f"LOCK TABLE {locked_tables} IN SHARE MODE"))

    non_empty: list[str] = []
    for table_name in MUTABLE_TABLES:
        has_rows = bind.scalar(
            sa.text(f"SELECT EXISTS (SELECT 1 FROM {table_name} LIMIT 1)")
        )
        if has_rows:
            non_empty.append(table_name)
    if non_empty:
        joined = ", ".join(non_empty)
        raise RuntimeError(
            "Phase 2.6 requires a disposable app DB; non-empty mutable tables: " + joined
        )


def _choice_set_seed_table() -> sa.Table:
    return sa.table(
        "choice_set",
        sa.column("code", sa.String(length=64)),
        sa.column("display_name", sa.String(length=128)),
        sa.column("is_active", sa.Boolean()),
        sa.column("version", sa.Integer()),
    )


def upgrade() -> None:
    if op.get_context().as_sql:
        raise RuntimeError("Phase 2.6 reset preflight requires an online database connection")
    bind = op.get_bind()
    _assert_disposable_database(bind)

    op.create_table(
        "choice_set",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.String(length=512), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
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
    op.create_index("ix_choice_set_code", "choice_set", ["code"], unique=True)

    op.create_table(
        "choice_option",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "choice_set_id",
            sa.Integer(),
            sa.ForeignKey("choice_set.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code", sa.String(length=128), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.UniqueConstraint(
            "choice_set_id", "code", name="uq_choice_option_set_code"
        ),
    )
    op.create_index(
        "ix_choice_option_choice_set_id",
        "choice_option",
        ["choice_set_id"],
        unique=False,
    )

    op.bulk_insert(
        _choice_set_seed_table(),
        [
            {
                "code": code,
                "display_name": display_name,
                "is_active": True,
                "version": 1,
            }
            for code, display_name in _FIXED_CHOICE_SETS
        ],
    )

    op.add_column("parameter", sa.Column("choice_set_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_parameter_choice_set_id_choice_set",
        "parameter",
        "choice_set",
        ["choice_set_id"],
        ["id"],
    )
    op.create_index(
        "ix_parameter_choice_set_id", "parameter", ["choice_set_id"], unique=False
    )
    op.alter_column(
        "parameter",
        "min_value",
        existing_type=sa.Float(),
        type_=sa.Numeric(),
        existing_nullable=True,
        postgresql_using="min_value::numeric",
    )
    op.alter_column(
        "parameter",
        "max_value",
        existing_type=sa.Float(),
        type_=sa.Numeric(),
        existing_nullable=True,
        postgresql_using="max_value::numeric",
    )
    op.create_check_constraint(
        "ck_parameter_choice_set_binding",
        "parameter",
        "(value_type = 'choice' AND choice_set_id IS NOT NULL) OR "
        "(value_type <> 'choice' AND choice_set_id IS NULL)",
    )

    op.create_table(
        "project_profile",
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("project.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("process_name", sa.Text(), nullable=False),
        sa.Column("device_type_code", sa.String(length=128), nullable=False),
        sa.Column("project_category_code", sa.String(length=128), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("active_direction_code", sa.String(length=128), nullable=True),
        sa.Column("gate_direction_code", sa.String(length=128), nullable=True),
        *(sa.Column(name, sa.Text(), nullable=True) for name in _PROFILE_TEXT_COLUMNS),
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

    op.drop_column("project", "description")
    op.drop_table("parameter_option")


def downgrade() -> None:
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
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.UniqueConstraint("parameter_id", "value", name="uq_option_param_value"),
    )
    op.create_index(
        "ix_parameter_option_parameter_id",
        "parameter_option",
        ["parameter_id"],
        unique=False,
    )
    op.add_column("project", sa.Column("description", sa.String(length=1024), nullable=True))
    op.drop_table("project_profile")
    op.drop_constraint(
        "ck_parameter_choice_set_binding", "parameter", type_="check"
    )
    op.alter_column(
        "parameter",
        "max_value",
        existing_type=sa.Numeric(),
        type_=sa.Float(),
        existing_nullable=True,
        postgresql_using="max_value::double precision",
    )
    op.alter_column(
        "parameter",
        "min_value",
        existing_type=sa.Numeric(),
        type_=sa.Float(),
        existing_nullable=True,
        postgresql_using="min_value::double precision",
    )
    op.drop_index("ix_parameter_choice_set_id", table_name="parameter")
    op.drop_constraint(
        "fk_parameter_choice_set_id_choice_set", "parameter", type_="foreignkey"
    )
    op.drop_column("parameter", "choice_set_id")
    op.drop_index("ix_choice_option_choice_set_id", table_name="choice_option")
    op.drop_table("choice_option")
    op.drop_index("ix_choice_set_code", table_name="choice_set")
    op.drop_table("choice_set")
