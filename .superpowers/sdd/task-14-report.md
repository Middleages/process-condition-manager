# Task 14 Report — Exact-string Sheet cell editing and versioned managed choices

## Result

Implemented the Task 14 Sheet cell pipeline end to end. Sheet columns now carry only an exact managed-choice `{choice_set_code, choice_set_version}` binding, choices are loaded once per distinct set and shared by every cell, decimal values stay canonical strings through display/edit/paste/save, and successful saves reconcile the authoritative server response against the exact request revision snapshot. Malformed or conflicting Sheet bindings fail closed before the editing lock mounts. No dependency was added.

## Changed files

- `frontend/src/api/types.ts`, `api/sheets.test.ts`, and `api/cells.test.ts` — removed embedded Sheet choice options, added the exact nullable choice binding pair, and locked canonical decimal strings/stable choice codes at the transport boundary while preserving Task 13 Project Profile types.
- `frontend/src/grid/types.ts` — narrowed Sheet cell types to text/number/choice, added exact choice binding metadata, shared `SheetChoiceResource`, stable validation error codes, and shared resource transport on `ConditionGridData`.
- `frontend/src/grid/cellValue.ts` and `.test.ts` — one edit/paste validator, shared aggregate code index, canonical decimal normalization, unavailable-resource raw preservation, exact active/inactive aggregate parity with backend validation, and one normalized no-op persistence predicate.
- `frontend/src/grid/decimalCell.tsx` and `.test.tsx` — string-backed custom Glide decimal cell/editor with inline validation, Enter commit, Escape restore, and no number conversion.
- `frontend/src/grid/choiceCell.tsx` and `.test.ts` — label display with code copy/save, inactive/raw/error diagnostics, SearchableChoice editor, keyboard containment, post-unmount Glide focus restoration, and a commit-only monotonic/generation-fenced live resource bridge so an already-open overlay observes an awaited exact version refresh without abandoned-render or obsolete-open leakage.
- `frontend/src/grid/GlideConditionGrid.tsx` and `grid/index.ts` — registered the custom decimal/choice renderers, routed edit validation through the common validator, omitted normalized no-op edits, failed closed when a managed resource is absent, exposed choice hover diagnostics, and supplied one adapter-owned canvas focus callback to every choice payload.
- `frontend/src/features/sheets/sheetAdapter.ts` and `.test.ts` — strict pair validation, typed fail-closed adapter errors, conflict detection for one set at multiple Sheet versions, and exact code/version mapping.
- `frontend/src/features/choiceSets/choiceQueries.ts` and `.test.ts` — marks exact `(set, version, includeInactive)` aggregates immutable (`staleTime: Infinity`, no focus refetch), while a newer summary version creates the only new aggregate key.
- `frontend/src/features/sheets/useSheetChoiceSets.ts` and `.test.ts` — deterministic distinct-set query planning, Sheet-version bootstrap, monotonic summary advancement/publication, exactly two TanStack query arrays, inactive-inclusive aggregate loading, separate display/selectable authority, bounded version restart, cache cleanup, and layout-effect-only promotion of exact captured live snapshots.
- `frontend/src/features/sheets/pasteStaging.ts` and `.test.ts` — removed paste regex parsing, reused the common validator, added exact-knownness fields to the asynchronous choice-authorization epoch, revalidated immediately before allocation, and omitted true no-ops from mixed persisted batches.
- `frontend/src/features/sheets/editStore.ts` and `.test.ts` — global monotonic revision allocation across clears, atomic ordered paste revisions, exact returned request snapshots, and revision-equality saved removal.
- `frontend/src/features/sheets/persistenceReconciliation.ts` and `.test.ts` — canonical response conversion, stale in-flight Sheet GET cancellation, canonical-cache-before-dirty ordering, and ABA-safe snapshot clearing.
- `frontend/src/features/sheets/useSheetEditing.ts` and `.test.ts` — exact request snapshot persistence, async cache reconciliation fence, first-allocation paste preflight, identity-scoped failed-paste retry, exact-revision abandonment/replacement, dirty retention on failure, and panel-owned retained retry (no generic/reacquire auto-flush race).
- `frontend/src/features/sheets/SheetView.tsx` and `.test.tsx` — validates before `SheetEditor`, shares one resource map with grid/paste, fences asynchronous paste context with authorization state, owns one identity per paste review, explicitly abandons canceled failed snapshots, applies canonical server responses, and renders the fail-closed malformed-Sheet recovery state.
- `frontend/src/features/sheets/demoData.ts` and `frontend/src/grid/model.test.ts` — minimal fixture migration from embedded per-column options to exact bindings plus shared aggregates.
- `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-14.json` — tracked byte-identical Visual Ralph verdict evidence.

## Behavioral guarantees

- A choice column has both an exact nonblank/unpadded set code and positive integer version; a non-choice column has both fields null. Half pairs, bindings on non-choice columns, padded codes, and conflicting versions for the same set raise a typed adapter error before lock acquisition.
- The first aggregate request always uses the version supplied by the Sheet and `includeInactive=true`. A newer summary can advance the target only after the current target aggregate settles, and the target never downgrades.
- Display fallback is diagnostic only. A new selection is authorized only when the fresh active summary, current target, and aggregate all match exactly. Cold/stale Glide overlays receive the awaited exact result without close/reopen through one shared live handle per set.
- Every choice cell retains only a shared resource reference; no cell or column owns an option-array copy and no per-cell option request exists. Aggregate lookup uses one WeakMap-backed code index rather than repeated linear `find` calls.
- Canvas text is a label; copy/save data remains the stable code. Stored inactive values remain labeled and badged, raw unknown codes remain visible, and resource errors expose retry. When exact authority is unavailable an unchanged raw code is preserved locally but omitted as a true no-op from PATCH; once an exact active **or inactive** aggregate is available the same unknown code fails with `choice_unknown`, matching backend batch validation. Known inactive no-ops and clear-to-null remain valid.
- Every decimal remains `string | null` through API, grid, editor, paste, dirty store, request, response, and cache. The grid has no `GridCellKind.Number`, JavaScript `Number`/`parseFloat` conversion, or paste-only numeric regex.
- Edit and paste call the same validator. Asynchronous clipboard callbacks are invalidated when choice authorization changes, and paste staging is revalidated from the latest committed rows/resources inside the callback invoked immediately before the first `setCells` revision allocation.
- Dirty revisions are globally monotonic even across `clearAll`; paste allocation is atomic and ordered. A failed paste retains its exact allocated snapshot only for the same review identity, retry does not allocate a new generation or rerun authorization, and Cancel/replace removes only matching revisions so paste B can never resend paste A. Retained paste is never restarted by generic save retry or lock reacquisition; only panel Apply can start it, where Cancel is disabled in flight.
- Choice Enter/Escape finishes the Glide overlay synchronously, then restores the adapter canvas on the next animation frame after `SearchableChoice`'s input-refocus tail. Arrow/Home/End remain contained while the overlay is open; grid arrows resume after commit or cancel.
- Rendered live-resource candidates are inert closures until the exact render commits in a layout effect. Publication rejects target/known-summary downgrades, and every mandatory open claims a per-resource epoch before its first await, so neither delayed v7 nor obsolete same-v8 completion can overwrite newer authority or a newer fail-closed refresh.
- Versioned option aggregates are immutable in TanStack cache: elapsed stale time, focus, and reopening a cell reuse the exact key; only a newer summary version fetches a new aggregate key.
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

### Final-review follow-up (2026-07-15)

A later independent review found six additional Important boundary defects and no Critical defect. All six were reproduced RED-first in `task-14-final-review-red.log` (with the exact-choice/backend-parity slice separately captured in `task-14-choice-parity-red.log`) and closed without a dependency, API, markup, or styling change:

1. Exact healthy aggregates now reject unchanged unknown raw codes just as the backend does; unavailable-resource raw preservation and known inactive no-ops remain intact (`cellValue.test.ts`, `pasteStaging.test.ts`, `task-14-choice-parity-green.log`).
2. Paste reviews carry explicit symbol identities through `SheetView` and `useSheetEditing`; same-identity Apply retries the exact failed revisions, while Cancel or a different identity discards only matching revisions before B is prepared.
3. Choice Enter/Escape schedules the adapter-owned Glide focus callback after overlay input refocus; unit tests cover both exits and the deterministic browser run covers Arrow/Home/End plus post-close grid arrows.
4. Render no longer stages into the live WeakMap. It captures inert exact commit closures, installs new handles and publishes snapshots only in a layout effect, and forces the parent-derived authorization view to observe that committed snapshot before paint.
5. Live publication rejects target-version and known-summary-version downgrades; a deferred v7 open cannot overwrite an already-published healthy v8 snapshot.
6. Exact versioned aggregates use infinite staleness and no focus refetch. A functional QueryClient/observer test advances 31 seconds, toggles focus, reopens the same key with one request total, then proves v8 alone causes request two.

The adversarial re-review then exercised four narrower variants and drove four more RED-first closures:

- exact loaded inactive sets now use their display aggregate for **knownness** without making it selectable, so known inactive no-ops remain valid while inactive-set unknowns fail (`task-14-inactive-knownness-{red,green}.log`);
- each open attempt claims a live-resource preparation epoch before awaiting, so an older same-v8 success cannot undo a newer mandatory-refresh failure (`task-14-open-generation-{red,green}.log`);
- unavailable-resource RAW no-ops remain visible/valid but the shared no-op seam omits them from single writes and mixed paste PATCH payloads; and
- retained paste never auto-flushes on lock reacquisition (or generic save retry), eliminating the in-flight Cancel race (`task-14-noop-reacquire-{red,green}.log`).

The final-review focused suite and full counts below include all these variants. The initial combined GREEN slice passed 45/45 (`task-14-final-review-green-attempt-1.log`). A production-preview browser regression passed both focus and paste-identity scenarios (`task-14-final-review-browser.log`; machine-readable `.omx/artifacts/phase-2-6/task-14/followup-browser.json`).

Final independent read-only re-review found **no remaining Critical or Important issue** across the original six findings and all four adversarial variants. The reviewer independently passed the 17-file Task-brief grid/Sheet regression (**209 tests**), the seven changed suites (**100 tests**), typecheck, production build, and `git diff --check` on the current tree.

## Verification

- Final follow-up Task 14 focus: 13 files / **139 tests passed** (`task-14-final-review-focused.log`).
- Full frontend after all materially changed follow-up fixes: 67 files / **682 tests passed** (`task-14-final-review-frontend-full.log`).
- Final frontend lint and typecheck passed (`task-14-final-review-lint.log`, `task-14-final-review-typecheck.log`). The repository lint command delegates to typecheck.
- Final production build passed after all follow-up fixes (`task-14-final-review-build.log`). It retains only the repository's existing Glide PURE-annotation and large-chunk warnings.
- Browser verification passed at 1440×900: Arrow/Home/End moved choice active descendants; Enter and Escape each restored focus to the contained Glide canvas; subsequent ArrowRight/ArrowLeft retained canvas focus; failed paste A (`2.5`) was canceled and paste B (`3.5`) generated exactly the second and only succeeding PATCH (`task-14-final-review-browser.log`).
- Relevant backend Sheet/cell/performance tests: **39 passed** (`task-14-backend-focused.log`). Backend Ruff and Pyright passed (`task-14-backend-ruff.log`, `task-14-backend-pyright.log`).
- The final exact-choice parity check separately passed the three relevant backend contract tests (`task-14-choice-parity-backend.log`); no backend source changed in the follow-up.
- Large managed-set performance remained bounded: one distinct set shared by 66 columns, zero embedded options, 493,659 serialized bytes, 307.8 ms, and 8 SQL queries against the <=14 budget (`task-14-performance.log`).
- Static checks passed: no production `choice_options`, `choiceOptions`, `GridCellKind.Number`, `parseFloat`, or native choice `<select>` path; no dependency-manifest diff; clean `git diff --check`; and byte-identical visual JSON.

## Visual evidence

A deterministic production-preview browser run exercised ready, choice search, invalid decimal, canonical decimal save, and mixed paste review states at exact 1024×768, 1440×900, and 1920×1080 viewports. Fifteen screenshots, network evidence, measurements, the capture script, and a SHA-256 manifest are under `.omx/artifacts/phase-2-6/task-14/`; all 15 hashes revalidated.

The run proved body/grid containment without horizontal overflow, label/code choice behavior, one aggregate request shared by two columns, no PATCH for invalid decimal, one PATCH plus canonical `1.5` on success, and a 4-cell paste review with 2 valid/2 invalid cells. Visual Ralph returned **94 / pass** with no blocker. Its exact compact JSON is byte-identical at:

- `.omx/state/phase-2-6/task-14-visual.json`
- `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-14.json`

Both files hash to `cdbcb02027cd42899f0a2c0c0cfa0b695628d0c96be5a167e4070f5ccb6262fc`. The final-review follow-up changed validation, cache policy, paste identity, commit-phase publication, and focus callbacks only; it changed no markup, classes, dimensions, or styling. The existing 94/pass screenshots therefore remain visually representative. The separate browser evidence now verifies the interaction-only focus and paste-cancellation corrections that a still screenshot cannot demonstrate.

## Remaining risks and follow-ups

- **P2 visual follow-up:** the choice overlay keeps an approximately 320px minimum height even when search returns one item, leaving unused space and obscuring extra grid rows. The reviewer classified this as non-blocking; no post-verdict visual edit was made because any optional correction required a new verdict.
- **P3 usability follow-up:** an all-valid paste containing only normalized no-ops correctly sends no PATCH, but its review panel remains open until the user presses Cancel. Mixed batches omit no-ops and save real changes correctly.
- **P3 evidence follow-up:** add a dedicated screenshot of the resource-error explanation and retry action. Current evidence shows raw/missing codes and inactive labels, while retry is covered by code/tests rather than a separate visual state.
- The production bundle still emits the repository's pre-existing Glide Rollup annotation and >500 kB chunk warnings; Task 14 adds no dependency and introduces no build error.
