# Task Breakdown

## Scope Note
- [ ] S1. Keep scope limited to DAG code and service DB objects only.
- [ ] S2. Do **not** add Airflow services to this repository's docker-compose files.
- [ ] S3. Assume Airflow runtime/connections are managed externally.
- [ ] S4. Enforce full/incremental source DB read-only permissions.
- [ ] S5. Manage line whitelist through controlled config (not table auto-discovery).

## Epic A — Data Model & Migrations
- [x] A1. Create migration for `step_current`.
- [x] A2. Create migration for `step_event_audit`.
- [x] A3. Create migration for `sync_watermark`.
- [x] A4. Create migration for `etl_run_log` and `etl_run_line_status`.
- [x] A5. Add indexes for `step_current` query patterns.
- [x] A6. Add PK/unique constraints for `(line_id, process_id, step_seq)` consistency.
- [x] A7. Add ingestion metadata columns (`dag_run_id`, `ingested_at`) where needed.
- [ ] A8. Prepare rollback SQL for each migration.

## Epic B — Airflow DAG: Hourly Full Pipeline
- [ ] B1. Implement `build_line_list` from managed whitelist config.
- [ ] B2. Implement dynamic extraction task for `fab_f_step_{lineid}` tables.
- [ ] B3. Implement stage-load validation checks.
- [ ] B4. Implement per-line merge into `step_current`.
- [ ] B5. Implement per-line missing-row physical delete.
- [ ] B6. Add delete guardrail thresholds.
- [ ] B7. Implement `finalize_run` summary + alert emit.
- [ ] B8. Implement skip logic when upstream full load is not ready at run start.
- [ ] B9. Validate reappeared deleted keys are inserted as new registrations.
- [ ] B10. Persist line-level row counts and status to `etl_run_line_status`.
- [ ] B11. Ensure mapped-task rerun strategy is documented and tested.
- [ ] B12. Add idempotency test cases for merge/delete tasks.

## Epic C — Airflow DAG: Daily Incremental Audit
- [ ] C1. Implement watermark read.
- [ ] C2. Implement incremental extract and append to `step_event_audit`.
- [ ] C3. Implement DQ checks (null keys, duplicate keys, del_yn distribution).
- [ ] C4. Implement watermark update.
- [ ] C5. Emit run metrics.
- [ ] C6. Use composite watermark `(event_ts, sys_key_vals)` to avoid tie-loss.
- [ ] C7. Update watermark only when append + DQ checks succeed.
- [ ] C8. Add backfill execution mode with bounded date range.

## Epic D — Service Integration
- [x] D1. Add repository/query path to read from `step_current`.
- [x] D2. Wire project-create layer selection to new query path.
- [x] D3. Add feature flag for safe cutover.
- [ ] D4. Confirm no backbone flow regression.
- [ ] D5. Add freshness guard (SLA breach handling) in service read path.
- [ ] D6. Add integration test covering flag ON/OFF behavior.
- [x] D7. Add `selected_layer_refs(layer_id, step_seq)` input for duplicate `layer_id` disambiguation.
- [x] D8. Add fallback warning log when `USE_STEP_CURRENT` is enabled but no step data exists.

## Epic E — Operations & Reliability
- [ ] E1. Configure Airflow retries, pools, max active runs.
- [ ] E2. Add per-line recovery runbook.
- [ ] E3. Add alerting for failed lines and stale data SLA breaches.
- [ ] E4. Add reconciliation job/report.
- [ ] E5. Define operational dashboards (success ratio, freshness, delete rate).
- [ ] E6. Define incident severity matrix and on-call escalation path.
- [ ] E7. Document cutover checklist and rollback criteria.

## Milestone Plan (5 weeks)
- [ ] M1 (Week 1): Epic A complete + migration dry-run.
- [ ] M2 (Week 2): Epic B complete + hourly DAG staging verification.
- [ ] M3 (Week 3): Epic C complete + watermark replay test.
- [ ] M4 (Week 4): Epic D complete + feature-flag integration tests.
- [ ] M5 (Week 5): Epic E complete + production cutover/hypercare.

## Acceptance Checklist
- [ ] Hourly DAG runs at `40 * * * *` and completes with per-line status visibility.
- [ ] Partial line failures are recoverable without rerunning all lines.
- [ ] `step_current` serves project layer reads correctly.
- [ ] Incremental history is retained daily with watermark correctness.
- [ ] Physical delete policy verified against full snapshot behavior.
- [ ] Upstream-not-ready case is skipped (not failed) with explicit metric/event.
- [ ] Freshness SLA (<90 min) and alert threshold behavior are verified.
