# Task Breakdown

## Scope Note
- [ ] S1. Keep scope limited to DAG code and service DB objects only.
- [ ] S2. Do **not** add Airflow services to this repository's docker-compose files.
- [ ] S3. Assume Airflow runtime/connections are managed externally.

## Epic A — Data Model & Migrations
- [ ] A1. Create migration for `step_current`.
- [ ] A2. Create migration for `step_event_audit`.
- [ ] A3. Create migration for `sync_watermark`.
- [ ] A4. Create migration for `etl_run_log` and `etl_run_line_status`.
- [ ] A5. Add indexes for `step_current` query patterns.

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

## Epic C — Airflow DAG: Daily Incremental Audit
- [ ] C1. Implement watermark read.
- [ ] C2. Implement incremental extract and append to `step_event_audit`.
- [ ] C3. Implement DQ checks (null keys, duplicate keys, del_yn distribution).
- [ ] C4. Implement watermark update.
- [ ] C5. Emit run metrics.

## Epic D — Service Integration
- [ ] D1. Add repository/query path to read from `step_current`.
- [ ] D2. Wire project-create layer selection to new query path.
- [ ] D3. Add feature flag for safe cutover.
- [ ] D4. Confirm no backbone flow regression.

## Epic E — Operations & Reliability
- [ ] E1. Configure Airflow retries, pools, max active runs.
- [ ] E2. Add per-line recovery runbook.
- [ ] E3. Add alerting for failed lines and stale data SLA breaches.
- [ ] E4. Add reconciliation job/report.

## Acceptance Checklist
- [ ] Hourly DAG runs at `40 * * * *` and completes with per-line status visibility.
- [ ] Partial line failures are recoverable without rerunning all lines.
- [ ] `step_current` serves project layer reads correctly.
- [ ] Incremental history is retained daily with watermark correctness.
- [ ] Physical delete policy verified against full snapshot behavior.
