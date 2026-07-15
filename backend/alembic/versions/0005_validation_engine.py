"""Validation-engine foundation: parameter validation metadata.

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "parameter",
        sa.Column(
            "required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "parameter",
        sa.Column("pattern", sa.String(length=256), nullable=True),
    )
    op.add_column(
        "parameter",
        sa.Column("pattern_hint", sa.String(length=256), nullable=True),
    )
    # Before 0005, non-number rows could legitimately retain unit/range metadata.
    # PostgreSQL NOT VALID preserves those historical rows while still enforcing
    # the check for every new or updated row. Validate only after an explicit
    # legacy-data remediation, rather than deleting metadata during this upgrade.
    op.create_check_constraint(
        "ck_parameter_number_metadata",
        "parameter",
        "value_type = 'number' OR (unit IS NULL AND min_value IS NULL AND max_value IS NULL)",
        postgresql_not_valid=True,
    )
    op.create_check_constraint(
        "ck_parameter_pattern_pair",
        "parameter",
        "(pattern IS NULL AND pattern_hint IS NULL) OR "
        "(value_type = 'text' AND pattern IS NOT NULL "
        "AND pattern_hint IS NOT NULL AND length(pattern) > 0 "
        "AND length(trim(pattern_hint)) > 0)",
    )
    op.create_table(
        "validation_rule",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.String(length=512), nullable=True),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column(
            "scope",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "spec",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
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
        sa.CheckConstraint(
            "code ~ '^[a-z][a-z0-9_]*$'",
            name="ck_validation_rule_code_format",
        ),
        sa.CheckConstraint(
            "length(btrim(name)) > 0",
            name="ck_validation_rule_name_nonblank",
        ),
        sa.CheckConstraint(
            "description IS NULL OR length(btrim(description)) > 0",
            name="ck_validation_rule_description_nonblank",
        ),
        sa.CheckConstraint(
            "severity IN ('error', 'warning')",
            name="ck_validation_rule_severity",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(scope) = 'object'",
            name="ck_validation_rule_scope_object",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(spec) = 'object'",
            name="ck_validation_rule_spec_object",
        ),
        sa.CheckConstraint("version >= 1", name="ck_validation_rule_version"),
    )
    op.create_index(
        "ix_validation_rule_code",
        "validation_rule",
        ["code"],
        unique=True,
    )
    op.create_index(
        "ix_validation_rule_active_code",
        "validation_rule",
        ["is_active", "code"],
    )


def downgrade() -> None:
    op.drop_index("ix_validation_rule_active_code", table_name="validation_rule")
    op.drop_index("ix_validation_rule_code", table_name="validation_rule")
    op.drop_table("validation_rule")
    op.drop_constraint(
        "ck_parameter_pattern_pair",
        "parameter",
        type_="check",
    )
    op.drop_constraint(
        "ck_parameter_number_metadata",
        "parameter",
        type_="check",
    )
    op.drop_column("parameter", "pattern_hint")
    op.drop_column("parameter", "pattern")
    op.drop_column("parameter", "required")
