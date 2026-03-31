# PRD: Step Master Data Integration (Full + Incremental)

## 1. Background
Current step master source landscape is split across two upstream databases:

- **Full snapshot tables**: loaded hourly in another DB server, partitioned by line table name pattern `fab_f_step_{lineid}`.
- **Incremental history table**: loaded daily in another DB on the same host instance as the service DB.

The service needs a reliable and performant **latest step dataset** for project creation layer selection, while preserving history for audit/troubleshooting.

## 2. Problem Statement
Directly querying multiple upstream databases at runtime increases coupling and failure surface.
Data semantics differ:

- Full = current state (all rows, `del_yn` always `NULL`)
- Incremental = change events (`del_yn='Y'` emitted as delete event rows)

A unified operational model is needed for:

1. Consistent latest-data reads by the service.
2. Robust partial failure recovery.
3. Operational observability.

## 3. Goals
1. Build and maintain a **service-local latest table** for step master data.
2. Keep incremental history available for audit and reconciliation.
3. Automate ingestion with Airflow, including partial success and per-line recovery.
4. Use deterministic keys: `line_id + process_id + step_seq`.
5. Apply **physical delete** policy in latest table when row disappears from full snapshot.

## 4. Non-Goals
- Replacing upstream loading jobs.
- Re-designing backbone sourcing (remains based on approved projects).
- Generic multi-tenant data platform abstraction.
- Provisioning/managing Airflow runtime infrastructure in this repository.
- Adding Airflow services to this service's `docker-compose`.

## 5. Data & Key Assumptions
- Full table naming: `fab_f_step_{lineid}`
- Full and incremental column schemas are identical.
- For this project case, `step_seq` can be treated as the step key.
- Primary business key for latest table: `(line_id, process_id, step_seq)`
- `sys_key_vals` is usable for cross-source tracing but not guaranteed globally unique.
- Full refresh cadence: hourly, longest load duration ~10 min.
- Incremental cadence: daily.
- Full source tables are managed by **whitelist** (no automatic discovery in production).

## 6. Functional Requirements
1. Latest table must be queryable by project creation flows for layer selection.
2. Hourly Airflow DAG starts at minute 40 (`40 * * * *`).
3. Ingestion must allow partial success by line and resumable recovery.
4. Latest table sync must be idempotent.
5. Missing keys in latest full snapshot for a line are physically deleted from latest table.
6. Incremental daily load is appended to audit/history table.
7. Runtime and quality metrics are captured per line and per DAG run.
8. If hourly run starts before full upstream load completion, the run should be **skipped** (not failed).
9. If a previously deleted key reappears in source full data, treat it as a **new registration**.
10. Deliverables are limited to DAG definitions and service DB artifacts/queries; Airflow environment setup is excluded.

## 7. Reliability Requirements
- Per-line retries without forcing full DAG rerun.
- Safe guardrail against accidental mass deletion due to empty/broken stage load.
- Watermark/checkpointing for incremental pipeline.

## 8. Success Metrics
- 99%+ hourly runs complete with no manual intervention.
- End-to-end freshness of latest table under 90 minutes.
- Recovery from single-line failure within one rerun cycle.
- Data quality checks detect key collisions/null-key anomalies.

## 9. Risks
- Upstream schema drift.
- Full load timing drift beyond expected 10 minutes.
- Misinterpreting delete semantics in incremental source.

## 10. Open Questions
1. Desired retention period for incremental audit table.
2. Alerting channel and escalation policy.
