"""history + backbone baseline storage columns

Revision ID: 0006
Revises: 0005

Phase 4 storage expansion: add immutable backbone snapshot storage and
structured event envelope columns, then backfill legacy rows with the exact
mapping approved in PRD 4.1.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _require_online() -> None:
    if op.get_context().as_sql:
        raise RuntimeError("Phase 4 history expansion requires an online database connection")


def _execute(sql: str) -> None:
    op.get_bind().execute(sa.text(sql))


def _backfill_change_event_columns() -> None:
    _execute(
        """
        UPDATE change_event
        SET condition_id = NULL,
            layer_key = NULL,
            batch_id = CASE
                WHEN jsonb_typeof(payload->'batch_id') = 'string'
                THEN payload->>'batch_id'
                ELSE NULL
            END,
            origin = 'system',
            source_project_id = CASE
                WHEN jsonb_typeof(payload->'backbone_project_id') = 'number'
                THEN (payload->>'backbone_project_id')::integer
                ELSE NULL
            END,
            source_layer_key = NULL
        WHERE event_type = 'project_create'
        """
    )
    _execute(
        """
        UPDATE change_event
        SET condition_id = NULL,
            layer_key = NULL,
            batch_id = NULL,
            origin = 'manual',
            source_project_id = NULL,
            source_layer_key = NULL
        WHERE event_type = 'project_profile_update'
        """
    )
    _execute(
        """
        UPDATE change_event
        SET condition_id = NULL,
            layer_key = NULL,
            batch_id = CASE
                WHEN jsonb_typeof(payload->'batch_id') = 'string'
                THEN payload->>'batch_id'
                ELSE NULL
            END,
            origin = 'backbone',
            source_project_id = CASE
                WHEN jsonb_typeof(payload->'backbone_project_id') = 'number'
                THEN (payload->>'backbone_project_id')::integer
                ELSE NULL
            END,
            source_layer_key = NULL
        WHERE event_type = 'backbone_copy'
        """
    )
    _execute(
        """
        UPDATE change_event
        SET condition_id = NULL,
            layer_key = CASE
                WHEN jsonb_typeof(payload->'target_layer_key') = 'string'
                THEN payload->>'target_layer_key'
                ELSE NULL
            END,
            batch_id = CASE
                WHEN jsonb_typeof(payload->'batch_id') = 'string'
                THEN payload->>'batch_id'
                ELSE NULL
            END,
            origin = 'backbone',
            source_project_id = CASE
                WHEN jsonb_typeof(payload->'source_project_id') = 'number'
                THEN (payload->>'source_project_id')::integer
                ELSE NULL
            END,
            source_layer_key = CASE
                WHEN jsonb_typeof(payload->'source_layer_key') = 'string'
                THEN payload->>'source_layer_key'
                ELSE NULL
            END
        WHERE event_type = 'backbone_layer_replace'
        """
    )
    _execute(
        """
        UPDATE change_event
        SET batch_id = CASE
                WHEN jsonb_typeof(payload->'batch_id') = 'string'
                THEN payload->>'batch_id'
                ELSE NULL
            END,
            origin = CASE
                WHEN jsonb_typeof(payload->'origin') = 'string'
                     AND payload->>'origin' IN ('manual', 'paste')
                THEN payload->>'origin'
                ELSE NULL
            END,
            source_project_id = NULL,
            source_layer_key = NULL,
            layer_key = NULL
        WHERE event_type = 'cell_update'
        """
    )
    _execute(
        """
        UPDATE change_event AS ce
        SET layer_key = sl.layer_key
        FROM layer_condition AS lc
        JOIN sheet_layer AS sl ON sl.id = lc.layer_id
        WHERE ce.event_type = 'cell_update'
          AND ce.condition_id = lc.id
        """
    )
    _execute(
        """
        UPDATE change_event
        SET condition_id = CASE
                WHEN jsonb_typeof(payload->'condition_id') = 'number'
                THEN (payload->>'condition_id')::integer
                ELSE NULL
            END,
            layer_key = CASE
                WHEN jsonb_typeof(payload->'layer_key') = 'string'
                THEN payload->>'layer_key'
                ELSE NULL
            END,
            batch_id = NULL,
            origin = 'manual',
            source_project_id = NULL,
            source_layer_key = NULL
        WHERE event_type = 'condition_add'
        """
    )
    _execute(
        """
        UPDATE change_event
        SET condition_id = CASE
                WHEN jsonb_typeof(payload->'condition_id') = 'number'
                THEN (payload->>'condition_id')::integer
                ELSE NULL
            END,
            layer_key = CASE
                WHEN jsonb_typeof(payload->'layer_key') = 'string'
                THEN payload->>'layer_key'
                ELSE NULL
            END,
            batch_id = NULL,
            origin = 'manual',
            source_project_id = NULL,
            source_layer_key = NULL
        WHERE event_type = 'condition_remove'
        """
    )
    _execute(
        """
        UPDATE change_event
        SET condition_id = CASE
                WHEN jsonb_typeof(payload->'new_por_condition_id') = 'number'
                THEN (payload->>'new_por_condition_id')::integer
                ELSE NULL
            END,
            layer_key = CASE
                WHEN jsonb_typeof(payload->'layer_key') = 'string'
                THEN payload->>'layer_key'
                ELSE NULL
            END,
            batch_id = NULL,
            origin = 'manual',
            source_project_id = NULL,
            source_layer_key = NULL
        WHERE event_type = 'por_change'
        """
    )


def upgrade() -> None:
    _require_online()

    op.add_column(
        "sheet_layer",
        sa.Column(
            "backbone_snapshot",
            sa.JSON().with_variant(postgresql.JSONB(), "postgresql"),
            nullable=True,
        ),
    )
    op.add_column("change_event", sa.Column("layer_key", sa.String(length=256), nullable=True))
    op.add_column("change_event", sa.Column("batch_id", sa.String(length=64), nullable=True))
    op.add_column("change_event", sa.Column("origin", sa.String(length=32), nullable=True))
    op.add_column("change_event", sa.Column("source_project_id", sa.Integer(), nullable=True))
    op.add_column(
        "change_event", sa.Column("source_layer_key", sa.String(length=256), nullable=True)
    )

    _backfill_change_event_columns()


def downgrade() -> None:
    op.drop_column("change_event", "source_layer_key")
    op.drop_column("change_event", "source_project_id")
    op.drop_column("change_event", "origin")
    op.drop_column("change_event", "batch_id")
    op.drop_column("change_event", "layer_key")
    op.drop_column("sheet_layer", "backbone_snapshot")
