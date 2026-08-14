# Task 1 report: invalid condition-cell drafts

## Status

Complete.

## Files

- `frontend/src/grid/types.ts`: added `InvalidCellDraft` and `InvalidCellDraftMap`.
- `frontend/src/features/sheets/editStore.ts`: added the separate invalid-draft map, coordinate-keyed actions, pruning, row projection, selectors, and session clearing.
- `frontend/src/features/sheets/editStore.test.ts`: added reducer/projection/pruning/clear tests.

## TDD verification

RED:

```text
$ cd frontend && npm test -- --run src/features/sheets/editStore.test.ts
❯ src/features/sheets/editStore.test.ts (13 tests | 3 failed)
× overlays a raw invalid draft without adding a dirty cell
× prunes drafts whose condition or parameter disappeared
× clears one invalid coordinate and clears invalid drafts with the session
```

The failures were the expected missing `setInvalidDraft` and `pruneInvalidDraftMap` implementations.

GREEN:

```text
$ cd frontend && npm test -- --run src/features/sheets/editStore.test.ts
✓ src/features/sheets/editStore.test.ts (13 tests)
Test Files  1 passed (1)
Tests  13 passed (13)

$ cd frontend && npm run typecheck
> pcm-frontend@0.1.0 typecheck
> tsc -b --pretty false
exit=0

$ git diff --check
exit=0
```

## Self-review

- Invalid drafts use `dirtyKey` identity but never enter `dirtyCells`, receive revisions, or go through API transport conversion.
- Projection clones row values and leaves server rows unchanged.
- `clearAll` clears both maps while leaving all monotonic counters untouched.
- `setCell`/`setCells` do not manufacture invalid drafts.
- Pruning keeps only drafts whose condition and parameter still exist.

## Commit

`15940f2` (`feat: retain invalid condition cell drafts`)

## Concerns

None for Task 1. UI composition and valid-edit callback behavior are intentionally deferred to later tasks.
