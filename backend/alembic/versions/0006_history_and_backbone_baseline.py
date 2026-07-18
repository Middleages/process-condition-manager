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

_INT4_MAX = 2_147_483_647
_BATCH_ID_MAX_LENGTH = 64
_LAYER_KEY_MAX_LENGTH = 256


def _require_online() -> None:
    if op.get_context().as_sql:
        raise RuntimeError("Phase 4 history expansion requires an online database connection")


def _execute(sql: str) -> None:
    op.get_bind().execute(sa.text(sql))


def _safe_positive_int_expression(field: str) -> str:
    return (
        "CASE "
        f"WHEN jsonb_typeof(payload->'{field}') = 'number' "
        f"AND (payload->>'{field}') ~ '^[0-9]+$' "
        f"AND (payload->>'{field}')::numeric BETWEEN 1 AND {_INT4_MAX} "
        f"THEN (payload->>'{field}')::integer "
        "ELSE NULL "
        "END"
    )


def _safe_string_expression(field: str, *, max_length: int) -> str:
    return (
        "CASE "
        f"WHEN jsonb_typeof(payload->'{field}') = 'string' "
        f"AND char_length(payload->>'{field}') <= {max_length} "
        f"THEN payload->>'{field}' "
        "ELSE NULL "
        "END"
    )


def _backfill_change_event_columns() -> None:
    _execute(
        """
        UPDATE change_event
        SET condition_id = NULL,
            layer_key = NULL,
            batch_id = {batch_id},
            origin = 'system',
            source_project_id = {backbone_project_id},
            source_layer_key = NULL
        WHERE event_type = 'project_create'
        """.format(
            batch_id=_safe_string_expression("batch_id", max_length=_BATCH_ID_MAX_LENGTH),
            backbone_project_id=_safe_positive_int_expression("backbone_project_id"),
        )
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
            batch_id = {batch_id},
            origin = 'backbone',
            source_project_id = {backbone_project_id},
            source_layer_key = NULL
        WHERE event_type = 'backbone_copy'
        """.format(
            batch_id=_safe_string_expression("batch_id", max_length=_BATCH_ID_MAX_LENGTH),
            backbone_project_id=_safe_positive_int_expression("backbone_project_id"),
        )
    )
    _execute(
        """
        UPDATE change_event
        SET condition_id = NULL,
            layer_key = {target_layer_key},
            batch_id = {batch_id},
            origin = 'backbone',
            source_project_id = {source_project_id},
            source_layer_key = {source_layer_key}
        WHERE event_type = 'backbone_layer_replace'
        """.format(
            target_layer_key=_safe_string_expression(
                "target_layer_key", max_length=_LAYER_KEY_MAX_LENGTH
            ),
            batch_id=_safe_string_expression("batch_id", max_length=_BATCH_ID_MAX_LENGTH),
            source_project_id=_safe_positive_int_expression("source_project_id"),
            source_layer_key=_safe_string_expression(
                "source_layer_key", max_length=_LAYER_KEY_MAX_LENGTH
            ),
        )
    )
    _execute(
        """
        UPDATE change_event
        SET batch_id = {batch_id},
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
        """.format(batch_id=_safe_string_expression("batch_id", max_length=_BATCH_ID_MAX_LENGTH))
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
        SET condition_id = {condition_id},
            layer_key = {layer_key},
            batch_id = NULL,
            origin = 'manual',
            source_project_id = NULL,
            source_layer_key = NULL
        WHERE event_type = 'condition_add'
        """.format(
            condition_id=_safe_positive_int_expression("condition_id"),
            layer_key=_safe_string_expression("layer_key", max_length=_LAYER_KEY_MAX_LENGTH),
        )
    )
    _execute(
        """
        UPDATE change_event
        SET condition_id = {condition_id},
            layer_key = {layer_key},
            batch_id = NULL,
            origin = 'manual',
            source_project_id = NULL,
            source_layer_key = NULL
        WHERE event_type = 'condition_remove'
        """.format(
            condition_id=_safe_positive_int_expression("condition_id"),
            layer_key=_safe_string_expression("layer_key", max_length=_LAYER_KEY_MAX_LENGTH),
        )
    )
    _execute(
        """
        UPDATE change_event
        SET condition_id = {condition_id},
            layer_key = {layer_key},
            batch_id = NULL,
            origin = 'manual',
            source_project_id = NULL,
            source_layer_key = NULL
        WHERE event_type = 'por_change'
        """.format(
            condition_id=_safe_positive_int_expression("new_por_condition_id"),
            layer_key=_safe_string_expression("layer_key", max_length=_LAYER_KEY_MAX_LENGTH),
        )
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
