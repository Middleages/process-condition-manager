# Phase 4 History performance evidence

## Binding

The gate uses a guarded disposable PostgreSQL database migrated through `0007` and calls
`HistoryService(HistoryRepository(AsyncSession))` with production query DTOs/scopes.
Setup is excluded from timing. The fixture hard-asserts exactly 1 project, 100 layers,
100 surviving conditions, 200 parameters, 20,000 current coordinates (200 each), and
100,000 mixed writer-shaped events using the production SQLAlchemy enum encoding. It
includes manual/paste batches, condition/POR/profile events, v1/v2 backbone events, and
a deleted coordinate without a live condition row.

Every request is warmed once and measured five times. The report records p50/p95/max,
SQL count, and serialized bytes. Timeline/detail responses are capped at 256 KiB. Cell
history records SQL but gates latency and its coordinate plan, as required by the PRD.

## Reproduction

```bash
cd backend
APP_TEST_DATABASE_URL='<guard-admin-url>' \
  PYTHONPATH="$PWD" uv run pytest -q -c pyproject.toml \
  tests/performance/test_history_performance_pg.py::test_history_production_service_repository_gate -s

APP_TEST_DATABASE_URL='<guard-admin-url>' \
  PYTHONPATH="$PWD" uv run python scripts/benchmark_history.py \
  --compare-paste-overhead --warmup 1 --samples 5 --emit-json
```

The CLI exits non-zero for any latency/query/size/index/full-scan/write-amplification
failure and aggregates all REDs. It uses no planner GUC or index hint.

## First production-bound checkpoint — RED (2026-07-16)

The exact fixture test passed (`1 passed`, 47.03 s); Ruff and targeted Pyright passed.
The full gate then correctly failed and created Task 19 rather than weakening contracts:

- unfiltered timeline p95 **328.969 ms** (budget 250 ms);
- unfiltered and layer-filtered timeline **7 SQL** each (budget 4);
- unfiltered grouped plan used `Seq Scan:change_event`, not
  `ix_change_event_project_id_id_desc`;
- event-insert-only 200-row `0006`/head comparison was noisy/RED at **41.8462%**
  (pre 15.855/10.577/13.413/8.663/12.527 ms; head
  14.561/17.770/22.961/22.781/15.648 ms). This is not final evidence: the final
  comparison must use identical complete 200-cell writer-shaped transactions so index
  cost is reproducible rather than amplified by an event-only denominator.

Task 19 then optimized the production repository without changing the fixture,
thresholds, migration, or named-index assertions.

## Final production-bound checkpoint — GREEN (2026-07-17 KST)

The unchanged gate completed with `failures=[]` against PostgreSQL 16.14 and Python
3.13.12. The guarded pytest entry point passed both tests in 55.17 seconds. A Windows
host C-drive exhaustion incident stopped Docker Desktop during final verification, so
the same PostgreSQL 16.14 Ubuntu package was run directly on the Linux workspace for the
repeatable disposable-database gate. No project dependency or gate behavior changed.

| Request | Five samples (ms) | p50 (ms) | p95/max (ms) | SQL | Max bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| timeline, unfiltered | 82.671, 76.763, 76.297, 75.321, 178.125 | 76.763 | 178.125 | 4 | 23,651 |
| timeline, layer-filtered | 47.938, 47.921, 47.116, 48.505, 72.868 | 47.938 | 72.868 | 4 | 23,808 |
| batch detail, 100 rows | 14.278, 17.808, 13.280, 13.350, 13.637 | 13.637 | 17.808 | 3 | 52,682 |
| cell history, current | 20.970, 22.157, 22.197, 22.644, 21.147 | 22.157 | 22.644 | 6 recorded | 13,013 |
| cell history, deleted | 15.528, 14.695, 14.335, 13.123, 13.146 | 14.335 | 15.528 | 6 recorded | 12,876 |

The production 200-cell paste comparison also passed. The `0006` samples were
34.122, 35.496, 40.190, 50.345, and 55.670 ms (p50 40.190 ms); head samples were
37.455, 37.271, 36.445, 35.177, and 35.182 ms (p50 36.445 ms). The measured ratio was
**-9.3182%**, below the +20% ceiling. Both sides executed the complete
`CellService(CellRepository)` transaction and rolled back only after flush/index
maintenance, so the denominator includes the real 200-coordinate writer path.

Every plan used its required `0007` index and contained no `Seq Scan:change_event` or
`Parallel Seq Scan:change_event`:

| Plan | Required index observed |
| --- | --- |
| unfiltered timeline | `ix_change_event_project_id_id_desc` |
| layer filter | `ix_change_event_project_layer_id_desc` |
| event-type filter | `ix_change_event_project_type_id_desc` |
| actor filter | `ix_change_event_project_actor_id_desc` |
| origin filter | `ix_change_event_project_origin_id_desc` |
| source-project filter | `ix_change_event_project_source_id_desc` |
| period filter | `ix_change_event_project_created_id_desc` |
| batch detail | `ix_change_event_project_batch_id_desc` |
| cell history | `ix_change_event_project_cell_id_desc` |

The final fixture invariants remained exact: one project, 100 layers/conditions, 200
parameters, 20,000 current coordinates, exactly 100,000 events, one v1 capture, one v2
capture, and one deleted-coordinate scenario whose live condition row is absent.
