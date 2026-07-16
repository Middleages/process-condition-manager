"""Static guardrails for repository PostgreSQL test fixtures."""

from __future__ import annotations

import ast
from pathlib import Path
from typing import cast

import pytest
from sqlalchemy.engine import Connection

_PG_FIXTURE_GLOBS = (
    "backend/tests/**/*pg*.py",
    "backend/tests/migrations/*_pg.py",
    "backend/tests/scripts/test_*_pg.py",
)


def _pg_fixture_files() -> list[Path]:
    repo_root = Path(__file__).resolve().parents[2]
    files: set[Path] = set()
    for pattern in _PG_FIXTURE_GLOBS:
        files.update(repo_root.glob(pattern))
    return sorted(files)


def _function_source(path: Path, function_name: str) -> str:
    tree = ast.parse(path.read_text())
    for node in tree.body:
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and node.name == function_name:
            return ast.get_source_segment(path.read_text(), node) or ""
    raise AssertionError(f"{path} missing {function_name} definition")


def test_pg_fixtures_route_destructive_setup_through_temporary_postgres_database() -> None:
    offenders: list[str] = []
    for path in _pg_fixture_files():
        text = path.read_text()
        if (
            "create_async_engine(_PG_URL)" in text
            or "engine = create_async_engine(_PG_URL)" in text
        ):
            offenders.append(f"{path}: creates engine directly from APP_TEST_DATABASE_URL")
        if (
            (
                "run_sync(Base.metadata.drop_all)" in text
                or "run_sync(Base.metadata.create_all)" in text
            )
            and "temporary_postgres_database" not in text
        ):
            offenders.append(
                f"{path}: destructive metadata sync not wrapped by "
                "temporary_postgres_database"
            )
        if "DROP DATABASE" in text and path.name != "postgres_database.py":
            offenders.append(
                f"{path}: raw DROP DATABASE is only allowed in tests.postgres_database"
            )

        if "temporary_postgres_database" in text and "async def pg_engine" in text:
            pg_engine_source = _function_source(path, "pg_engine")
            if "run_sync(Base.metadata.drop_all)" in pg_engine_source:
                offenders.append(
                    f"{path}: pg_engine fixture must not call "
                    "Base.metadata.drop_all before helper cleanup"
                )
            if "await engine.dispose()" not in pg_engine_source:
                offenders.append(f"{path}: pg_engine fixture must dispose the engine")

    assert not offenders, "unsafe PostgreSQL fixture patterns found:\n" + "\n".join(offenders)


def test_sqlite_fixture_drop_all_remains_allowed_for_non_guarded_in_memory_db() -> None:
    path = (
        Path(__file__).resolve().parents[2]
        / "backend/tests/features/test_projects_parameter_registry_repository.py"
    )
    sqlite_engine_source = _function_source(path, "sqlite_engine")

    assert "run_sync(Base.metadata.drop_all)" in sqlite_engine_source
    assert "temporary_postgres_database" not in sqlite_engine_source


def test_guarded_database_name_pattern_accepts_only_phase26_child_databases() -> None:
    from tests.postgres_database import _DATABASE_NAME_RE

    assert _DATABASE_NAME_RE.fullmatch("pcm_phase26_test_deadbeef") is not None
    assert _DATABASE_NAME_RE.fullmatch("pcm_phase26_test_1234567890abcdef") is not None
    assert _DATABASE_NAME_RE.fullmatch("pcm") is None
    assert _DATABASE_NAME_RE.fullmatch("postgres") is None
    assert _DATABASE_NAME_RE.fullmatch("pcm_phase26_test") is None


def test_drop_database_terminates_sessions_before_dropping_child_database() -> None:
    from tests.postgres_database import _drop_database

    calls: list[tuple[str, str, object | None]] = []

    class FakeConnection:
        def execute(self, statement: object, params: dict[str, str]) -> None:
            calls.append(("execute", str(statement), params))

        def exec_driver_sql(self, sql: str) -> None:
            calls.append(("exec_driver_sql", sql, None))

    _drop_database(cast(Connection, FakeConnection()), "pcm_phase26_test_deadbeef")

    assert calls == [
        (
            "execute",
            (
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = :database_name AND pid <> pg_backend_pid()"
            ),
            {"database_name": "pcm_phase26_test_deadbeef"},
        ),
        (
            "exec_driver_sql",
            'DROP DATABASE IF EXISTS "pcm_phase26_test_deadbeef"',
            None,
        ),
    ]


def test_drop_database_rejects_untrusted_names_before_emitting_sql() -> None:
    from tests.postgres_database import _drop_database

    calls: list[str] = []

    class FakeConnection:
        def execute(self, statement: object, params: dict[str, str]) -> None:
            calls.append(f"execute:{statement}:{params}")

        def exec_driver_sql(self, sql: str) -> None:
            calls.append(f"exec:{sql}")

    with pytest.raises(RuntimeError, match="refusing destructive database operation"):
        _drop_database(cast(Connection, FakeConnection()), "pcm")

    assert calls == []
