# Task 10 Report — ChoiceSet administration routes and conflict-safe workflows

## Result

Implemented the ChoiceSet administration list and full-page option workspace under the normal application shell. Metadata, option, reorder, and CSV import workflows bind every write to an owned base version, preserve user work on the typed `choice_set_changed` conflict, and require explicit reload before retry. No dependency was added.

## Changed files

- `frontend/src/app/routes.tsx` — normal-shell ChoiceSet list/detail leaves.
- `frontend/src/app/routes.test.tsx` — route ownership and shell regression coverage.
- `frontend/src/features/choiceSets/ParameterSectionNav.tsx` and `.test.tsx` — horizontal parameter subsection navigation with exact `/parameters` matching.
- `frontend/src/features/choiceSets/choiceSetUrlState.ts` and `.test.ts` — URL-owned search/lifecycle state with list/detail defaults and default omission.
- `frontend/src/features/choiceSets/choiceSetAdminState.ts` and `.test.ts` — shared URL-safe code rules, exact aggregate gate, complete-order helpers, preview fingerprint, bounded exact snapshot reload, mutation completion, and stale-error reset seams.
- `frontend/src/features/choiceSets/ChoiceSetListPage.tsx` and `.test.tsx` — active/inactive local filtering, compact usage table, sticky action column, and metadata Drawer entry points.
- `frontend/src/features/choiceSets/ChoiceSetEditorDrawer.tsx` and `.test.tsx` — create/edit metadata drafts, immutable edit code, validation, and explicit 409 recovery.
- `frontend/src/features/choiceSets/ChoiceOptionEditorDialog.tsx` and `.test.tsx` — exact-snapshot create/edit/deactivate, case-only advisory, blast-radius acknowledgement, and explicit conflict reload.
- `frontend/src/features/choiceSets/ChoiceSetDetailPage.tsx` and `.test.tsx` — complete inactive-inclusive workspace, 100-row windowing, local filters, full-code reorder, and editor/import orchestration.
- `frontend/src/features/choiceSets/ChoiceImportDialog.tsx` and `.test.tsx` — generation-guarded preview, exact `{csvText, baseVersion, response}` apply snapshot, invalid-row guidance, and conflict-preserved CSV evidence.
- `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-10.json` — byte-identical final visual verdict evidence (added after the leader gate).

## Behavioral guarantees

- List defaults to active sets and detail defaults to all options; serializers omit those defaults and never duplicate `setCode` in query state.
- Set codes accept at most 64 characters and option codes at most 128 characters under the shared ASCII URL-safe grammar. Case remains exact identity; a case-only collision is advisory and does not disable a valid save.
- Option writes, reorder, preview, and apply are authorized only from a summary plus complete `includeInactive=true` aggregate with matching set, version, and option count.
- Reorder is locked while filtered, pending, mismatched, or conflicted and sends every active and inactive code exactly once.
- Reorder mutation success reconciles the returned version before cache invalidation, clears transient conflict state, and protects any dirty/conflicted full-order draft with the shared unsaved-navigation guard.
- A typed stale 409 preserves draft fields, touched/validation state, acknowledgement, CSV/preview, or order as applicable. Only explicit reload advances the owned base version; stale mutation errors are reset before the new attempt.
- CSV preview responses are generation checked. Apply uses the exact preview CSV/base version, requires zero errors, awaits query invalidation, and only then closes.
- Pending modal work locks every close path; dialogs retain accessible labels, focus containment, captured-opener return with a stable fallback, text-plus-color lifecycle states, and labelled reorder controls.
- List/detail route headers stay mounted through cold async loading so pathname focus is never lost when data arrives.

## Simplifications made

- Reused Task 8 query keys, aggregate loader, typed conflict guard, and invalidation helper rather than adding a parallel cache layer.
- Kept list/detail filtering local over the one complete query result; no duplicate server pagination or filter cache was introduced.
- Centralized exact-snapshot, code grammar, ordering, preview, completion, and error-reset rules in small pure helpers instead of duplicating mutation conditions across components.
- Reused existing `PageHeader`, `Badge`, `Button`, `InlineAlert`, `Drawer`, `Dialog`, and unsaved-change primitives; no new component system or dependency was introduced.
- Used a compact full-page table with an internal horizontal scroller/sticky action rather than responsive column-copy variants.

## TDD and verification evidence

- Initial missing-module/route RED: `.superpowers/sdd/task-10-red.log`.
- Transport max guard RED proof: `.superpowers/sdd/task-10-code-length-red.log`.
- Import error-guidance RED/GREEN: `.superpowers/sdd/task-10-import-error-guidance-red.log` and `task-10-import-error-guidance-green.log`.
- Independent code review regressions: modal opener focus, cold-route page-title focus, reorder-success reconciliation, and dirty-order navigation protection (`.superpowers/sdd/task-10-review-regressions-red.log`); reviewer follow-up found no remaining Critical/Medium defect.
- Focused final: 12 files / 120 tests passed (`.superpowers/sdd/task-10-focused-final.log`).
- Full frontend: 57 files / 505 tests passed (`.superpowers/sdd/task-10-full-final.log`).
- Typecheck passed (`.superpowers/sdd/task-10-typecheck.log`).
- Lint passed (`.superpowers/sdd/task-10-lint.log`).
- Production build passed (`.superpowers/sdd/task-10-build.log`).
- Browser measurements: `.omx/artifacts/phase-2-6/task-10/iteration-2-measurements.json` confirms exact 1024×965 / 1440×1000 viewports, active normal-shell navigation, no horizontal body overflow, and contained dialog/drawer bounds.
- Screenshot hashes: `.omx/artifacts/phase-2-6/task-10/iteration-2-ready.sha256`.

## Visual evidence

Iteration 2 uses the real `/parameters/choice-sets` and `/parameters/choice-sets/equipment_mode` routes, not a development harness:

- `list-{1024,1440}-iteration-2-ready.png`
- `detail-{1024,1440}-iteration-2-ready.png`
- `drawer-1024-iteration-2-ready.png` — typed draft retained after 409 with explicit reload.
- `drawer-1440-iteration-2-ready.png` — typed draft retained after a request failure.
- `import-1024-iteration-2-ready.png` — CSV and successful preview retained after apply conflict.
- `import-1440-iteration-2-ready.png` — invalid row, error count, guidance, and disabled Apply.

All files are under `.omx/artifacts/phase-2-6/task-10/`. The final visual verdict is **96 / pass**; it is persisted in `.omx/state/phase-2-6/task-10-visual.json` and copied byte-for-byte to the tracked evidence path. Visual history records the iteration-1 `76 / fail` followed by the corrected `96 / pass`.

## Remaining risks

- The option table deliberately renders at most 100 additional rows per user action; it is not virtualized. This bounds initial DOM work but very large registries can still grow after repeated `더 보기` actions.
- The 1024 list retains all data columns in an internal horizontal scroller. The action column is sticky and body overflow is absent, but hidden secondary columns still require horizontal scrolling.
- Build output retains the repository's pre-existing Rollup PURE-annotation and bundle-size warnings from Glide Data Grid; Task 10 adds no dependency or new build error.
- Browser evidence uses deterministic intercepted API fixtures to expose conflict/error states; live backend integration remains covered at the API contract layer rather than by an end-to-end server process in this task.

## Follow-up root review — 2026-07-15

### Result

Closed all three root-review findings with a strict RED/GREEN follow-up and no dependency change:

- An open option editor or CSV import now owns the exact snapshot captured when it opens. A focus refetch may temporarily make the live summary/aggregate pair inexact, but it no longer unmounts the owner or loses a draft, raw CSV, preview, or base version.
- Each owner compares its current internal snapshot with the latest live exact summary/aggregate pair. Save, preview, and apply are disabled in the view and rejected again at the mutation seam whenever that pair is absent, checksum-invalid, or differently owned. Explicit child reload is the only path that advances the internal base, and writes remain locked until the parent cache converges on the same exact pair.
- The complete detail workspace is keyed by route `setCode`, so a confirmed A→B navigation synchronously discards A order, debounce, row-window, mutation closures, and every overlay before B renders. Option/import owners are additionally route-guarded, while metadata drawers use one code-owned session key on both list and detail routes.
- Exact admin snapshots now checksum both total option count and active option count.

### Changed files

- `frontend/src/features/choiceSets/ChoiceSetDetailPage.tsx` and `.test.tsx` — route-keyed workspace plus pinned, route-guarded option/import owners.
- `frontend/src/features/choiceSets/ChoiceOptionEditorDialog.tsx` and `.test.tsx` — observed-summary ownership lock at both UI and submit seams without discarding the owned draft.
- `frontend/src/features/choiceSets/ChoiceImportDialog.tsx` and `.test.tsx` — observed-summary lock for preview/apply while retaining CSV and preview evidence.
- `frontend/src/features/choiceSets/ChoiceSetEditorDrawer.tsx` and `.test.tsx`, and `ChoiceSetListPage.tsx` — shared metadata session key by mode and set code.
- `frontend/src/features/choiceSets/choiceSetAdminState.ts` and `.test.ts` — active lifecycle checksum and shared owner-current/conflict helpers.

### Simplifications and evidence

- Reused the children’s existing internal snapshot/reload flow instead of adding a second cache or draft store.
- Used one keyed route boundary rather than asynchronous reset effects, eliminating the possible A-on-B render instead of repairing state after it leaks.
- Kept the existing warning, reload, and disabled-control presentation; standard and previously captured conflict markup/styles are unchanged, so the 96/pass visual evidence remains representative. The follow-up adds ownership behavior, not a new layout or visual treatment.
- RED: `.superpowers/sdd/task-10-followup-red.log` records eight initial ownership/checksum failures, two mutation-seam failures, and the independent review regression for a null/checksum-invalid live pair.
- Focused GREEN: 5 files / 66 tests passed (`.superpowers/sdd/task-10-followup-green.log`).
- Full frontend: 57 files / 513 tests passed (`.superpowers/sdd/task-10-followup-full-test.log`).
- Typecheck, lint, and production build passed (`.superpowers/sdd/task-10-followup-static-build.log`). Build retains only the pre-existing Glide Data Grid PURE-annotation and bundle-size warnings.
- Independent re-review found no remaining Critical or Important issue after the live exact-pair authorization regression was fixed.

### Remaining risk

- The ownership races are locked with pure state, rendering, route-key, and mutation-seam regressions. A live-browser focus-refetch race is not separately captured because the persistent UI treatment is the already-verified conflict/reload surface.
