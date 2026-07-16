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
APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@127.0.0.1:15432/pcm \
  PYTHONPATH="$PWD" uv run pytest -q -c pyproject.toml \
  tests/performance/test_history_performance_pg.py::test_history_production_service_repository_gate -s

APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@127.0.0.1:15432/pcm \
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

Task 19 owns production timeline optimization. Task 5 stays open until this locked
harness passes without fixture, threshold, named-index, or planner weakening; final exact
samples and plans will replace this checkpoint.
