"""Runtime proof for the guarded disposable PostgreSQL helper."""

from __future__ import annotations

import asyncio
import os
import re
from contextlib import suppress

import asyncpg
import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from tests.postgres_database import temporary_postgres_database

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL 미설정")

@pytest.mark.asyncio
async def test_temporary_postgres_database_creates_child_and_cleans_it_up() -> None:
    assert _PG_URL is not None
    child_engine: AsyncEngine | None = None
    child_conn: AsyncConnection | None = None
    child_url = ""

    try:
        with temporary_postgres_database() as database:
            child_url = database.async_url
            assert re.fullmatch(r"pcm_phase26_test_[0-9a-f]+", database.name)
            child_engine = create_async_engine(database.async_url)
            assert child_engine is not None
            child_conn = await child_engine.connect()
            assert child_conn is not None
            current_database = await child_conn.scalar(text("SELECT current_database()"))
            assert current_database == database.name

        for _ in range(20):
            retry_engine = create_async_engine(child_url)
            try:
                async with retry_engine.connect():
                    pass
            except (OperationalError, asyncpg.exceptions.InvalidCatalogNameError):
                break
            finally:
                await retry_engine.dispose()
            await asyncio.sleep(0.1)
        else:
            raise AssertionError("child database still accepts new connections after teardown")
    finally:
        if child_conn is not None:
            with suppress(Exception):
                await child_conn.close()
        if child_engine is not None:
            await child_engine.dispose()
