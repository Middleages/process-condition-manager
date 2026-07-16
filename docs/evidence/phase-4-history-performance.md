# Phase 4 History performance evidence

## Binding

The gate is being replaced with a guarded disposable-PostgreSQL harness bound to the
production `HistoryRepository` and `HistoryService`. The deterministic fixture now hard
asserts one measured project, 100 layers, 100 surviving conditions, 200 registered
parameters, 20,000 current coordinates, and exactly 100,000 writer-shaped events.

## Current checkpoint

The exact production-shaped fixture builder and invariant gate are on disk. Timing,
production service measurement, EXPLAIN JSON, and the isolated 0006/head write comparison
are the next checkpoint.
