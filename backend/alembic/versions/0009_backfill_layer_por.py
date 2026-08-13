"""Backfill one POR for every Layer with a POR gap.

Revision ID: 0009
Revises: 0008
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            WITH ranked_gaps AS (
                SELECT
                    candidate.id,
                    row_number() OVER (
                        PARTITION BY candidate.layer_id
                        ORDER BY candidate.condition_index, candidate.id
                    ) AS candidate_rank
                FROM layer_condition AS candidate
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM layer_condition AS current_por
                    WHERE current_por.layer_id = candidate.layer_id
                      AND current_por.is_por
                )
            )
            UPDATE layer_condition AS condition
            SET is_por = true
            FROM ranked_gaps
            WHERE condition.id = ranked_gaps.id
              AND ranked_gaps.candidate_rank = 1
            """
        )
    )


def downgrade() -> None:
    # The pre-migration POR gaps cannot be distinguished safely after backfill.
    pass
