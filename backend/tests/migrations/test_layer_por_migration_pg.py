"""Revision 0009 POR-gap backfill evidence on isolated PostgreSQL."""

from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config
from sqlalchemy.engine import Connection

from alembic import command
from tests.postgres_database import TemporaryPostgresDatabase, temporary_postgres_database

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.skipif(
    os.environ.get("APP_TEST_DATABASE_URL") is None,
    reason="APP_TEST_DATABASE_URL 미설정",
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
        config = _config(self.database)
        config.attributes["connection"] = self.connection
        self.connection.commit()
        command.upgrade(config, revision)


@pytest.fixture
def migration_db() -> Iterator[MigrationHarness]:
    with temporary_postgres_database() as database:
        engine = sa.create_engine(database.sync_url)
        try:
            with engine.connect() as connection:
                yield MigrationHarness(database, connection)
        finally:
            engine.dispose()


def _insert_layer(connection: Connection, project_id: int, layer_key: str) -> int:
    return int(
        connection.execute(
            sa.text(
                """
                INSERT INTO sheet_layer
                    (project_id, layer_key, step_seq, layer_id, sort_order)
                VALUES
                    (:project_id, :layer_key, :layer_key, :layer_key, 0)
                RETURNING id
                """
            ),
            {"project_id": project_id, "layer_key": layer_key},
        ).scalar_one()
    )


def _insert_condition(
    connection: Connection, layer_id: int, *, label: str, condition_index: int
) -> int:
    return int(
        connection.execute(
            sa.text(
                """
                INSERT INTO layer_condition (layer_id, label, condition_index, is_por)
                VALUES (:layer_id, :label, :condition_index, false)
                RETURNING id
                """
            ),
            {"layer_id": layer_id, "label": label, "condition_index": condition_index},
        ).scalar_one()
    )


def test_0009_backfills_lowest_condition_in_every_layer_with_por_gap(
    migration_db: MigrationHarness,
) -> None:
    migration_db.upgrade("0008")
    project_id = int(
        migration_db.connection.execute(
            sa.text(
                """
                INSERT INTO project (line_id, process_id, part_id, name, status)
                VALUES ('LINE', 'PROC', 'PART', 'por migration', 'draft')
                RETURNING id
                """
            )
        ).scalar_one()
    )
    single_layer_id = _insert_layer(migration_db.connection, project_id, "single")
    multi_layer_id = _insert_layer(migration_db.connection, project_id, "multi")
    single_id = _insert_condition(
        migration_db.connection, single_layer_id, label="only", condition_index=7
    )
    higher_id = _insert_condition(
        migration_db.connection, multi_layer_id, label="higher", condition_index=20
    )
    lowest_id = _insert_condition(
        migration_db.connection, multi_layer_id, label="lowest", condition_index=10
    )
    migration_db.connection.commit()

    migration_db.upgrade("0009")

    rows = migration_db.connection.execute(
        sa.text(
            """
            SELECT layer_id,
                   count(*) FILTER (WHERE is_por) AS por_count,
                   min(condition_index) FILTER (WHERE is_por) AS por_index,
                   min(id) FILTER (WHERE is_por) AS por_id
            FROM layer_condition
            GROUP BY layer_id
            ORDER BY layer_id
            """
        )
    ).all()
    assert rows == [
        (single_layer_id, 1, 7, single_id),
        (multi_layer_id, 1, 10, lowest_id),
    ]
    assert higher_id != lowest_id
