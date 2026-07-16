"""retry-safe history query indexes

Revision ID: 0007
Revises: 0006

Build the history query indexes concurrently with preflight/retry/postflight
checks so interrupted upgrades can resume safely.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


@dataclass(frozen=True, slots=True)
class IndexSpec:
    name: str
    index: sa.Index


def _require_online() -> None:
    if op.get_context().as_sql:
        raise RuntimeError("Phase 4 concurrent indexes require an online database connection")


_change_event = sa.table(
    "change_event",
    sa.column("project_id", sa.Integer()),
    sa.column("id", sa.Integer()),
    sa.column("event_type", sa.String()),
    sa.column("condition_id", sa.Integer()),
    sa.column("parameter_code", sa.String()),
    sa.column("layer_key", sa.String()),
    sa.column("actor", sa.String()),
    sa.column("origin", sa.String()),
    sa.column("source_project_id", sa.Integer()),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("batch_id", sa.String()),
)

_INDEX_SPECS = [
    IndexSpec(
        "ix_change_event_project_id_id_desc",
        sa.Index(
            "ix_change_event_project_id_id_desc",
            _change_event.c.project_id,
            _change_event.c.id.desc(),
        ),
    ),
    IndexSpec(
        "ix_change_event_project_type_id_desc",
        sa.Index(
            "ix_change_event_project_type_id_desc",
            _change_event.c.project_id,
            _change_event.c.event_type,
            _change_event.c.id.desc(),
        ),
    ),
    IndexSpec(
        "ix_change_event_project_cell_id_desc",
        sa.Index(
            "ix_change_event_project_cell_id_desc",
            _change_event.c.project_id,
            _change_event.c.condition_id,
            _change_event.c.parameter_code,
            _change_event.c.id.desc(),
            postgresql_where=sa.text("condition_id IS NOT NULL AND parameter_code IS NOT NULL"),
        ),
    ),
    IndexSpec(
        "ix_change_event_project_condition_id_desc",
        sa.Index(
            "ix_change_event_project_condition_id_desc",
            _change_event.c.project_id,
            _change_event.c.condition_id,
            _change_event.c.id.desc(),
            postgresql_where=sa.text("condition_id IS NOT NULL"),
        ),
    ),
    IndexSpec(
        "ix_change_event_project_layer_id_desc",
        sa.Index(
            "ix_change_event_project_layer_id_desc",
            _change_event.c.project_id,
            _change_event.c.layer_key,
            _change_event.c.id.desc(),
            postgresql_where=sa.text("layer_key IS NOT NULL"),
        ),
    ),
    IndexSpec(
        "ix_change_event_project_actor_id_desc",
        sa.Index(
            "ix_change_event_project_actor_id_desc",
            _change_event.c.project_id,
            _change_event.c.actor,
            _change_event.c.id.desc(),
        ),
    ),
    IndexSpec(
        "ix_change_event_project_origin_id_desc",
        sa.Index(
            "ix_change_event_project_origin_id_desc",
            _change_event.c.project_id,
            _change_event.c.origin,
            _change_event.c.id.desc(),
            postgresql_where=sa.text("origin IS NOT NULL"),
        ),
    ),
    IndexSpec(
        "ix_change_event_project_source_id_desc",
        sa.Index(
            "ix_change_event_project_source_id_desc",
            _change_event.c.project_id,
            _change_event.c.source_project_id,
            _change_event.c.id.desc(),
            postgresql_where=sa.text("source_project_id IS NOT NULL"),
        ),
    ),
    IndexSpec(
        "ix_change_event_project_created_id_desc",
        sa.Index(
            "ix_change_event_project_created_id_desc",
            _change_event.c.project_id,
            _change_event.c.created_at.desc(),
            _change_event.c.id.desc(),
        ),
    ),
    IndexSpec(
        "ix_change_event_project_batch_id_desc",
        sa.Index(
            "ix_change_event_project_batch_id_desc",
            _change_event.c.project_id,
            _change_event.c.batch_id,
            _change_event.c.id.desc(),
            postgresql_where=sa.text("batch_id IS NOT NULL"),
        ),
    ),
]


def _normalize_index_sql(sql: str) -> str:
    normalized = sql.lower().replace('"', "").replace("public.", "")
    normalized = normalized.replace("using btree", "")
    return re.sub(r"\s+", " ", normalized).strip()


def _expected_index_sql(index: sa.Index) -> str:
    sql = str(CreateIndex(index).compile(dialect=postgresql.dialect()))
    return _normalize_index_sql(sql)


def _fetch_index_state(name: str) -> tuple[bool, str | None]:
    row = (
        op.get_bind()
        .execute(
            sa.text(
                """
            SELECT i.indisvalid, pg_get_indexdef(i.indexrelid) AS indexdef
            FROM pg_index AS i
            JOIN pg_class AS c ON c.oid = i.indexrelid
            JOIN pg_namespace AS n ON n.oid = c.relnamespace
            WHERE c.relname = :name AND n.nspname = current_schema()
            """
            ),
            {"name": name},
        )
        .first()
    )
    if row is None:
        return (False, None)
    return (bool(row[0]), row[1])


def _drop_index_concurrently(name: str) -> None:
    op.execute(sa.text(f'DROP INDEX CONCURRENTLY IF EXISTS "{name}"'))


def _create_index_concurrently(index: sa.Index) -> None:
    sql = str(CreateIndex(index).compile(dialect=postgresql.dialect()))
    sql = sql.replace("CREATE INDEX ", "CREATE INDEX CONCURRENTLY ", 1)
    op.execute(sa.text(sql))


def _ensure_index(spec: IndexSpec) -> None:
    valid, current_sql = _fetch_index_state(spec.name)
    expected_sql = _expected_index_sql(spec.index)
    if valid and current_sql is not None and _normalize_index_sql(current_sql) == expected_sql:
        return

    with op.get_context().autocommit_block():
        if current_sql is not None:
            _drop_index_concurrently(spec.name)
        _create_index_concurrently(spec.index)

    valid, current_sql = _fetch_index_state(spec.name)
    if not valid or current_sql is None or _normalize_index_sql(current_sql) != expected_sql:
        raise RuntimeError(f"index preflight/postflight mismatch: {spec.name}")


def _assert_all_indexes_ready() -> None:
    for spec in _INDEX_SPECS:
        valid, current_sql = _fetch_index_state(spec.name)
        if not valid or current_sql is None:
            raise RuntimeError(f"missing or invalid index after migration: {spec.name}")
        if _normalize_index_sql(current_sql) != _expected_index_sql(spec.index):
            raise RuntimeError(f"unexpected index definition after migration: {spec.name}")


def upgrade() -> None:
    _require_online()
    for spec in _INDEX_SPECS:
        _ensure_index(spec)
    _assert_all_indexes_ready()


def downgrade() -> None:
    _require_online()
    for spec in reversed(_INDEX_SPECS):
        _valid, current_sql = _fetch_index_state(spec.name)
        if current_sql is None:
            continue
        with op.get_context().autocommit_block():
            _drop_index_concurrently(spec.name)
