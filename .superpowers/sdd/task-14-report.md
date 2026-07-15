# Task 14 Report — Exact-string Sheet cell editing and versioned managed choices

## Result

Implemented the Task 14 Sheet cell pipeline end to end. Sheet columns now carry only an exact managed-choice `{choice_set_code, choice_set_version}` binding, choices are loaded once per distinct set and shared by every cell, decimal values stay canonical strings through display/edit/paste/save, and successful saves reconcile the authoritative server response against the exact request revision snapshot. Malformed or conflicting Sheet bindings fail closed before the editing lock mounts. No dependency was added.

## Changed files

- `frontend/src/api/types.ts`, `api/sheets.test.ts`, and `api/cells.test.ts` — removed embedded Sheet choice options, added the exact nullable choice binding pair, and locked canonical decimal strings/stable choice codes at the transport boundary while preserving Task 13 Project Profile types.
- `frontend/src/grid/types.ts` — narrowed Sheet cell types to text/number/choice, added exact choice binding metadata, shared `SheetChoiceResource`, stable validation error codes, and shared resource transport on `ConditionGridData`.
- `frontend/src/grid/cellValue.ts` and `.test.ts` — one edit/paste validator, shared aggregate code index, canonical decimal normalization, unchanged inactive/raw preservation, and fail-closed changed-choice authorization.
- `frontend/src/grid/decimalCell.tsx` and `.test.tsx` — string-backed custom Glide decimal cell/editor with inline validation, Enter commit, Escape restore, and no number conversion.
- `frontend/src/grid/choiceCell.tsx` and `.test.ts` — label display with code copy/save, inactive/raw/error diagnostics, SearchableChoice editor, keyboard event containment, retry, and a stable live resource bridge so an already-open Glide overlay observes an awaited exact version refresh.
- `frontend/src/grid/GlideConditionGrid.tsx` and `grid/index.ts` — registered the custom decimal/choice renderers, routed edit validation through the common validator, failed closed when a managed resource is absent, and exposed choice hover diagnostics.
- `frontend/src/features/sheets/sheetAdapter.ts` and `.test.ts` — strict pair validation, typed fail-closed adapter errors, conflict detection for one set at multiple Sheet versions, and exact code/version mapping.
- `frontend/src/features/sheets/useSheetChoiceSets.ts` and `.test.ts` — deterministic distinct-set query planning, Sheet-version bootstrap, monotonic summary advancement, exactly two TanStack query arrays, inactive-inclusive aggregate loading, separate display/selectable authority, bounded version restart, cache cleanup, and live publication of awaited cold-open/version-advance results.
- `frontend/src/features/sheets/pasteStaging.ts` and `.test.ts` — removed paste regex parsing, reused the common validator, added a choice-authorization epoch for asynchronous clipboard callbacks, and revalidated current resources immediately before the first revision allocation.
- `frontend/src/features/sheets/editStore.ts` and `.test.ts` — global monotonic revision allocation across clears, atomic ordered paste revisions, exact returned request snapshots, and revision-equality saved removal.
- `frontend/src/features/sheets/persistenceReconciliation.ts` and `.test.ts` — canonical response conversion, stale in-flight Sheet GET cancellation, canonical-cache-before-dirty ordering, and ABA-safe snapshot clearing.
- `frontend/src/features/sheets/useSheetEditing.ts` and `.test.ts` — exact request snapshot persistence, async cache reconciliation fence, first-allocation paste preflight, failed-paste exact-snapshot retry, and dirty retention on failure.
- `frontend/src/features/sheets/SheetView.tsx` and `.test.tsx` — validates before `SheetEditor`, shares one resource map with grid/paste, fences asynchronous paste context with authorization state, applies canonical server responses, and renders the fail-closed malformed-Sheet recovery state.
- `frontend/src/features/sheets/demoData.ts` and `frontend/src/grid/model.test.ts` — minimal fixture migration from embedded per-column options to exact bindings plus shared aggregates.
- `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-14.json` — tracked byte-identical Visual Ralph verdict evidence.

## Behavioral guarantees

- A choice column has both an exact nonblank/unpadded set code and positive integer version; a non-choice column has both fields null. Half pairs, bindings on non-choice columns, padded codes, and conflicting versions for the same set raise a typed adapter error before lock acquisition.
- The first aggregate request always uses the version supplied by the Sheet and `includeInactive=true`. A newer summary can advance the target only after the current target aggregate settles, and the target never downgrades.
- Display fallback is diagnostic only. A new selection is authorized only when the fresh active summary, current target, and aggregate all match exactly. Cold/stale Glide overlays receive the awaited exact result without close/reopen through one shared live handle per set.
- Every choice cell retains only a shared resource reference; no cell or column owns an option-array copy and no per-cell option request exists. Aggregate lookup uses one WeakMap-backed code index rather than repeated linear `find` calls.
- Canvas text is a label; copy/save data remains the stable code. Stored inactive values remain labeled and badged, raw unknown codes remain visible, and resource errors expose retry. New inactive/unknown choices fail closed; unchanged inactive/raw codes and clear-to-null remain valid.
- Every decimal remains `string | null` through API, grid, editor, paste, dirty store, request, response, and cache. The grid has no `GridCellKind.Number`, JavaScript `Number`/`parseFloat` conversion, or paste-only numeric regex.
- Edit and paste call the same validator. Asynchronous clipboard callbacks are invalidated when choice authorization changes, and paste staging is revalidated from the latest committed rows/resources inside the callback invoked immediately before the first `setCells` revision allocation.
- Dirty revisions are globally monotonic even across `clearAll`; paste allocation is atomic and ordered. A failed paste retains its exact allocated snapshot and retry does not allocate a new generation or rerun the authorization callback.
- The server response is the only cache authority. Persistence first awaits cancellation of the exact in-flight Sheet query, writes canonical response strings, then clears only request revisions that still match. A newer ABA edit remains as a dirty overlay over the canonical base.

## Simplifications made

- Reused `normalizeDecimalInput`, existing Task 8 query keys/options/version restart helpers, `SearchableChoice`, the existing edit store, and existing Sheet cache key rather than adding a second parser, resource provider, cache, or component system.
- Replaced embedded/per-cell option lists with one deterministic distinct-set plan and one shared resource handle per set.
- Kept decimal editing as one custom string cell instead of adapting Glide's binary-number cell and repairing precision after the fact.
- Kept persistence reconciliation in one small seam: cancel old GET, commit canonical response, then clear the matching revision snapshot.
- Added no dependency, provider refresh path, server schema change, or broad fixture rewrite.

## TDD and independent review evidence

- Baseline focused suite: 56 passed (`task-14-baseline-focused.log`).
- RED/GREEN logs cover the API/adapter contract, choice target bootstrap/monotonicity, common validator, decimal and choice custom cells, grid integration, paste staging, revision allocator, persistence reconciliation, and Sheet integration (`task-14-step*-{red,green}*`, `task-14-resource-hook-*`, `task-14-grid-integration-*`, `task-14-persistence-integration-*`, and `task-14-sheet-integration-*`).
- Locale-independent resource ordering and padded-code rejection were separately locked by RED/GREEN regressions (`task-14-resource-sort-{red,green}.log`, `task-14-adapter-code-red.log`, and `task-14-post-review-green.log`).
- Independent read-only review found three Important concurrency/authority defects and no Critical defect:
  1. an open Glide overlay retained its immutable cold resource after awaited query refresh;
  2. paste trusted staging after choice authorization drift and before asynchronous revision allocation;
  3. an older in-flight Sheet GET could overwrite a canonical PATCH cache write after dirty removal.
- All three were closed with RED-first regressions: stable live external-store resource publication (`task-14-live-choice-resource-{red,green-attempt-1}.log`), exact pre-allocation paste revalidation (`task-14-review-paste-cache-{red,green-attempt-1}.log`), and awaited stale-query cancellation/canonical reconciliation (`task-14-review-cache-await-red.log`). The focused live-resource regression passed 48/48.
- Independent read-only re-review found no remaining Critical or Important issue and separately passed the six corrected surfaces, **60 tests**.

## Verification

- Final post-review Task 14 focus: 12 files / **115 tests passed** (`task-14-final-after-review-focused.log`).
- Broader grid/Sheet regression before the review corrections: 17 files / **187 tests passed** (`task-14-final-regression.log`).
- Full frontend before the narrowly scoped review corrections: 67 files / **659 tests passed** (`task-14-final-full-frontend.log`). Per leader direction it was not repeated; the changed review surfaces are all present in the 115-test post-review focus, and final typecheck/build were repeated.
- Final frontend typecheck passed (`task-14-review-all-typecheck.log`); lint is the repository typecheck command and passed earlier (`task-14-final-lint.log`).
- Final production build passed after all review fixes (`task-14-final-after-review-build.log`). It retains only the repository's existing Glide PURE-annotation and large-chunk warnings.
- Relevant backend Sheet/cell/performance tests: **39 passed** (`task-14-backend-focused.log`). Backend Ruff and Pyright passed (`task-14-backend-ruff.log`, `task-14-backend-pyright.log`).
- Large managed-set performance remained bounded: one distinct set shared by 66 columns, zero embedded options, 493,659 serialized bytes, 307.8 ms, and 8 SQL queries against the <=14 budget (`task-14-performance.log`).
- Static checks passed: no production `choice_options`, `choiceOptions`, `GridCellKind.Number`, `parseFloat`, or native choice `<select>` path; no dependency-manifest diff; clean `git diff --check`; and byte-identical visual JSON.

## Visual evidence

A deterministic production-preview browser run exercised ready, choice search, invalid decimal, canonical decimal save, and mixed paste review states at exact 1024×768, 1440×900, and 1920×1080 viewports. Fifteen screenshots, network evidence, measurements, the capture script, and a SHA-256 manifest are under `.omx/artifacts/phase-2-6/task-14/`; all 15 hashes revalidated.

The run proved body/grid containment without horizontal overflow, label/code choice behavior, one aggregate request shared by two columns, no PATCH for invalid decimal, one PATCH plus canonical `1.5` on success, and a 4-cell paste review with 2 valid/2 invalid cells. Visual Ralph returned **94 / pass** with no blocker. Its exact compact JSON is byte-identical at:

- `.omx/state/phase-2-6/task-14-visual.json`
- `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-14.json`

Both files hash to `cdbcb02027cd42899f0a2c0c0cfa0b695628d0c96be5a167e4070f5ccb6262fc`. Post-verdict review fixes changed only resource publication, paste/cache authority, and tests; they made no markup/style correction, so the captured visual states remain representative.

## Remaining risks and follow-ups

- **P2 visual follow-up:** the choice overlay keeps an approximately 320px minimum height even when search returns one item, leaving unused space and obscuring extra grid rows. The reviewer classified this as non-blocking; no post-verdict visual edit was made because any optional correction required a new verdict.
- **P3 evidence follow-up:** add dedicated browser captures for Arrow/Home/End navigation, Enter selection, Escape closure, and canvas focus restoration. Unit/component contracts cover these behaviors, but the current screenshots do not directly depict them.
- **P3 evidence follow-up:** add a dedicated screenshot of the resource-error explanation and retry action. Current evidence shows raw/missing codes and inactive labels, while retry is covered by code/tests rather than a separate visual state.
- The full 659-test frontend suite ran before the three targeted review fixes rather than afterward by explicit leader direction. Final focused tests, typecheck, build, backend checks, performance proof, and independent re-review are the completion gates for the final diff.
- The production bundle still emits the repository's pre-existing Glide Rollup annotation and >500 kB chunk warnings; Task 14 adds no dependency and introduces no build error.
