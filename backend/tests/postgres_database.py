"""Guarded disposable PostgreSQL databases for destructive integration tests."""

from __future__ import annotations

import os
import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import URL, Connection, make_url

_DATABASE_NAME_RE = re.compile(r"^pcm_phase26_test_[0-9a-f]+$")


@dataclass(frozen=True)
class TemporaryPostgresDatabase:
    """Connection URLs for one test-owned database."""

    name: str
    async_url: str
    sync_url: str


def _render(url: URL) -> str:
    return url.render_as_string(hide_password=False)


def _sync_url(url: URL) -> URL:
    if not url.drivername.startswith("postgresql"):
        raise RuntimeError("APP_TEST_DATABASE_URL must be a PostgreSQL URL")
    return url.set(drivername="postgresql+psycopg2")


def _assert_guarded_name(database_name: str) -> None:
    if _DATABASE_NAME_RE.fullmatch(database_name) is None:
        raise RuntimeError(f"refusing destructive database operation for {database_name!r}")


def _create_database(connection: Connection, database_name: str) -> None:
    _assert_guarded_name(database_name)
    connection.exec_driver_sql(f'CREATE DATABASE "{database_name}"')


def _drop_database(connection: Connection, database_name: str) -> None:
    _assert_guarded_name(database_name)
    connection.execute(
        sa.text(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = :database_name AND pid <> pg_backend_pid()"
        ),
        {"database_name": database_name},
    )
    connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{database_name}"')


@contextmanager
def temporary_postgres_database() -> Iterator[TemporaryPostgresDatabase]:
    """Create and always drop a UUID-named database derived from test credentials only."""

    configured = os.environ.get("APP_TEST_DATABASE_URL")
    if not configured:
        raise RuntimeError("APP_TEST_DATABASE_URL is required for PostgreSQL integration tests")

    source_url = make_url(configured)
    admin_url = _sync_url(source_url.set(database="postgres"))
    database_name = f"pcm_phase26_test_{uuid.uuid4().hex}"
    _assert_guarded_name(database_name)
    test_async_url = source_url.set(database=database_name, drivername="postgresql+asyncpg")
    test_sync_url = _sync_url(test_async_url)
    engine = sa.create_engine(admin_url, isolation_level="AUTOCOMMIT")
    created = False

    try:
        with engine.connect() as connection:
            _create_database(connection, database_name)
        created = True
        print(f"created temporary PostgreSQL database: {database_name}")
        yield TemporaryPostgresDatabase(
            name=database_name,
            async_url=_render(test_async_url),
            sync_url=_render(test_sync_url),
        )
    finally:
        try:
            if created:
                with engine.connect() as connection:
                    _drop_database(connection, database_name)
                print(f"dropped temporary PostgreSQL database: {database_name}")
        finally:
            engine.dispose()
