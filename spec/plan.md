# Implementation Plan: Step Master Integration via Airflow

## Phase 0 — Scope Guardrail
1. This repository will include only:
   - DAG definitions
   - SQL/DB migration artifacts for service DB
2. This repository will explicitly exclude:
   - Airflow runtime/environment provisioning
   - Any `docker-compose` Airflow service additions
3. External Airflow runtime is assumed and managed separately.

## Phase 1 — Service DB Data Model
Create service-side operational tables:

1. `step_current` (latest serving table)
2. `step_event_audit` (incremental append history)
3. `sync_watermark` (incremental cursor)
4. `etl_run_log` / `etl_run_line_status` (observability + recovery)

## Phase 2 — Airflow DAG A (Hourly Full to Current)
DAG: `full_to_current_hourly`
Schedule: `40 * * * *`

Task flow:
1. `build_line_list` (from managed whitelist)
2. `extract_stage_line` (dynamic mapped per line)
3. `validate_line_load` (dynamic mapped)
4. `merge_current_line` (dynamic mapped)
5. `delete_missing_line` (dynamic mapped)
6. `finalize_run`

Operational behaviors:
- Partial success allowed.
- Line-level retries.
- Guardrail to skip delete if staged count is abnormally low/zero.
- If source full load is not ready at schedule time, skip the run and emit a skip metric/event.
- Reappeared keys after deletion are handled as normal inserts (new registration semantics).

## Phase 3 — Airflow DAG B (Daily Incremental Audit)
DAG: `incremental_audit_daily`

Task flow:
1. `read_incremental_since_watermark`
2. `append_step_event_audit`
3. `run_incremental_dq_checks`
4. `update_watermark`
5. `publish_metrics`

## Phase 4 — Service Integration
1. Update data access path for project layer retrieval to use `step_current`.
2. Keep backbone sourcing unchanged (approved-project based).
3. Add fallback/error handling for temporary data staleness.

## Phase 5 — Validation and Rollout
1. Dry-run in staging with sampled lines.
2. Parallel run with existing data path.
3. Reconciliation checks (row counts + key consistency).
4. Production cutover.
5. Hypercare monitoring window.

## Recovery Strategy
- Persist per-line task state in `etl_run_line_status`.
- Re-run failed lines only.
- Keep merge/delete idempotent.

## Monitoring
Track per run/line:
- extracted rows
- merged rows
- deleted rows
- duration
- failed lines
- quality check violations
