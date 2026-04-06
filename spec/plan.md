# Implementation Plan: Step Master Integration via Airflow

## Implementation Status (2026-04-02)
- ✅ Phase 1 schema/model baseline merged (`step_current`, `step_event_audit`, `sync_watermark`, `etl_run_*`)
- ✅ `etl_run_log.airflow_dag_run_id` is included directly in base migration (single-head strategy)
- ✅ Project create V2 path now supports `USE_STEP_CURRENT` feature flag and `step_current` layer lookup fallback
- ✅ `step_current` 레이어 조회에 natural sort 적용 및 fallback 경고 로그/중복 layer_id 감지(409) 추가
- ✅ `selected_layer_refs(layer_id, step_seq)` 입력 지원으로 step_current 중복 layer_id 케이스 선택 가능
- ✅ Hourly DAG guardrail scaffolding 확장: upstream ready skip, min stage row threshold, line-status 분류/요약, delete-block reason payload
- ✅ Incremental DAG DQ scaffolding 확장: row-level DQ(null key / invalid del_yn / duplicate event), candidate cursor 자동 산출
- ✅ `etl_run_log` / `etl_run_line_status` persistence 연결 완료 (STEP_SERVICE_DB_URL 기반)
- ✅ `sync_watermark` read/write 연결 완료 (pipeline: `step_incremental`)
- ✅ `merge_current_line` / `delete_missing_line` DB write path 연결 완료 (stage_table 기반)
- ✅ Incremental backfill bounded-window 실행 경로 구현 (`STEP_INCREMENTAL_BACKFILL_*`)
- ✅ `etl_run_log` finalize 시 extracted/merged/deleted/duration 집계 컬럼 업데이트
- ✅ Incremental source-side predicate pushdown + audit append DB write 연결 (`C1/C2`)
- ✅ Incremental DAG run-log init/finalize 연결 및 C5 metric payload 표준화
- ✅ merge/delete 재실행(idempotency) 단위 테스트 추가로 line rerun 안정성 검증(`B12`)
- ✅ 서비스 `create_project_v2` 경로에 step_current freshness guard(120분 SLA, stale 시 503) 반영(`D5`)
- ✅ `USE_STEP_CURRENT` flag ON/OFF 경로 통합 테스트 추가(ON=fresh step_current, OFF=layer_master fallback) (`D6`)
- ✅ DAG/service 경고 로그 훅 추가(실패 라인, delete block, incremental DQ, stale freshness) (`E3` 기초 신호)
- ✅ 운영 runbook 초안 추가(E2/E3/E5/E6/E7: 복구절차, 알림정책, 대시보드, severity, cutover/rollback)
- ✅ `step_master_reconciliation_daily` DAG 및 DB 리컨실 report helper 추가(`E4`)
- ✅ DAG 기본 운영파라미터 반영(retries, retry_delay, pool, max_active_runs) (`E1`)
- ✅ legacy backbone 생성 플로우 회귀 테스트 추가(`D4`)
- ✅ Webhook 기반 운영 알림 이벤트 emitter 추가(`STEP_ALERT_WEBHOOK_URL`)
- ✅ `step_master_healthcheck_hourly` 추가(서비스 freshness/watermark breach 시 critical alert + fail)
- ✅ 실DB 사전 점검용 validation CLI 추가(`scripts/step_master_db_validation.py`)
- ✅ rollback SQL 초안 추가(`spec/step_master_rollback.sql`) 및 Epic A 완료
- ✅ `step_current` serving/physical delete 핵심 시나리오 테스트로 acceptance 보강
- ✅ 코드리뷰 지적 보완: validation CLI missing-table fail-safe, runbook SQL 예시 수정, DAG TODO(핵심 3건) 정리
- ⏳ Next focus: staging/prod 실제 DB 대상 validation 실행 및 결과 검증 + M5 cutover/hypercare evidence

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
  - read from managed Airflow Variable (no discovery SQL in prod path)
  - write resolved line list to XCom for mapped tasks
- `extract_stage_line`
  - load each `fab_f_step_{lineid}` to temp/stage table with run id and line id
  - capture extracted count and source max timestamp
- `validate_line_load`
  - checks: null key rate, duplicate PK count, minimum row threshold
  - produce `is_delete_allowed` flag per line
  - apply delete guardrail defaults:
    - `delete_ratio <= 1%`
    - `delete_count <= 40,000`
  - persist `delete_block_reason` for operational triage
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
  - use `last_update_date` as event timestamp source column
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
  - if latest successful sync > SLA threshold (120 min), log warning and return controlled error response
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
  - hourly freshness < 120 minutes
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
- warning: freshness over 120 minutes
- warning: delete volume > configured percentage per line

## DAG Config & Status Contract (Sync Note)

Hourly DAG(`full_to_current_hourly`) Airflow Variable keys:
- `STEP_LINE_WHITELIST`: comma-separated line ids
- `STEP_FULL_SOURCE_MAX_LAST_UPDATE_DATE`: upstream readiness timestamp
- `STEP_FULL_READY_MAX_AGE_MINUTES`: max allowed age for upstream readiness
- `STEP_DELETE_RATIO_THRESHOLD`: delete ratio guardrail
- `STEP_DELETE_COUNT_THRESHOLD`: delete absolute count guardrail
- `STEP_MIN_STAGE_ROWS`: minimum stage row count guardrail for delete enablement
- `STEP_SERVICE_DB_URL`: service DB connection URL for run-log/line-status/watermark persistence
- `STEP_FULL_SOURCE_DB_URL`: full snapshot source DB connection URL
- `STEP_INCREMENTAL_SOURCE_DB_URL`: incremental source DB connection URL
- `STEP_INCREMENTAL_SOURCE_TABLE`: incremental source table name (default: `step_incremental_history`)
- `STEP_INCREMENTAL_BATCH_LIMIT`: incremental source fetch upper bound per run
- `STEP_INCREMENTAL_BACKFILL_MODE`: when `true`, run bounded backfill without watermark advancement
- `STEP_INCREMENTAL_BACKFILL_START`: backfill window start timestamp (inclusive)
- `STEP_INCREMENTAL_BACKFILL_END`: backfill window end timestamp (exclusive)

Line status values (scaffold contract):
- `validated`
- `validated_with_delete_block`
- `dq_failed`
