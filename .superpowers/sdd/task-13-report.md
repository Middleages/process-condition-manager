# Task 13 Report — Full Project Profile detail and fenced Drawer editing

## Result

Implemented the complete fixed Project Profile detail and an atomic, project-lock-fenced edit Drawer. The editor acquires a lock before fetching and hydrating a draft, keeps every editable value as a string, emits only the exact changed Profile fields, survives ordinary validation/network failures without losing the draft, and preserves an explicit recovery copy after lock loss. No dependency was added.

## Changed files

- `frontend/src/api/types.ts` — exact 28-key `ProjectProfilePatchIn` plus the canonical runtime field allow-list; identity, resolved choice objects, timestamps, and provenance remain outside the mutation boundary.
- `frontend/src/api/projects.ts` and `.test.ts` — authoritative Profile GET and fenced PATCH with the exact `X-Lock-Token` header.
- `frontend/src/features/projects/profileForm.ts` and `.test.ts` — string-only hydration, whole-form validation, shared decimal canonicalization, active-choice authorization, and omitted-versus-null exact diffing.
- `frontend/src/features/projects/profileLockState.ts` and `.test.ts` — pure injected lock-session controller covering acquire/refetch/heartbeat/PATCH/invalidate/release, operation generations, token ownership, late continuations, release-once behavior, unload fencing, recovery, and heartbeat-versus-release races.
- `frontend/src/features/projects/useProjectProfileLock.ts` — React/API/Query wiring, StrictMode-safe deferred open, exact cache updates/invalidations, and one-shot `pagehide` plus `beforeunload` beacon release.
- `frontend/src/features/projects/ProjectProfileDrawer.tsx` and `.test.tsx` — grouped responsive string controls, four inactive-inclusive managed-choice resources, custom validation, shared dirty guard, conflict/load-error/lock-loss recovery, pending close fence, and explicit non-merged recovery copy.
- `frontend/src/features/projects/ProjectDetailPage.tsx` and `.test.tsx` — six read-only definition groups containing all 31 fixed values before the existing compact Layer table, resolved choice diagnostics, inactive badges, and edit trigger/focus ownership.
- `frontend/src/shared/components/ModalSurface.tsx` and `.test.tsx` — optional backward-compatible `closeDisabled` enforcement for close button, Escape, and backdrop.
- `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-13.json` — tracked byte-identical Visual Ralph verdict evidence.

## Behavioral guarantees

- The PATCH boundary contains exactly 28 unique snake-case keys. Identity, output-only choice objects, timestamps, and `device_ref` cannot enter a form diff or request payload.
- Profile drafts are hydrated only after the same generation still owns the freshly acquired token and the fresh Profile GET resolves. Cached Project data never seeds an editable draft.
- Required values reject blanks; optional changed blanks emit `null`; unchanged values are omitted. Every decimal is normalized through the shared canonicalizer before comparison and invalid input prevents the complete request.
- Current inactive choices may remain unchanged. Only changed choices require a ready active option; resource failures retain the raw code and disable mutation until retry.
- Heartbeat starts as soon as acquisition succeeds, including while GET is pending. Closing a slow acquisition/GET releases once, and late acquire/GET/PATCH continuations cannot open, rehydrate, invalidate, close, or release a newer session.
- Ordinary PATCH failures preserve the token and exact draft. Fencing loss freezes the draft read-only and retains a recovery copy. Reacquisition releases the old token best-effort once, creates a new generation/token, fetches fresh server state, and never merges the recovery copy.
- A completed PATCH response rehydrates local state, updates Profile/Project caches, invalidates Profile/Project/list queries, then stops heartbeat, releases, closes, and restores focus. An older heartbeat rejection is powerless after intentional release begins.
- Save/release phases disable the shared close button and ignore Escape/backdrop/cancel. Dirty Drawer close and route navigation use the same confirmation copy.
- Detail remains readable during every lock conflict and renders six explicit groups with 31 fixed values before the Layer section; identity has no editable control.

## Simplifications made

- Reused `normalizeDecimalInput`, `useChoiceSetOptions`, `SearchableChoice`, `Field`, `Drawer`, and `useUnsavedChanges` rather than adding parallel utilities or component systems.
- Used one canonical explicit Profile field tuple for both the transport contract and form diff, eliminating reflection over output objects and preventing field leakage.
- Kept lock concurrency in a small pure dependency-injected controller, leaving React Query and browser event wiring thin and separately testable.
- Reused the existing project cache keys and lock APIs; no new cache, URL edit state, provider refresh, overlay, icon package, or dependency was introduced.
- Kept the generic Drawer width contract unchanged and extended `ModalSurface` with one optional default-false fence.

## TDD and review evidence

- Baseline: 19 existing focused tests passed (`.superpowers/sdd/task-13-baseline-focused.log`).
- Initial RED evidence: contract/form/lock, modal, detail, and Drawer failures (`task-13-red-contract-form-lock.log`, `task-13-red-modal.log`, `task-13-red-detail.log`, `task-13-red-drawer.log`).
- Browser-discovered RED/GREEN regressions: explicit recovery copy after reacquire, custom validation under native form behavior, and operable invalid Save (`task-13-recovery-copy-{red,green}.log`, `task-13-browser-validation-{red,green}.log`, `task-13-validation-submit-{red,green}.log`).
- Independent code review found one Important race where a previously started heartbeat rejection could override an authoritative save during release. The deferred regression failed first and then passed after the phase fence (`task-13-heartbeat-release-race-{red,green}.log`). Re-review found no remaining Critical or Important issue.
- Focused final: 8 files / 65 tests passed (`.superpowers/sdd/task-13-final-focused.log`).
- Full frontend: 62 files / 600 tests passed (`.superpowers/sdd/task-13-final-full-frontend.log`).
- Frontend typecheck and lint passed (`task-13-final-typecheck.log`, `task-13-final-lint.log`).
- Production build passed (`task-13-final-build.log`).
- Relevant backend Profile/lock API regressions: 58 passed (`task-13-final-backend-focused.log`).
- Static contract checks passed: clean `git diff --check`, exact 28 unique snake-case keys, no production `device_ref`/`deviceRef`, no form `Object.entries`/`Number`/number input, no dependency-manifest change, and byte-identical visual JSON.

## Visual evidence

The deterministic real-route browser run exercised read-only, conflict, edit, validation, lock-loss, lock-loss recovery, success, and dirty-close states at 1024×1000, 1440×1000, and 1920×1080. All 24 screenshots are under `.omx/artifacts/phase-2-6/task-13/` with `ready-measurements.json` and `ready.sha256`; every hash revalidated after final code review.

Measurements prove no horizontal body overflow, the Profile precedes Layers, all six groups and 31 values are present, and every Drawer remains inside the viewport. The final verdict is **94 / pass** with no blocker. It is persisted byte-for-byte at:

- `.omx/state/phase-2-6/task-13-visual.json`
- `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-13.json`

The post-verdict code-review correction changed only lock-controller continuation authority and its unit regression; it did not alter markup, styling, or any captured visual state, so the final screenshots remain representative.

## Remaining risks

- Hook lifecycle and native modal close behavior are covered by pure seams plus real browser QA rather than a dedicated mounted React integration test.
- Release is intentionally best-effort; if both normal release and beacon transport fail, the server TTL remains the final cleanup boundary.
- At exactly 1024px the compact 40% Drawer keeps two columns, so long choice trigger text can truncate; the complete raw/resolved code diagnostic remains visible below the trigger and the visual reviewer classified this as non-blocking.
- Save success is visible through the updated detail and closed Drawer but has no separate transient `role="status"` message; this was a non-blocking visual suggestion, not a task requirement.
- The production build retains the repository's pre-existing Glide Data Grid PURE-annotation and bundle-size warnings; Task 13 adds no dependency or build error.

## Follow-up independent review — 2026-07-15

### Result

Closed three additional concurrency/unload findings with strict behavioral RED/GREEN regressions and no UI or dependency change:

- Pending PATCH ownership is now scoped by `{generation, token, promise}` rather than one controller-global promise. A lost-session PATCH may remain pending while the reacquired token performs its own PATCH; disposal releases the current token promptly when only an old-session write remains, and a late old settlement cannot clear, mutate, invalidate, close, or release the new session.
- Reacquire ownership is now generation-scoped. If a reacquired token is itself lost while its Profile GET hangs, the new loss generation can immediately release that token and acquire a third session; the old operation cannot suppress or clear the current reacquire.
- `beforeunload` beacon release now waits until event propagation completes and checks `defaultPrevented`. A dirty navigation that the user cancels keeps the live token and editable state, while confirmed `pagehide` or uncancelled `beforeunload` still beacon-releases the held session exactly once.

### Changed files and simplifications

- `frontend/src/features/projects/profileLockState.ts` — reused the existing generation/token ownership vocabulary for pending writes and reacquires, plus one small injectable unload-event coordinator.
- `frontend/src/features/projects/profileLockState.test.ts` — added deferred old/new PATCH, prompt dispose, repeated lock-loss/reacquire, cancelled-beforeunload, pagehide, and uncancelled-beforeunload regressions.
- `frontend/src/features/projects/useProjectProfileLock.ts` — wires the shared deferred unload handlers without changing Drawer presentation or controller public behavior.

The fix deliberately avoids cancellation abstractions or a second operation registry: one scoped record per operation class is sufficient, and object/generation identity prevents old finalizers from clearing newer work.

### Evidence

- Pending-write RED/GREEN: `.superpowers/sdd/task-13-followup-session-write-{red,green}.log` (new Save expected PATCH 2 / received 1; prompt dispose expected release 2 / received 1 before the fix).
- Reacquire RED/GREEN: `.superpowers/sdd/task-13-followup-reacquire-{red,green}.log` (third acquire expected 3 / received 2 before the fix).
- Dirty unload RED/GREEN: `.superpowers/sdd/task-13-followup-unload-dirty-{red,green}.log` (cancelled dirty event incorrectly beacon-released once before the fix).
- Focused final: 8 files / 70 tests passed (`task-13-followup-final-focused.log`).
- Full frontend: 62 files / 605 tests passed (`task-13-followup-final-full-frontend.log`).
- Typecheck, lint, and production build passed (`task-13-followup-final-typecheck.log`, `task-13-followup-final-lint.log`, `task-13-followup-final-build.log`).
- Static contract checks and all 24 screenshot hashes passed. The follow-up changes operation authority and unload timing only; markup, styling, captured state, and the tracked **94 / pass** visual verdict remain byte-identical and representative.
- Independent read-only re-review found all three fixes sound with no further issue in the modified scope before the committed-tree verification gate.

### Remaining risk

- Native browser prompt display remains browser-owned and cannot be automated directly in the node suite. The injectable seam proves after-propagation cancellation and exact one-shot decisions, while the existing browser run covers the unchanged dirty Drawer interaction and page lifecycle presentation.
