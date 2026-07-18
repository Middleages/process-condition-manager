# Phase 4 disposable PostgreSQL safety guard

## Scope

Task 18 hardened the repository PostgreSQL test fixtures so destructive setup only runs against a guarded disposable child database created by `tests.postgres_database.temporary_postgres_database()`.

This work stayed inside `backend/tests/**` and `docs/evidence/**`.
It did **not** touch application production code, models, migrations, or any live review database.

## Unsafe patterns found and corrected

The audit found four PostgreSQL fixture files still creating engines directly from `APP_TEST_DATABASE_URL` and/or running `Base.metadata.drop_all/create_all` against the shared base URL:

- `backend/tests/features/test_choice_consumers_pg.py`
- `backend/tests/features/test_choice_sets_pg.py`
- `backend/tests/features/test_locks_pg.py`
- `backend/tests/features/test_projects_pg_writer_contracts.py`

Each of those tests now uses `temporary_postgres_database()` so table creation and teardown happen only inside the generated `pcm_phase26_test_*` child database.

## Guard coverage

Added a static guard suite that:

- audits repository PostgreSQL fixture files for direct destructive setup patterns;
- verifies the disposable database name regex only accepts `pcm_phase26_test_*` children;
- proves `_drop_database()` terminates live sessions before dropping;
- proves `_drop_database()` rejects untrusted names before emitting SQL.

Added a runtime probe that:

- creates a guarded disposable child database;
- connects to it and confirms `current_database()` matches the generated name;
- confirms teardown removes the database by treating the expected `asyncpg.exceptions.InvalidCatalogNameError` as success when reconnecting.

## Verification

Commands ran from `backend/` with `APP_TEST_DATABASE_URL='<guard-admin-url>'`:

- `uv run ruff check tests/postgres_database.py tests/test_postgres_database_guard.py tests/test_postgres_database_runtime.py tests/features/test_choice_consumers_pg.py tests/features/test_choice_sets_pg.py tests/features/test_locks_pg.py tests/features/test_projects_pg_writer_contracts.py`
- `uv run pyright tests/postgres_database.py tests/test_postgres_database_guard.py tests/test_postgres_database_runtime.py tests/features/test_choice_consumers_pg.py tests/features/test_choice_sets_pg.py tests/features/test_locks_pg.py tests/features/test_projects_pg_writer_contracts.py`
- `uv run pytest -q tests/test_postgres_database_guard.py tests/test_postgres_database_runtime.py tests/features/test_choice_consumers_pg.py tests/features/test_choice_sets_pg.py tests/features/test_locks_pg.py tests/features/test_projects_pg_writer_contracts.py tests/features/test_projects_pg_source_capture.py tests/features/test_writer_atomicity_pg.py`

Results:

- Ruff: passed
- Pyright: `0 errors, 0 warnings, 0 informations`
- Pytest: `37 passed in 51.87s`

## Notes

`tests.postgres_database` already contained the protective child-database guardrails (`pcm_phase26_test_*` naming, session termination before drop, and a separate admin/base connection flow). This task aligned the remaining PostgreSQL fixtures to that helper and added regression evidence so future edits do not reintroduce shared-database destructive setup.
