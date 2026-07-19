"""Phase 5 migration regression checks for revision and active identity constraints."""

from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from re import DOTALL, findall
from typing import cast

import pytest
import sqlalchemy as sa
from alembic.config import Config
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from alembic import command
from tests.postgres_database import TemporaryPostgresDatabase, temporary_postgres_database

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")
_MIGRATION_FILE = (
    _BACKEND_ROOT / "alembic" / "versions" / "0008_project_review_and_revision_workflow.py"
)


def _config(database: TemporaryPostgresDatabase) -> Config:
    config = Config(str(_BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(_BACKEND_ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", database.sync_url)
    return config


@dataclass(frozen=True)
class MigrationHarness:
    database: TemporaryPostgresDatabase
    connection: Connection

    def upgrade(self, revision: str) -> None:
        cfg = _config(self.database)
        cfg.attributes["connection"] = self.connection
        self.connection.commit()
        command.upgrade(cfg, revision)

    def downgrade(self, revision: str) -> None:
        cfg = _config(self.database)
        cfg.attributes["connection"] = self.connection
        self.connection.commit()
        command.downgrade(cfg, revision)


def _insert_project(
    *,
    connection: Connection,
    line_id: str,
    process_id: str,
    part_id: str,
    name: str,
    status: str,
    version: int | None = None,
    revision_root_id: int | None = None,
    revision_of_id: int | None = None,
    include_workflow_columns: bool = False,
) -> int:
    if include_workflow_columns:
        columns = [
            "line_id",
            "process_id",
            "part_id",
            "name",
            "status",
            "version",
            "revision_root_id",
            "revision_of_id",
        ]
        values = [
            ":line_id",
            ":process_id",
            ":part_id",
            ":name",
            ":status",
            ":version",
            ":revision_root_id",
            ":revision_of_id",
        ]
        if version is None:
            columns.remove("version")
            values.remove(":version")
        if revision_root_id is None:
            columns.remove("revision_root_id")
            values.remove(":revision_root_id")
        if revision_of_id is None:
            columns.remove("revision_of_id")
            values.remove(":revision_of_id")

        query = f"""
            INSERT INTO project (
                {", ".join(columns)}
            )
            VALUES ({", ".join(values)})
            RETURNING id
            """
    else:
        columns = ["line_id", "process_id", "part_id", "name", "status"]
        query = f"""
            INSERT INTO project (
                {", ".join(columns)}
            )
            VALUES (:line_id, :process_id, :part_id, :name, :status)
            RETURNING id
            """
    row = connection.execute(
        sa.text(
            query,
        ),
        {
            "line_id": line_id,
            "process_id": process_id,
            "part_id": part_id,
            "name": name,
            "status": status,
            "version": version,
            "revision_root_id": revision_root_id,
            "revision_of_id": revision_of_id,
        },
    ).scalar_one()
    return cast(int, row)


@pytest.fixture
def migration_db() -> Iterator[MigrationHarness]:
    with temporary_postgres_database() as database:
        engine = sa.create_engine(database.sync_url)
        try:
            with engine.connect() as connection:
                yield MigrationHarness(database=database, connection=connection)
        finally:
            engine.dispose()


def test_phase5_migration_backfill_and_unique_identities(migration_db: MigrationHarness) -> None:
    migration_db.upgrade("0007")

    legacy_status_upper_id = _insert_project(
        connection=migration_db.connection,
        line_id="LN-200",
        process_id="PROC-C",
        part_id="PART-C",
        name="legacy-status-upper",
        status="ARCHIVED",
        include_workflow_columns=False,
    )

    base_project_id = _insert_project(
        connection=migration_db.connection,
        line_id="LN-100",
        process_id="PROC-B",
        part_id="PART-A",
        name="base",
        status="draft",
        include_workflow_columns=False,
    )

    migration_db.upgrade("0008")

    rows = migration_db.connection.execute(
        sa.text("SELECT id, revision_root_id, version FROM project")
    ).fetchall()
    for project_id, revision_root_id, version in rows:
        if project_id == base_project_id:
            assert revision_root_id == base_project_id
            assert version == 1

    archived_one = _insert_project(
        connection=migration_db.connection,
        line_id="LN-100",
        process_id="PROC-B",
        part_id="PART-A",
        name="archived-1",
        status="archived",
        version=5,
        revision_root_id=base_project_id,
        revision_of_id=base_project_id,
        include_workflow_columns=True,
    )
    archived_two = _insert_project(
        connection=migration_db.connection,
        line_id="LN-100",
        process_id="PROC-B",
        part_id="PART-A",
        name="archived-2",
        status="archived",
        version=6,
        revision_root_id=base_project_id,
        revision_of_id=archived_one,
        include_workflow_columns=True,
    )
    assert archived_one != archived_two
    with migration_db.connection.begin_nested():
        with pytest.raises(IntegrityError):
            _insert_project(
                connection=migration_db.connection,
                line_id="LN-100",
                process_id="PROC-B",
                part_id="PART-A",
                name="active-conflict",
                status="draft",
            )

    _insert_project(
        connection=migration_db.connection,
        line_id="LN-300",
        process_id="PROC-R",
        part_id="R-A",
        name="revision-1",
        status="approved",
        version=2,
        revision_root_id=base_project_id,
        revision_of_id=base_project_id,
        include_workflow_columns=True,
    )

    with migration_db.connection.begin_nested():
        with pytest.raises(IntegrityError):
            _insert_project(
                connection=migration_db.connection,
                line_id="LN-301",
                process_id="PROC-R",
                part_id="R-B",
                name="revision-conflict-version",
                status="approved",
                version=2,
                revision_root_id=base_project_id,
                revision_of_id=base_project_id,
                include_workflow_columns=True,
            )

    with migration_db.connection.begin_nested():
        with pytest.raises(IntegrityError):
            _insert_project(
                connection=migration_db.connection,
                line_id="LN-302",
                process_id="PROC-R",
                part_id="R-C",
                name="revision-conflict-sibling",
                status="approved",
                version=3,
                revision_root_id=base_project_id,
                revision_of_id=base_project_id,
                include_workflow_columns=True,
            )

    assert (
        migration_db.connection.scalar(
            sa.text("SELECT status FROM project WHERE id = :id"),
            {"id": legacy_status_upper_id},
        )
        == "archived"
    )


def test_phase5_migration_schema_contracts(migration_db: MigrationHarness) -> None:
    migration_db.upgrade("0008")

    inspector = sa.inspect(migration_db.connection)
    unique_constraints = {
        constraint["name"]: set(constraint["column_names"])
        for constraint in inspector.get_unique_constraints("project")
    }
    assert unique_constraints["uq_project_revision_root_version"] == {
        "revision_root_id",
        "version",
    }
    assert unique_constraints["uq_project_direct_successor"] == {"revision_of_id"}
    assert "uq_project_process_part" not in unique_constraints

    indexes = {index["name"]: index for index in inspector.get_indexes("project")}
    active_unique = indexes["ix_project_active_line_process_part"]
    assert active_unique["unique"] is True
    assert active_unique["column_names"] == ["line_id", "process_id", "part_id"]
    # SQLite does not expose predicate text consistently, so this contract is only
    # asserted by migration SQL shape elsewhere.

    review_comment_fks = sa.inspect(migration_db.connection).get_foreign_keys("review_comment")
    assert not any(
        fk.get("referred_table") == "layer_condition"
        and "condition_id" in fk["constrained_columns"]
        for fk in review_comment_fks
    )
    columns = {
        column["name"]: column
        for column in sa.inspect(migration_db.connection).get_columns("review_comment")
    }
    assert columns["created_at"]["nullable"] is False
    assert columns["updated_at"]["nullable"] is False

    # Legacy full-identity uniqueness is restored on downgrade via unique constraint.
    migration_db.downgrade("0007")
    inspector = sa.inspect(migration_db.connection)
    unique_constraints = {
        constraint["name"]: set(constraint["column_names"])
        for constraint in inspector.get_unique_constraints("project")
    }
    assert unique_constraints["uq_project_process_part"] == {
        "line_id",
        "process_id",
        "part_id",
    }


def test_phase5_migration_definition_uses_portable_unique_constraints() -> None:
    source = _MIGRATION_FILE.read_text(encoding="utf-8")
    for block in findall(
        r"create_unique_constraint\([^)]+\)",
        source,
        flags=DOTALL,
    ):
        assert "sqlite_where=" not in block
