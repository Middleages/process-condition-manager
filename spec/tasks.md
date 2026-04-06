# Task Breakdown

## Scope Note
- [ ] S1. Keep scope limited to DAG code and service DB objects only.
- [ ] S2. Do **not** add Airflow services to this repository's docker-compose files.
- [ ] S3. Assume Airflow runtime/connections are managed externally.
- [ ] S4. Enforce full/incremental source DB read-only permissions.
- [ ] S5. Manage line whitelist through controlled config (not table auto-discovery).
- [x] S6. Persist ETL run metadata/watermark via service DB connection config (`STEP_SERVICE_DB_URL`).
- [x] S7. Stage table naming must be validated/sanitized before dynamic SQL usage.
- [x] S8. Dynamic source table naming must be validated/sanitized before SQL execution.

## Epic A — Data Model & Migrations
- [x] A1. Create migration for `step_current`.
- [x] A2. Create migration for `step_event_audit`.
- [x] A3. Create migration for `sync_watermark`.
- [x] A4. Create migration for `etl_run_log` and `etl_run_line_status`.
- [x] A5. Add indexes for `step_current` query patterns.
- [x] A6. Add PK/unique constraints for `(line_id, process_id, step_seq)` consistency.
- [x] A7. Add ingestion metadata columns (`dag_run_id`, `ingested_at`) where needed.
- [x] A8. Prepare rollback SQL for each migration.

## Epic B — Airflow DAG: Hourly Full Pipeline
- [x] B1. Implement `build_line_list` from managed whitelist config.
- [x] B2. Implement dynamic extraction task for `fab_f_step_{lineid}` tables.
- [x] B3. Implement stage-load validation checks (null/duplicate/min-stage-row threshold).
- [x] B4. Implement per-line merge into `step_current`.
- [x] B5. Implement per-line missing-row physical delete.
- [x] B6. Add delete guardrail thresholds (`delete_ratio <= 1%`, `delete_count <= 40,000`).
- [x] B7. Implement `finalize_run` summary + alert emit.
- [x] B8. Implement skip logic when upstream full load is not ready at run start.
- [x] B9. Validate reappeared deleted keys are inserted as new registrations.
- [x] B10. Persist line-level row counts/status + `delete_block_reason` to `etl_run_line_status`.
- [x] B11. Ensure mapped-task rerun strategy is documented and tested.
- [x] B12. Add idempotency test cases for merge/delete tasks.

## Epic C — Airflow DAG: Daily Incremental Audit
- [x] C1. Implement watermark read + source-side incremental predicate pushdown.
- [x] C2. Implement incremental extract and append to `step_event_audit`.
- [x] C3. Implement DQ checks (null keys, duplicate events, del_yn domain).
- [x] C4. Implement watermark update.
- [x] C5. Emit run metrics and persist incremental run summary to `etl_run_log`.
- [x] C6. Use composite watermark `(last_update_date, sys_key_vals)` to avoid tie-loss.
- [x] C7. Update watermark only when append + DQ checks succeed.
- [x] C8. Add backfill execution mode with bounded date range (and no watermark advance in backfill mode).

## Epic D — Service Integration
- [x] D1. Add repository/query path to read from `step_current`.
- [x] D2. Wire project-create layer selection to new query path.
- [x] D3. Add feature flag for safe cutover.
- [x] D4. Confirm no backbone flow regression.
- [x] D5. Add freshness guard (SLA breach handling, 120 min) in service read path.
- [x] D6. Add integration test covering flag ON/OFF behavior.
- [x] D7. Add `selected_layer_refs(layer_id, step_seq)` input for duplicate `layer_id` disambiguation.
- [x] D8. Add fallback warning log when `USE_STEP_CURRENT` is enabled but no step data exists.

## Epic E — Operations & Reliability
- [x] E1. Configure Airflow retries, pools, max active runs.
- [x] E2. Add per-line recovery runbook.
- [x] E3. Add alerting for failed lines and stale data SLA breaches.
- [x] E4. Add reconciliation job/report.
- [x] E5. Define operational dashboards (success ratio, freshness, delete rate).
- [x] E6. Define incident severity matrix and on-call escalation path.
- [x] E7. Document cutover checklist and rollback criteria.

## Milestone Plan (5 weeks)
- [x] M1 (Week 1): Epic A complete + migration dry-run.
- [x] M2 (Week 2): Epic B complete + hourly DAG staging verification.
- [x] M3 (Week 3): Epic C complete + watermark replay test.
- [x] M4 (Week 4): Epic D complete + feature-flag integration tests.
- [ ] M5 (Week 5): Epic E complete + production cutover/hypercare.

## Acceptance Checklist
- [x] Hourly DAG runs at `40 * * * *` and completes with per-line status visibility.
- [x] Partial line failures are recoverable without rerunning all lines.
- [x] `step_current` serves project layer reads correctly.
- [x] Incremental history is retained daily with watermark correctness.
- [x] Physical delete policy verified against full snapshot behavior.
- [x] Upstream-not-ready case is skipped (not failed) with explicit metric/event.
- [x] Freshness SLA (<120 min) and alert threshold behavior are verified.
