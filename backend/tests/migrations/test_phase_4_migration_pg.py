"""Phase 4 history/backbone migration evidence on isolated PostgreSQL."""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlalchemy import event
from sqlalchemy.engine import Connection

from tests.postgres_database import TemporaryPostgresDatabase, temporary_postgres_database

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")


def _config(database: TemporaryPostgresDatabase) -> Config:
    config = Config(str(_BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(_BACKEND_ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", database.sync_url)
    return config


@dataclass
class MigrationDatabase:
    database: TemporaryPostgresDatabase
    connection: Connection

    def upgrade(self, target: str) -> None:
        config = _config(self.database)
        config.attributes["connection"] = self.connection
        try:
            command.upgrade(config, target)
        except Exception:
            self.connection.rollback()
            raise

    def downgrade(self, target: str) -> None:
        config = _config(self.database)
        config.attributes["connection"] = self.connection
        try:
            command.downgrade(config, target)
        except Exception:
            self.connection.rollback()
            raise

    def current_revision(self) -> str | None:
        return self.connection.scalar(sa.text("SELECT version_num FROM alembic_version"))


@pytest.fixture
def migration_db() -> Iterator[MigrationDatabase]:
    with temporary_postgres_database() as database:
        engine = sa.create_engine(database.sync_url)
        try:
            with engine.connect() as connection:
                yield MigrationDatabase(database, connection)
        finally:
            engine.dispose()


@dataclass(frozen=True, slots=True)
class SeededHistoryFixture:
    source_project_id: int
    target_project_id: int
    source_layer_key: str
    target_layer_key: str
    live_condition_id: int
    deleted_condition_id: int
    added_condition_id: int
    remove_condition_id: int
    event_ids: tuple[int, ...]


def _insert_scalar(connection: Connection, sql: str, params: dict[str, object] | None = None) -> int:
    return int(connection.execute(sa.text(sql), params or {}).scalar_one())


def _insert_event(
    connection: Connection,
    *,
    project_id: int,
    event_type: str,
    actor: str,
    payload: dict[str, object],
    condition_id: int | None = None,
    parameter_code: str | None = None,
    old_value: str | None = None,
    new_value: str | None = None,
) -> int:
    return _insert_scalar(
        connection,
        """
        INSERT INTO change_event
            (project_id, event_type, actor, payload, condition_id, parameter_code, old_value, new_value)
        VALUES
            (:project_id, :event_type, :actor, CAST(:payload AS jsonb), :condition_id, :parameter_code, :old_value, :new_value)
        RETURNING id
        """,
        {
            "project_id": project_id,
            "event_type": event_type,
            "actor": actor,
            "payload": json.dumps(payload),
            "condition_id": condition_id,
            "parameter_code": parameter_code,
            "old_value": old_value,
            "new_value": new_value,
        },
    )


def _seed_history_fixture(connection: Connection) -> SeededHistoryFixture:
    source_project_id = _insert_scalar(
        connection,
        """
        INSERT INTO project (line_id, process_id, part_id, name)
        VALUES ('L1', 'PROC_SRC', 'SRC', 'Source project')
        RETURNING id
        """,
    )
    target_project_id = _insert_scalar(
        connection,
        """
        INSERT INTO project (line_id, process_id, part_id, name)
        VALUES ('L1', 'PROC_TGT', 'TGT', 'Target project')
        RETURNING id
        """,
    )

    source_layer_key = "L1::PROC_SRC::010::SRC"
    target_layer_key = "L1::PROC_TGT::020::TGT"
    source_layer_id = _insert_scalar(
        connection,
        """
        INSERT INTO sheet_layer (project_id, layer_key, step_seq, layer_id, sort_order)
        VALUES (:project_id, :layer_key, '010', 'SRC', 1)
        RETURNING id
        """,
        {"project_id": source_project_id, "layer_key": source_layer_key},
    )
    target_layer_id = _insert_scalar(
        connection,
        """
        INSERT INTO sheet_layer (project_id, layer_key, step_seq, layer_id, sort_order)
        VALUES (:project_id, :layer_key, '020', 'TGT', 1)
        RETURNING id
        """,
        {"project_id": target_project_id, "layer_key": target_layer_key},
    )

    live_condition_id = _insert_scalar(
        connection,
        """
        INSERT INTO layer_condition (layer_id, label, condition_index, is_por)
        VALUES (:layer_id, 'base', 1, true)
        RETURNING id
        """,
        {"layer_id": source_layer_id},
    )
    deleted_condition_id = _insert_scalar(
        connection,
        """
        INSERT INTO layer_condition (layer_id, label, condition_index, is_por)
        VALUES (:layer_id, 'base', 1, false)
        RETURNING id
        """,
        {"layer_id": target_layer_id},
    )
    added_condition_id = _insert_scalar(
        connection,
        """
        INSERT INTO layer_condition (layer_id, label, condition_index, is_por)
        VALUES (:layer_id, 'C1', 2, false)
        RETURNING id
        """,
        {"layer_id": target_layer_id},
    )
    remove_condition_id = _insert_scalar(
        connection,
        """
        INSERT INTO layer_condition (layer_id, label, condition_index, is_por)
        VALUES (:layer_id, 'C2', 3, false)
        RETURNING id
        """,
        {"layer_id": target_layer_id},
    )

    _insert_scalar(
        connection,
        """
        INSERT INTO cell_value (condition_id, parameter_code, value_text)
        VALUES (:condition_id, 'spin_speed', '1200')
        RETURNING id
        """,
        {"condition_id": live_condition_id},
    )
    _insert_scalar(
        connection,
        """
        INSERT INTO cell_value (condition_id, parameter_code, value_text)
        VALUES (:condition_id, 'etch_time', '6')
        RETURNING id
        """,
        {"condition_id": deleted_condition_id},
    )
    _insert_scalar(
        connection,
        """
        INSERT INTO cell_value (condition_id, parameter_code, value_text)
        VALUES (:condition_id, 'guard_band', 'A')
        RETURNING id
        """,
        {"condition_id": remove_condition_id},
    )

    event_ids = (
        _insert_event(
            connection,
            project_id=target_project_id,
            event_type="project_create",
            actor="system",
            payload={
                "batch_id": "batch-project-create",
                "backbone_project_id": source_project_id,
                "identity": {"line_id": "L1", "process_id": "PROC_TGT", "part_id": "TGT"},
            },
        ),
        _insert_event(
            connection,
            project_id=target_project_id,
            event_type="project_profile_update",
            actor="planner",
            payload={"changes": {"comment": {"old": "old", "new": "new"}}},
        ),
        _insert_event(
            connection,
            project_id=target_project_id,
            event_type="backbone_copy",
            actor="system",
            payload={
                "batch_id": "batch-backbone-copy",
                "backbone_project_id": source_project_id,
                "auto_count": 1,
                "manual_count": 0,
                "unmatched_count": 0,
            },
        ),
        _insert_event(
            connection,
            project_id=target_project_id,
            event_type="backbone_layer_replace",
            actor="editor",
            payload={
                "batch_id": "batch-layer-replace",
                "target_layer_key": target_layer_key,
                "source_project_id": source_project_id,
                "source_layer_key": source_layer_key,
            },
        ),
        _insert_event(
            connection,
            project_id=target_project_id,
            event_type="cell_update",
            actor="dev-admin",
            condition_id=live_condition_id,
            parameter_code="spin_speed",
            old_value="1000",
            new_value="1200",
            payload={"batch_id": "batch-cell-live", "origin": "manual"},
        ),
        _insert_event(
            connection,
            project_id=target_project_id,
            event_type="cell_update",
            actor="dev-admin",
            condition_id=deleted_condition_id,
            parameter_code="etch_time",
            old_value="5",
            new_value="6",
            payload={"batch_id": "batch-cell-deleted", "origin": "paste"},
        ),
        _insert_event(
            connection,
            project_id=target_project_id,
            event_type="condition_add",
            actor="system",
            payload={"layer_key": target_layer_key, "condition_id": added_condition_id},
        ),
        _insert_event(
            connection,
            project_id=target_project_id,
            event_type="condition_remove",
            actor="system",
            payload={"layer_key": target_layer_key, "condition_id": remove_condition_id},
        ),
        _insert_event(
            connection,
            project_id=target_project_id,
            event_type="por_change",
            actor="system",
            payload={
                "layer_key": target_layer_key,
                "new_por_condition_id": live_condition_id,
            },
        ),
    )

    connection.execute(sa.text("DELETE FROM layer_condition WHERE id = :id"), {"id": deleted_condition_id})
    connection.execute(sa.text("DELETE FROM layer_condition WHERE id = :id"), {"id": remove_condition_id})
    connection.commit()

    return SeededHistoryFixture(
        source_project_id=source_project_id,
        target_project_id=target_project_id,
        source_layer_key=source_layer_key,
        target_layer_key=target_layer_key,
        live_condition_id=live_condition_id,
        deleted_condition_id=deleted_condition_id,
        added_condition_id=added_condition_id,
        remove_condition_id=remove_condition_id,
        event_ids=event_ids,
    )


def _table_counts(connection: Connection) -> dict[str, int]:
    tables = ["project", "sheet_layer", "layer_condition", "cell_value", "change_event"]
    return {
        table: int(connection.scalar(sa.text(f"SELECT count(*) FROM {table}")))
        for table in tables
    }


def _event_rows(connection: Connection) -> list[tuple[object, ...]]:
    return [
        tuple(row)
        for row in connection.execute(
            sa.text(
                """
                SELECT id, project_id, event_type, actor, payload, condition_id,
                       parameter_code, old_value, new_value, created_at
                FROM change_event
                ORDER BY id
                """
            )
        ).all()
    ]


def _normalized(sql: str) -> str:
    return " ".join(sql.lower().replace('"', "").replace("public.", "").replace("using btree", "").split())


def _index_defs(connection: Connection) -> dict[str, str]:
    rows = connection.execute(
        sa.text(
            """
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = current_schema()
              AND tablename = 'change_event'
            ORDER BY indexname
            """
        )
    ).all()
    return {row[0]: _normalized(row[1]) for row in rows}


def _index_validity(connection: Connection) -> dict[str, bool]:
    rows = connection.execute(
        sa.text(
            """
            SELECT c.relname, i.indisvalid
            FROM pg_index AS i
            JOIN pg_class AS c ON c.oid = i.indexrelid
            JOIN pg_namespace AS n ON n.oid = c.relnamespace
            WHERE n.nspname = current_schema()
              AND c.relname LIKE 'ix_change_event_%'
            ORDER BY c.relname
            """
        )
    ).all()
    return {row[0]: bool(row[1]) for row in rows}


def test_history_columns_backfill_repeatable_upgrade_downgrade_upgrade(
    migration_db: MigrationDatabase,
) -> None:
    migration_db.upgrade("0005")
    fixture = _seed_history_fixture(migration_db.connection)
    before_counts = _table_counts(migration_db.connection)
    before_events = _event_rows(migration_db.connection)

    migration_db.upgrade("head")

    assert migration_db.current_revision() == "0007"

    inspector = sa.inspect(migration_db.connection)
    sheet_columns = {column["name"]: column for column in inspector.get_columns("sheet_layer")}
    assert str(sheet_columns["backbone_snapshot"]["type"]) == "JSONB"
    assert sheet_columns["backbone_snapshot"]["nullable"] is True
    assert sheet_columns["backbone_snapshot"]["default"] is None

    change_columns = {
        column["name"]: column for column in inspector.get_columns("change_event")
    }
    assert {
        "layer_key",
        "batch_id",
        "origin",
        "source_project_id",
        "source_layer_key",
    } <= set(change_columns)
    assert cast(sa.String, change_columns["layer_key"]["type"]).length == 256
    assert cast(sa.String, change_columns["batch_id"]["type"]).length == 64
    assert cast(sa.String, change_columns["origin"]["type"]).length == 32
    assert cast(sa.String, change_columns["source_layer_key"]["type"]).length == 256
    assert change_columns["layer_key"]["nullable"] is True
    assert change_columns["batch_id"]["nullable"] is True
    assert change_columns["origin"]["nullable"] is True
    assert change_columns["source_project_id"]["nullable"] is True
    assert change_columns["source_layer_key"]["nullable"] is True
    assert change_columns["layer_key"]["default"] is None
    assert change_columns["batch_id"]["default"] is None
    assert change_columns["origin"]["default"] is None
    assert change_columns["source_project_id"]["default"] is None
    assert change_columns["source_layer_key"]["default"] is None

    after_counts = _table_counts(migration_db.connection)
    after_events = _event_rows(migration_db.connection)
    assert before_counts == after_counts
    assert before_events == after_events
    assert [row[0] for row in before_events] == list(fixture.event_ids)

    rows = {
        row[0]: row
        for row in migration_db.connection.execute(
            sa.text(
                """
                SELECT id, event_type, condition_id, layer_key, batch_id, origin,
                       source_project_id, source_layer_key, payload
                FROM change_event
                ORDER BY id
                """
            )
        ).all()
    }
    assert rows[fixture.event_ids[0]][2:] == (
        None,
        None,
        "batch-project-create",
        "system",
        fixture.source_project_id,
        None,
        {
            "batch_id": "batch-project-create",
            "backbone_project_id": fixture.source_project_id,
            "identity": {"line_id": "L1", "process_id": "PROC_TGT", "part_id": "TGT"},
        },
    )
    assert rows[fixture.event_ids[1]][2:] == (
        None,
        None,
        None,
        "manual",
        None,
        None,
        {"changes": {"comment": {"old": "old", "new": "new"}}},
    )
    assert rows[fixture.event_ids[2]][2:] == (
        None,
        None,
        "batch-backbone-copy",
        "backbone",
        fixture.source_project_id,
        None,
        {
            "batch_id": "batch-backbone-copy",
            "backbone_project_id": fixture.source_project_id,
            "auto_count": 1,
            "manual_count": 0,
            "unmatched_count": 0,
        },
    )
    assert rows[fixture.event_ids[3]][2:] == (
        None,
        fixture.target_layer_key,
        "batch-layer-replace",
        "backbone",
        fixture.source_project_id,
        fixture.source_layer_key,
        {
            "batch_id": "batch-layer-replace",
            "target_layer_key": fixture.target_layer_key,
            "source_project_id": fixture.source_project_id,
            "source_layer_key": fixture.source_layer_key,
        },
    )
    assert rows[fixture.event_ids[4]][2:] == (
        fixture.live_condition_id,
        fixture.source_layer_key,
        "batch-cell-live",
        "manual",
        None,
        None,
        {"batch_id": "batch-cell-live", "origin": "manual"},
    )
    assert rows[fixture.event_ids[5]][2:] == (
        fixture.deleted_condition_id,
        None,
        "batch-cell-deleted",
        "paste",
        None,
        None,
        {"batch_id": "batch-cell-deleted", "origin": "paste"},
    )
    assert rows[fixture.event_ids[6]][2:] == (
        fixture.added_condition_id,
        fixture.target_layer_key,
        None,
        "manual",
        None,
        None,
        {"layer_key": fixture.target_layer_key, "condition_id": fixture.added_condition_id},
    )
    assert rows[fixture.event_ids[7]][2:] == (
        fixture.remove_condition_id,
        fixture.target_layer_key,
        None,
        "manual",
        None,
        None,
        {"layer_key": fixture.target_layer_key, "condition_id": fixture.remove_condition_id},
    )
    assert rows[fixture.event_ids[8]][2:] == (
        fixture.live_condition_id,
        fixture.target_layer_key,
        None,
        "manual",
        None,
        None,
        {
            "layer_key": fixture.target_layer_key,
            "new_por_condition_id": fixture.live_condition_id,
        },
    )

    assert (
        migration_db.connection.scalar(
            sa.text(
                "SELECT count(*) FROM sheet_layer WHERE backbone_snapshot IS NOT NULL"
            )
        )
        == 0
    )

    indexes = _index_defs(migration_db.connection)
    validities = _index_validity(migration_db.connection)
    expected_fragments = {
        "ix_change_event_project_id_id_desc": ["(project_id, id desc)"],
        "ix_change_event_project_type_id_desc": ["(project_id, event_type, id desc)"],
        "ix_change_event_project_cell_id_desc": [
            "(project_id, condition_id, parameter_code, id desc)",
            "where ((condition_id is not null) and (parameter_code is not null))",
        ],
        "ix_change_event_project_condition_id_desc": [
            "(project_id, condition_id, id desc)",
            "where (condition_id is not null)",
        ],
        "ix_change_event_project_layer_id_desc": [
            "(project_id, layer_key, id desc)",
            "where (layer_key is not null)",
        ],
        "ix_change_event_project_actor_id_desc": ["(project_id, actor, id desc)"],
        "ix_change_event_project_origin_id_desc": [
            "(project_id, origin, id desc)",
            "where (origin is not null)",
        ],
        "ix_change_event_project_source_id_desc": [
            "(project_id, source_project_id, id desc)",
            "where (source_project_id is not null)",
        ],
        "ix_change_event_project_created_id_desc": ["(project_id, created_at desc, id desc)"],
        "ix_change_event_project_batch_id_desc": [
            "(project_id, batch_id, id desc)",
            "where (batch_id is not null)",
        ],
    }
    for name, fragments in expected_fragments.items():
        assert name in indexes
        assert validities[name] is True
        for fragment in fragments:
            assert fragment in indexes[name]

    migration_db.downgrade("0005")
    assert migration_db.current_revision() == "0005"
    downgraded_columns = {
        column["name"] for column in sa.inspect(migration_db.connection).get_columns("change_event")
    }
    assert {
        "layer_key",
        "batch_id",
        "origin",
        "source_project_id",
        "source_layer_key",
    }.isdisjoint(downgraded_columns)
    assert "backbone_snapshot" not in {
        column["name"] for column in sa.inspect(migration_db.connection).get_columns("sheet_layer")
    }

    migration_db.upgrade("head")
    assert migration_db.current_revision() == "0007"
    assert before_events == _event_rows(migration_db.connection)
    assert before_counts == _table_counts(migration_db.connection)


def test_0007_retry_rebuilds_mismatched_index_after_partial_interruption(
    migration_db: MigrationDatabase,
) -> None:
    migration_db.upgrade("0006")
    migration_db.connection.execute(
        sa.text(
            "CREATE INDEX ix_change_event_project_origin_id_desc ON change_event (project_id, actor, id DESC)"
        )
    )
    migration_db.connection.commit()

    interrupted = False

    def _interrupt_after_first_create(
        _conn,
        _cursor,
        statement,
        _parameters,
        _context,
        _executemany,
    ) -> None:
        nonlocal interrupted
        if not interrupted and "CREATE INDEX CONCURRENTLY" in statement and "ix_change_event_project_id_id_desc" in statement:
            interrupted = True
            raise RuntimeError("simulated interruption after the first concurrent index")

    event.listen(migration_db.connection, "after_cursor_execute", _interrupt_after_first_create)
    try:
        with pytest.raises(RuntimeError, match="simulated interruption"):
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(migration_db.upgrade, "head")
                future.result(timeout=30)
        assert migration_db.current_revision() == "0006"
    finally:
        event.remove(migration_db.connection, "after_cursor_execute", _interrupt_after_first_create)

    assert _index_validity(migration_db.connection)["ix_change_event_project_id_id_desc"] is True
    assert "actor, id desc" in _index_defs(migration_db.connection)[
        "ix_change_event_project_origin_id_desc"
    ]

    migration_db.upgrade("head")
    assert migration_db.current_revision() == "0007"

    indexes = _index_defs(migration_db.connection)
    validities = _index_validity(migration_db.connection)
    assert validities and all(validities.values())
    assert indexes["ix_change_event_project_origin_id_desc"].endswith(
        "where (origin is not null)"
    )
    assert indexes["ix_change_event_project_id_id_desc"].endswith("(project_id, id desc)")
    assert indexes["ix_change_event_project_batch_id_desc"].endswith(
        "where (batch_id is not null)"
    )

    migration_db.downgrade("0006")
    remaining_indexes = _index_defs(migration_db.connection)
    assert {
        "ix_change_event_project_id_id_desc",
        "ix_change_event_project_type_id_desc",
        "ix_change_event_project_cell_id_desc",
        "ix_change_event_project_condition_id_desc",
        "ix_change_event_project_layer_id_desc",
        "ix_change_event_project_actor_id_desc",
        "ix_change_event_project_origin_id_desc",
        "ix_change_event_project_source_id_desc",
        "ix_change_event_project_created_id_desc",
        "ix_change_event_project_batch_id_desc",
    }.isdisjoint(remaining_indexes)
