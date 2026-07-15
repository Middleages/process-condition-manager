"""Reset-only Phase 2.6 migration evidence against isolated PostgreSQL databases."""

from __future__ import annotations

import inspect
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from threading import Event
from typing import Any
from unittest.mock import Mock

import pytest
import sqlalchemy as sa
from alembic.config import Config
from sqlalchemy import event
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.domain.parameters.types import ValueType
from app.models import Base
from app.models.choice import ChoiceSet
from app.models.parameter import Parameter
from tests.postgres_database import (
    TemporaryPostgresDatabase,
    _create_database,
    _drop_database,
    temporary_postgres_database,
)

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
_BACKEND_ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("operation", [_create_database, _drop_database])
def test_database_helpers_refuse_non_guarded_names(operation: Any) -> None:
    connection = Mock()

    with pytest.raises(RuntimeError, match="refusing destructive database operation"):
        operation(connection, "pcm_test")

    assert connection.mock_calls == []


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

    def offline_upgrade(self, target: str) -> None:
        command.upgrade(_config(self.database), target, sql=True)

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

    def insert_guard_row(self, table_name: str) -> None:
        if table_name not in MUTABLE_TABLES:
            raise RuntimeError(f"unsupported guard table: {table_name}")

        statements = {
            "parameter_category": """
                INSERT INTO parameter_category (code, display_name)
                VALUES ('guard', 'Guard')
            """,
            "parameter": """
                INSERT INTO parameter (code, display_name, value_type)
                VALUES ('guard', 'Guard', 'text')
            """,
            "parameter_option": """
                INSERT INTO parameter_option (parameter_id, value, display_name)
                VALUES (999999, 'guard', 'Guard')
            """,
            "project": """
                INSERT INTO project (line_id, process_id, part_id, name)
                VALUES ('guard', 'guard', 'guard', 'Guard')
            """,
            "sheet_layer": """
                INSERT INTO sheet_layer (project_id, layer_key, step_seq, layer_id)
                VALUES (999999, 'guard', 'guard', 'guard')
            """,
            "layer_condition": """
                INSERT INTO layer_condition (layer_id, condition_index)
                VALUES (999999, 1)
            """,
            "cell_value": """
                INSERT INTO cell_value (condition_id, parameter_code)
                VALUES (999999, 'guard')
            """,
            "change_event": """
                INSERT INTO change_event (project_id, event_type, actor, payload)
                VALUES (999999, 'project_create', 'guard', '{}'::jsonb)
            """,
            "edit_lock": """
                INSERT INTO edit_lock
                    (project_id, locked_by, lock_token, locked_at, expires_at)
                VALUES (999999, 'guard', 'guard', now(), now() + interval '1 minute')
            """,
        }
        child_tables = set(MUTABLE_TABLES) - {"parameter_category", "parameter", "project"}
        if table_name in child_tables:
            self.connection.exec_driver_sql("SET session_replication_role = replica")
        try:
            self.connection.execute(sa.text(statements[table_name]))
        finally:
            if table_name in child_tables:
                self.connection.exec_driver_sql("SET session_replication_role = origin")
        self.connection.commit()


@pytest.fixture
def migration_db() -> Iterator[MigrationDatabase]:
    with temporary_postgres_database() as database:
        engine = sa.create_engine(database.sync_url)
        try:
            with engine.connect() as connection:
                yield MigrationDatabase(database, connection)
        finally:
            engine.dispose()


def _assert_final_shape(connection: Connection) -> None:
    inspector = sa.inspect(connection)
    table_names = set(inspector.get_table_names())
    assert {"choice_set", "choice_option", "project_profile"} <= table_names
    assert "parameter_option" not in table_names
    assert "description" not in {
        column["name"] for column in inspector.get_columns("project")
    }

    fixed = connection.execute(
        sa.text("SELECT code, version FROM choice_set ORDER BY code")
    ).all()
    assert fixed == [
        ("active_direction", 1),
        ("device_type", 1),
        ("gate_direction", 1),
        ("project_category", 1),
    ]
    assert connection.scalar(sa.text("SELECT count(*) FROM choice_option")) == 0


def _wait_until_session_is_lock_blocked(
    database: TemporaryPostgresDatabase, application_name: str, *, timeout: float = 5
) -> bool:
    observer_engine = sa.create_engine(database.sync_url)
    deadline = time.monotonic() + timeout
    try:
        with observer_engine.connect() as observer:
            while time.monotonic() < deadline:
                wait_event_type = observer.scalar(
                    sa.text(
                        "SELECT wait_event_type FROM pg_stat_activity "
                        "WHERE datname = current_database() "
                        "AND application_name = :application_name"
                    ),
                    {"application_name": application_name},
                )
                if wait_event_type == "Lock":
                    return True
                time.sleep(0.02)
    finally:
        observer_engine.dispose()
    return False


def test_empty_0003_upgrades_to_final_schema(migration_db: MigrationDatabase) -> None:
    migration_db.upgrade("0003")
    migration_db.upgrade("0004")

    assert migration_db.current_revision() == "0004"
    _assert_final_shape(migration_db.connection)


def test_fresh_base_upgrades_to_final_schema(migration_db: MigrationDatabase) -> None:
    migration_db.upgrade("0004")

    assert migration_db.current_revision() == "0004"
    _assert_final_shape(migration_db.connection)


def test_empty_final_schema_can_downgrade_to_0003_for_local_recovery(
    migration_db: MigrationDatabase,
) -> None:
    migration_db.upgrade("0004")
    migration_db.downgrade("0003")

    inspector = sa.inspect(migration_db.connection)
    assert migration_db.current_revision() == "0003"
    assert "choice_set" not in inspector.get_table_names()
    assert "choice_option" not in inspector.get_table_names()
    assert "project_profile" not in inspector.get_table_names()
    assert "parameter_option" in inspector.get_table_names()
    assert "description" in {
        column["name"] for column in inspector.get_columns("project")
    }
    parameter_columns = {
        column["name"]: column for column in inspector.get_columns("parameter")
    }
    assert "choice_set_id" not in parameter_columns
    assert isinstance(parameter_columns["min_value"]["type"], sa.Float)
    assert isinstance(parameter_columns["max_value"]["type"], sa.Float)


def test_preflight_table_locks_block_a_writer_until_destructive_ddl_commits(
    migration_db: MigrationDatabase,
) -> None:
    migration_db.upgrade("0003")
    ddl_reached = Event()
    release_ddl = Event()
    writer_started = Event()
    paused = False

    @event.listens_for(migration_db.connection, "before_cursor_execute")
    def _pause_before_first_ddl(
        _connection, _cursor, statement, _parameters, _context, _many
    ) -> None:
        nonlocal paused
        if not paused and statement.lstrip().startswith("CREATE TABLE choice_set"):
            paused = True
            ddl_reached.set()
            if not release_ddl.wait(timeout=10):
                raise RuntimeError("timed out while pausing the migration before first DDL")

    writer_application_name = "phase26_writer_after_preflight"
    writer_engine = sa.create_engine(
        migration_db.database.sync_url,
        connect_args={"application_name": writer_application_name},
    )

    def _write_parameter() -> None:
        with writer_engine.begin() as connection:
            writer_started.set()
            connection.execute(
                sa.text(
                    "INSERT INTO parameter (code, display_name, value_type) "
                    "VALUES ('after_preflight', 'After preflight', 'text')"
                )
            )

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            migration = executor.submit(migration_db.upgrade, "0004")
            assert ddl_reached.wait(timeout=10)
            writer = executor.submit(_write_parameter)
            assert writer_started.wait(timeout=10)
            writer_was_blocked = _wait_until_session_is_lock_blocked(
                migration_db.database, writer_application_name
            )
            release_ddl.set()
            migration.result(timeout=10)
            writer.result(timeout=10)
        assert writer_was_blocked
        assert migration_db.current_revision() == "0004"
        assert migration_db.connection.scalar(
            sa.text(
                "SELECT count(*) FROM parameter "
                "WHERE code = 'after_preflight'"
            )
        ) == 1
    finally:
        release_ddl.set()
        event.remove(
            migration_db.connection, "before_cursor_execute", _pause_before_first_ddl
        )
        writer_engine.dispose()


def test_writer_committed_before_lock_check_is_seen_and_leaves_0003_unchanged(
    migration_db: MigrationDatabase,
) -> None:
    migration_db.upgrade("0003")
    migration_application_name = "phase26_migration_waiting_for_writer"
    migration_db.connection.execute(
        sa.text("SET application_name = :application_name"),
        {"application_name": migration_application_name},
    )
    migration_db.connection.commit()

    writer_engine = sa.create_engine(migration_db.database.sync_url)
    try:
        with writer_engine.connect() as writer_connection:
            writer_transaction = writer_connection.begin()
            writer_connection.execute(
                sa.text(
                    "INSERT INTO parameter (code, display_name, value_type) "
                    "VALUES ('committed_before_check', 'Committed before check', 'text')"
                )
            )
            with ThreadPoolExecutor(max_workers=1) as executor:
                migration = executor.submit(migration_db.upgrade, "0004")
                migration_waited = _wait_until_session_is_lock_blocked(
                    migration_db.database, migration_application_name
                )
                writer_transaction.commit()
                with pytest.raises(RuntimeError, match="disposable app DB"):
                    migration.result(timeout=10)
            assert migration_waited
    finally:
        writer_engine.dispose()

    inspector = sa.inspect(migration_db.connection)
    assert migration_db.current_revision() == "0003"
    assert "choice_set" not in inspector.get_table_names()
    assert "parameter_option" in inspector.get_table_names()
    assert "description" in {
        column["name"] for column in inspector.get_columns("project")
    }


@pytest.mark.parametrize("table_name", MUTABLE_TABLES)
def test_any_mutable_row_blocks_before_ddl(
    migration_db: MigrationDatabase, table_name: str
) -> None:
    migration_db.upgrade("0003")
    migration_db.insert_guard_row(table_name)

    with pytest.raises(RuntimeError, match="disposable app DB"):
        migration_db.upgrade("0004")

    inspector = sa.inspect(migration_db.connection)
    assert migration_db.current_revision() == "0003"
    assert "choice_set" not in inspector.get_table_names()
    assert "parameter_option" in inspector.get_table_names()
    assert "description" in {
        column["name"] for column in inspector.get_columns("project")
    }


def test_offline_upgrade_is_rejected(migration_db: MigrationDatabase) -> None:
    with pytest.raises(RuntimeError, match="online database connection"):
        migration_db.offline_upgrade("head")


def test_phase_2_6_owned_schema_matches_orm_metadata(
    migration_db: MigrationDatabase,
) -> None:
    migration_db.upgrade("0004")
    inspector = sa.inspect(migration_db.connection)

    for table_name in ("choice_set", "choice_option", "project_profile"):
        model_table = Base.metadata.tables[table_name]
        actual_columns = {
            column["name"]: column for column in inspector.get_columns(table_name)
        }
        assert set(actual_columns) == set(model_table.c.keys())
        for model_column in model_table.c:
            actual = actual_columns[model_column.name]
            assert actual["nullable"] is model_column.nullable
            if isinstance(model_column.type, sa.String):
                assert isinstance(actual["type"], sa.String)
                assert actual["type"].length == model_column.type.length
            elif isinstance(model_column.type, sa.Text):
                assert isinstance(actual["type"], sa.Text)
            elif isinstance(model_column.type, sa.DateTime):
                assert isinstance(actual["type"], sa.DateTime)
                assert actual["type"].timezone is model_column.type.timezone
            elif isinstance(model_column.type, sa.Boolean):
                assert isinstance(actual["type"], sa.Boolean)
            elif isinstance(model_column.type, sa.Integer):
                assert isinstance(actual["type"], sa.Integer)
        primary_key = inspector.get_pk_constraint(table_name)
        assert primary_key["constrained_columns"] == [
            column.name for column in model_table.primary_key.columns
        ]

    choice_defaults = {
        column["name"]: column["default"]
        for column in inspector.get_columns("choice_set")
    }
    assert choice_defaults["is_active"] == "true"
    assert choice_defaults["version"] == "1"
    assert choice_defaults["created_at"] == "now()"
    assert choice_defaults["updated_at"] == "now()"
    option_defaults = {
        column["name"]: column["default"]
        for column in inspector.get_columns("choice_option")
    }
    assert option_defaults["sort_order"] == "0"
    assert option_defaults["is_active"] == "true"
    profile_defaults = {
        column["name"]: column["default"]
        for column in inspector.get_columns("project_profile")
    }
    assert profile_defaults["created_at"] == "now()"
    assert profile_defaults["updated_at"] == "now()"

    parameter_columns = {
        column["name"]: column for column in inspector.get_columns("parameter")
    }
    assert isinstance(parameter_columns["min_value"]["type"], sa.Numeric)
    assert isinstance(parameter_columns["max_value"]["type"], sa.Numeric)
    assert parameter_columns["min_value"]["type"].precision is None
    assert parameter_columns["min_value"]["type"].scale is None
    assert parameter_columns["max_value"]["type"].precision is None
    assert parameter_columns["max_value"]["type"].scale is None
    assert parameter_columns["choice_set_id"]["nullable"] is True

    check_constraints = {
        check["name"]: " ".join(check["sqltext"].split())
        for check in inspector.get_check_constraints("parameter")
    }
    binding = check_constraints["ck_parameter_choice_set_binding"].replace("::text", "")
    assert "value_type = 'choice'" in binding
    assert "choice_set_id IS NOT NULL" in binding
    assert "value_type <> 'choice'" in binding
    assert "choice_set_id IS NULL" in binding

    indexes = {
        (table, index["name"]): index
        for table in ("choice_set", "choice_option", "parameter")
        for index in inspector.get_indexes(table)
    }
    assert indexes[("choice_set", "ix_choice_set_code")]["unique"] is True
    assert indexes[("choice_option", "ix_choice_option_choice_set_id")][
        "column_names"
    ] == ["choice_set_id"]
    assert indexes[("parameter", "ix_parameter_choice_set_id")]["column_names"] == [
        "choice_set_id"
    ]

    option_uniques = {
        constraint["name"]: constraint["column_names"]
        for constraint in inspector.get_unique_constraints("choice_option")
    }
    assert option_uniques["uq_choice_option_set_code"] == ["choice_set_id", "code"]

    choice_fks = inspector.get_foreign_keys("choice_option")
    assert len(choice_fks) == 1
    assert choice_fks[0]["constrained_columns"] == ["choice_set_id"]
    assert choice_fks[0]["referred_table"] == "choice_set"
    assert choice_fks[0].get("options", {}).get("ondelete") == "CASCADE"
    profile_fks = inspector.get_foreign_keys("project_profile")
    assert len(profile_fks) == 1
    assert profile_fks[0]["constrained_columns"] == ["project_id"]
    assert profile_fks[0]["referred_table"] == "project"
    assert profile_fks[0].get("options", {}).get("ondelete") == "CASCADE"
    parameter_fks = [
        foreign_key
        for foreign_key in inspector.get_foreign_keys("parameter")
        if foreign_key["constrained_columns"] == ["choice_set_id"]
    ]
    assert len(parameter_fks) == 1
    assert parameter_fks[0]["referred_table"] == "choice_set"


def test_choice_binding_accepts_valid_orm_rows_and_rejects_invalid_raw_row(
    migration_db: MigrationDatabase,
) -> None:
    migration_db.upgrade("0004")

    with Session(bind=migration_db.connection) as session:
        choice_set = session.scalar(
            sa.select(ChoiceSet).where(ChoiceSet.code == "device_type")
        )
        assert choice_set is not None
        session.add_all(
            [
                Parameter(
                    code="valid_choice",
                    display_name="Valid choice",
                    value_type=ValueType.CHOICE,
                    choice_set=choice_set,
                ),
                Parameter(
                    code="valid_text",
                    display_name="Valid text",
                    value_type=ValueType.TEXT,
                    choice_set=None,
                ),
            ]
        )
        session.commit()

    with pytest.raises(IntegrityError):
        migration_db.connection.execute(
            sa.text(
                "INSERT INTO parameter (code, display_name, value_type, choice_set_id) "
                "VALUES ('invalid_choice', 'Invalid choice', 'choice', NULL)"
            )
        )
    migration_db.connection.rollback()


def test_disposable_preflight_precedes_every_schema_operation() -> None:
    revision_path = (
        _BACKEND_ROOT / "alembic" / "versions" / "0004_project_profile_managed_choices.py"
    )
    if not revision_path.exists():
        pytest.fail("revision 0004 does not exist")
    namespace: dict[str, Any] = {}
    exec(compile(revision_path.read_text(), str(revision_path), "exec"), namespace)
    upgrade = namespace["upgrade"]
    source = inspect.getsource(upgrade)
    preflight_position = source.index("_assert_disposable_database(bind)")
    prefix = source[:preflight_position]
    for forbidden in (
        "op.create_table",
        "op.add_column",
        "op.alter_column",
        "op.drop_column",
        "op.drop_table",
        "op.bulk_insert",
        "op.execute",
    ):
        assert forbidden not in prefix
