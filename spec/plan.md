# Implementation Plan: Step Master Integration via Airflow

## Implementation Status (2026-04-01)
- ✅ Phase 1 schema/model baseline merged (`step_current`, `step_event_audit`, `sync_watermark`, `etl_run_*`)
- ✅ `etl_run_log.airflow_dag_run_id` is included directly in base migration (single-head strategy)
- ✅ Project create V2 path now supports `USE_STEP_CURRENT` feature flag and `step_current` layer lookup fallback
- ✅ `step_current` 레이어 조회에 natural sort 적용 및 fallback 경고 로그/중복 layer_id 감지(409) 추가
- ✅ `selected_layer_refs(layer_id, step_seq)` 입력 지원으로 step_current 중복 layer_id 케이스 선택 가능
- ⏳ Next focus: implement real DB I/O in DAG tasks (B2/B3/C1~C4)

## Execution Principles
- **Two-DB read / one-DB serve**: upstream(full/incremental) reads are isolated in DAG tasks, and service reads only `step_current`.
- **Line-first failure isolation**: every critical full-sync step is line-scoped to allow selective reruns.
- **Idempotent by default**: merge/delete/watermark logic must be safely rerunnable.
- **Safe-delete policy**: no physical delete when stage integrity checks fail.

## Phase 0 — Scope Guardrail
1. This repository will include only:
   - DAG definitions
   - SQL/DB migration artifacts for service DB
2. This repository will explicitly exclude:
   - Airflow runtime/environment provisioning
   - Any `docker-compose` Airflow service additions
3. External Airflow runtime is assumed and managed separately.

## Phase 1 — Service DB Data Model (Week 1)
Create service-side operational tables:

1. `step_current` (latest serving table)
2. `step_event_audit` (incremental append history)
3. `sync_watermark` (incremental cursor)
4. `etl_run_log` / `etl_run_line_status` (observability + recovery)

Detailed design:
- `step_current`
  - PK: `(line_id, process_id, step_seq)`
  - Required indexes:
    - `(line_id, process_id)` for layer selection query
    - `(updated_at)` for freshness checks
- `step_event_audit`
  - Append-only history from incremental source
  - Include ingestion metadata: `ingested_at`, `dag_run_id`, `source_batch_ts`
- `sync_watermark`
  - Keyed by pipeline name (`step_incremental`)
  - Fields: `last_event_ts`, `last_sys_key_vals`, `updated_at`
- `etl_run_log` / `etl_run_line_status`
  - `etl_run_log`: run-level start/end/status/error summary
  - `etl_run_line_status`: line-level row counts, retries, failure reason

Outputs:
- Alembic migration scripts
- rollback-safe SQL notes
- sample verification query set

## Phase 2 — Airflow DAG A (Hourly Full to Current, Week 2)
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

Implementation notes:
- `build_line_list`
  - read from managed whitelist variable (no discovery SQL in prod path)
  - write resolved line list to XCom for mapped tasks
- `extract_stage_line`
  - load each `fab_f_step_{lineid}` to temp/stage table with run id and line id
  - capture extracted count and source max timestamp
- `validate_line_load`
  - checks: null key rate, duplicate PK count, minimum row threshold
  - produce `is_delete_allowed` flag per line
- `merge_current_line`
  - upsert by `(line_id, process_id, step_seq)` and set audit columns
- `delete_missing_line`
  - execute only when `is_delete_allowed=true`
  - delete keys in current but absent in staged snapshot for that line
- `finalize_run`
  - aggregate line status to `etl_run_log`
  - emit metrics: success ratio, failed lines, skipped lines, delete volume

## Phase 3 — Airflow DAG B (Daily Incremental Audit, Week 3)
DAG: `incremental_audit_daily`

Task flow:
1. `read_incremental_since_watermark`
2. `append_step_event_audit`
3. `run_incremental_dq_checks`
4. `update_watermark`
5. `publish_metrics`

Implementation notes:
- watermark strategy: `(event_ts, sys_key_vals)` composite cursor to avoid same-timestamp loss
- append policy: audit table is immutable insert-only
- DQ checks:
  - null in `(line_id, process_id, step_seq)` = fail
  - unexpected `del_yn` domain = warn/fail per threshold
  - duplicate event identity within batch = warn
- watermark update only after successful append + DQ pass

## Phase 4 — Service Integration (Week 4)
1. Update data access path for project layer retrieval to use `step_current`.
2. Keep backbone sourcing unchanged (approved-project based).
3. Add fallback/error handling for temporary data staleness.

Implementation notes:
- add repository function: `get_steps_by_line_process(line_id, process_id)`
- guard by feature flag (`USE_STEP_CURRENT`)
- stale-data fallback:
  - if latest successful sync > SLA threshold, log warning and return controlled error response
  - no runtime upstream direct query fallback (avoid coupling regression)

## Phase 5 — Validation and Rollout (Week 5)
1. Dry-run in staging with sampled lines.
2. Parallel run with existing data path.
3. Reconciliation checks (row counts + key consistency).
4. Production cutover.
5. Hypercare monitoring window.

Validation matrix:
- Functional:
  - line-level partial retry works without full rerun
  - missing-row delete executes only on valid stage
  - reappeared key inserted correctly
- Data quality:
  - key uniqueness in `step_current`
  - null key rejection in both DAGs
  - hourly freshness < 90 minutes
- Operational:
  - skip run when upstream not ready
  - metric/alert emission and run-log persistence

## Recovery Strategy
- Persist per-line task state in `etl_run_line_status`.
- Re-run failed lines only.
- Keep merge/delete idempotent.

Runbook summary:
1. Identify failed `line_id` from `etl_run_line_status`.
2. Fix source/connection issue.
3. Trigger rerun for failed mapped tasks only.
4. Verify merged/deleted counts against expected deltas.
5. Close incident with run id and root cause.

## Monitoring
Track per run/line:
- extracted rows
- merged rows
- deleted rows
- duration
- failed lines
- quality check violations

Alert thresholds (initial):
- critical: hourly DAG no successful completion for 2 consecutive schedules
- warning: freshness over 90 minutes
- warning: delete volume > configured percentage per line
