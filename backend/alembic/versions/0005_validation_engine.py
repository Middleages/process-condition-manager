"""Validation-engine foundation: parameter validation metadata.

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa

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


def downgrade() -> None:
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
