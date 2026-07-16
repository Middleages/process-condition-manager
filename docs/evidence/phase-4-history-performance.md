# Phase 4 History performance evidence

## Current state

- Task 5 remains in progress.
- The performance fixture test file is now aligned with the latest writer-shape guidance:
  - structured condition add/remove envelopes
  - structured POR fields
  - project create payload fields from production writer shape
  - backbone layer replace payload fields and exact batch-id binding
- The exact 0007 plan gate for the unfiltered timeline remains an honest RED.

## Verified commands

- `uv run ruff check tests/performance/test_history_performance_pg.py` ✅
- `uv run pyright tests/performance/test_history_performance_pg.py` ✅
- `APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@127.0.0.1:15432/pcm uv run pytest -q tests/performance/test_history_performance_pg.py::test_history_fixture_builder_seeds_expected_counts` ✅
- `APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@127.0.0.1:15432/pcm uv run pytest -q tests/performance/test_history_performance_pg.py::test_history_timeline_preview_query_uses_explicit_columns_only tests/performance/test_history_performance_pg.py::test_history_query_plans_use_expected_indexes` → 1 passed, 1 failed

## Remaining blocker

- Failing label: `unfiltered timeline`
- Expected index: `ix_change_event_project_id_id_desc`
- Actual planner choice: `change_event_pkey`

## Notes

- No planner forcing, fallback, or fixture gaming was added.
- The next production-bound step is the grouped HistoryRepository/service SQL path from the earlier task handoff.
