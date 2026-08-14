# Condition Cell Invalid Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve rejected single-cell input in the Sheet Grid, explain the repair beside the active cell, and protect it from accidental navigation without ever persisting it.

**Architecture:** Extend the existing Zustand edit store with a separate `invalidDrafts` map keyed by the same condition/parameter identity as dirty cells. Glide validates one edit, publishes either the existing valid-edit callback or one invalid-draft callback, and renders the store projection passed down by `SheetView`; invalid drafts never enter autosave. `SheetView` composes dirty and invalid counts into the existing navigation guard and relies on unmount/session clearing for confirmed discard.

**Tech Stack:** React 18, TypeScript, Zustand, Glide Data Grid, React Router, TanStack Query, Vitest, Testing Library, Playwright fixture, Tailwind CSS 4.

## Global Constraints

- No server endpoint, backend model, database migration, package, or network dependency changes.
- No new Zustand store, React context/provider, state machine, or Grid library import outside `frontend/src/grid/`.
- Invalid drafts are session-local display state and must never enter autosave, retry, reconciliation, paste, or cell PATCH payloads.
- Existing bulk-paste atomic validation/rejection behavior remains unchanged.
- Existing validation/history/Backbone workbench content remains unchanged.
- Fixed Grid row geometry and Glide virtualization remain intact; only the active invalid cell may show one anchored popover.
- Read-only and lost-lock Sheets cannot create, modify, or clear invalid drafts through editing.
- Error copy follows `problem + constraint + state + next action`, in concise Korean, and exposes meaning without relying on color.
- Desktop verification targets are exactly 1024px, 1440px, and 1920px; mobile Sheet editing is out of scope.
- Run the Impeccable detector exactly once after production UI files are final, not during intermediate implementation.

---

## File map

- `frontend/src/features/sheets/editStore.ts`: authoritative dirty and invalid-draft maps, identity reducers, display overlay, pruning, and session clearing.
- `frontend/src/features/sheets/useSheetEditing.ts`: exposes invalid count/discard behavior and prevents lock release while unsaved invalid drafts exist; it does not persist them.
- `frontend/src/grid/types.ts`: adapter contract for constraints, invalid draft projection, and invalid callback.
- `frontend/src/grid/cellValue.ts`: existing single-cell validator extended with required/min/max failures and concise repair copy.
- `frontend/src/grid/decimalCell.tsx`: editor returns rejected raw input to the Grid boundary instead of trapping it only inside the overlay.
- `frontend/src/grid/GlideConditionGrid.tsx`: display precedence, invalid canvas marker, accessible content, active-cell popover, and selection-driven visibility.
- `frontend/src/features/sheets/SheetView.tsx`: store-to-Grid wiring, valid/invalid callback routing, coordinate pruning, unsaved navigation protection, and header status.
- Adjacent `*.test.ts(x)` files: pure reducers first, then Grid behavior, then mounted Sheet integration.
- `docs/superpowers/evidence/condition-cell-invalid-drafts/`: deterministic browser fixture result, screenshots, and reproduction notes.

---

### Task 1: Add invalid drafts to the existing edit store

**Files:**
- Modify: `frontend/src/grid/types.ts`
- Modify: `frontend/src/features/sheets/editStore.ts`
- Test: `frontend/src/features/sheets/editStore.test.ts`

**Interfaces:**
- Consumes: existing `dirtyKey(conditionId, parameterCode)` identity and `ConditionGridRow`.
- Produces:
  - Grid-domain `InvalidCellDraft { conditionId; parameterCode; rawValue; code; message; constraint }`
  - `InvalidCellDraftMap = ReadonlyMap<string, InvalidCellDraft>`
  - `setInvalidDraft(draft)`, `clearInvalidDraft(conditionId, parameterCode)`, and `pruneInvalidDrafts(rows, columns)` store actions
  - `applyInvalidDraftsToRows(rows, invalidDrafts): Row[]`
  - `selectInvalidDrafts` and `selectInvalidDraftCount`

- [ ] **Step 1: Write failing reducer and projection tests**

Add tests that prove invalid drafts use the same stable coordinate key, override display without
mutating server rows, stay separate from dirty cells, clear one coordinate, prune removed
conditions/parameters, and clear with the session:

```ts
const invalid = (rawValue = 'abc'): InvalidCellDraft => ({
  conditionId: '1',
  parameterCode: 'spin',
  rawValue,
  code: 'invalid_decimal',
  message: '숫자로 입력하세요',
  constraint: null,
})

it('overlays a raw invalid draft without adding a dirty cell', () => {
  useEditStore.getState().setInvalidDraft(invalid())
  expect(useEditStore.getState().dirtyCells.size).toBe(0)
  expect(applyInvalidDraftsToRows(rows, useEditStore.getState().invalidDrafts)[0].values.spin)
    .toBe('abc')
  expect(rows[0].values.spin).toBe('90')
})

it('prunes drafts whose condition or parameter disappeared', () => {
  const retained = new Map([
    [dirtyKey('1', 'spin'), invalid()],
    [dirtyKey('gone', 'spin'), { ...invalid(), conditionId: 'gone' }],
    [dirtyKey('1', 'gone'), { ...invalid(), parameterCode: 'gone' }],
  ])
  expect([...pruneInvalidDraftMap(retained, rows, columns).keys()])
    .toEqual([dirtyKey('1', 'spin')])
})
```

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
cd frontend
npm test -- --run src/features/sheets/editStore.test.ts
```

Expected: FAIL because invalid-draft types, reducers, projections, and store actions do not exist.

- [ ] **Step 3: Implement the smallest separate invalid map inside `EditState`**

Define `InvalidCellDraft` in `frontend/src/grid/types.ts`, alongside the Grid callback/data
contract, so the Grid never imports feature-layer store code. Import that type into
`editStore.ts`. Use the existing identity key, but never add a revision or transport conversion:

```ts
export interface InvalidCellDraft {
  conditionId: string
  parameterCode: string
  rawValue: string
  code: CellValidationErrorCode
  message: string
  constraint: string | null
}

export type InvalidCellDraftMap = ReadonlyMap<string, InvalidCellDraft>

interface EditState {
  dirtyCells: DirtyCellMap
  invalidDrafts: InvalidCellDraftMap
  setInvalidDraft(draft: InvalidCellDraft): void
  clearInvalidDraft(conditionId: string, parameterCode: string): void
  pruneInvalidDrafts(
    rows: readonly ConditionGridRow[],
    columns: readonly Pick<ConditionGridColumn, 'key'>[],
  ): void
  // existing fields stay unchanged
}
```

`setInvalidDraft` replaces only that coordinate. `clearInvalidDraft` is a no-op when absent.
`clearAll` clears both maps but preserves all monotonic counters. `setCell` and `setCells` must not
implicitly manufacture invalid drafts; the valid callback explicitly clears its coordinate before
calling them.

- [ ] **Step 4: Run store tests to verify GREEN**

Run the Task 1 command again. Expected: all `editStore` tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add frontend/src/grid/types.ts frontend/src/features/sheets/editStore.ts \
  frontend/src/features/sheets/editStore.test.ts
git commit -m "feat: retain invalid condition cell drafts"
```

---

### Task 2: Complete the single-cell constraint contract

**Files:**
- Modify: `frontend/src/grid/types.ts`
- Modify: `frontend/src/grid/cellValue.ts`
- Modify: `frontend/src/features/sheets/sheetAdapter.ts`
- Test: `frontend/src/grid/cellValue.test.ts`
- Test: `frontend/src/features/sheets/sheetAdapter.test.ts`
- Mechanically update typed column fixtures in adjacent Grid tests only where TypeScript requires it.

**Interfaces:**
- Consumes: Sheet column fields `required`, `min_value`, `max_value`, existing decimal normalization, and existing Choice resource validation.
- Produces:
  - `ConditionGridColumn.required: boolean`
  - `ConditionGridColumn.minValue: string | null`
  - `ConditionGridColumn.maxValue: string | null`
  - new error codes `required_value` and `number_out_of_range`
  - `CellCandidateResult` failures whose `message` is the concise problem and whose optional `constraint` contains the repair boundary.

- [ ] **Step 1: Add failing required, numeric-bound, and adapter tests**

Use explicit columns and exact string-preserving decimals:

```ts
const boundedNumber: ConditionGridColumn = {
  ...numberColumn,
  required: true,
  minValue: '0',
  maxValue: '500',
  unit: 'kPa',
}

expect(validateSingleCellEdit(boundedNumber, '100', '')).toEqual({
  ok: false,
  code: 'required_value',
  message: '필수값을 입력하세요',
  constraint: null,
  rawValue: '',
})

expect(validateSingleCellEdit(boundedNumber, '100', '501')).toEqual({
  ok: false,
  code: 'number_out_of_range',
  message: '허용 범위를 벗어났습니다',
  constraint: '0–500 kPa 범위로 입력하세요',
  rawValue: '501',
})
```

The adapter test must assert the three fields arrive on the exact `ConditionGridColumn`, not only
on an `AdaptedConditionGridColumn` refinement.

- [ ] **Step 2: Run focused tests to verify RED**

```bash
cd frontend
npm test -- --run src/grid/cellValue.test.ts src/features/sheets/sheetAdapter.test.ts
```

Expected: FAIL because the common contract and single-cell validator do not enforce required or
bounds.

- [ ] **Step 3: Extend the existing validator without creating a second rule engine**

Add the fields to `ConditionGridColumn`, remove their duplication from the adapted interface, and
compare normalized decimals with the project's string-decimal helper rather than JavaScript
`number`. Preserve the rule order:

```ts
if (trimmed === '') {
  return column.required
    ? failure('required_value', '필수값을 입력하세요', raw, null)
    : { ok: true, value: null }
}

// after decimal normalization succeeds
const constraint = numericConstraint(column)
if (!decimalWithinBounds(normalized.value, column.minValue, column.maxValue)) {
  return failure(
    'number_out_of_range',
    '허용 범위를 벗어났습니다',
    raw,
    constraint,
  )
}
```

For invalid decimal form use `숫자로 입력하세요`; for unknown/inactive Choice input retain the
existing reason but normalize the repair message to `목록에서 사용할 수 있는 값을 선택하세요`.
Resource-unavailable failures remain blocked editor/resource errors and are not converted into a
draft by later Tasks.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
npm test -- --run src/grid/cellValue.test.ts src/features/sheets/sheetAdapter.test.ts
npm run typecheck
```

Expected: tests and typecheck pass. Update only fixture objects that now require the three explicit
constraint fields; do not make the fields optional to avoid hiding incomplete Grid contracts.

- [ ] **Step 5: Commit Task 2**

```bash
git add frontend/src/grid/types.ts frontend/src/grid/cellValue.ts \
  frontend/src/features/sheets/sheetAdapter.ts frontend/src/grid/cellValue.test.ts \
  frontend/src/features/sheets/sheetAdapter.test.ts frontend/src/grid/*.test.ts*
git commit -m "feat: validate condition cell constraints"
```

---

### Task 3: Render and operate invalid drafts inside the Glide boundary

**Files:**
- Modify: `frontend/src/grid/types.ts`
- Modify: `frontend/src/grid/decimalCell.tsx`
- Modify: `frontend/src/grid/GlideConditionGrid.tsx`
- Test: `frontend/src/grid/decimalCell.test.tsx`
- Test: `frontend/src/grid/GlideConditionGrid.test.tsx`

**Interfaces:**
- Consumes: `InvalidCellDraft` projection from Task 1 and `CellCandidateResult` from Task 2.
- Produces:
  - `ConditionGridData.invalidDrafts?: readonly InvalidCellDraft[]`
  - `ConditionGridCallbacks.onCellInvalid?(draft: InvalidCellDraft): void`
  - `ConditionGridCallbacks.onInvalidDraftClear?(conditionId, parameterCode): void`
  - pure `invalidDraftPopoverPlacement(bounds, viewport, size)` for below/above placement
  - one accessible, fixed-position `role="alert"` popover for the selected invalid cell.

- [ ] **Step 1: Write failing Grid/editor tests for rejected raw input and callback exclusivity**

Cover these contracts with the existing captured `DataEditor` props harness:

```ts
it('publishes an invalid draft and never publishes persistence for a rejected edit', () => {
  capturedProps.onCellEdited?.([4, 0], textCell('abc'))
  expect(onCellInvalid).toHaveBeenCalledWith(expect.objectContaining({
    conditionId: '1', parameterCode: 'pressure', rawValue: 'abc',
  }))
  expect(onCellEdit).not.toHaveBeenCalled()
})

it('clears one invalid draft before publishing one valid correction', () => {
  capturedProps.onCellEdited?.([4, 0], textCell('120'))
  expect(onInvalidDraftClear).toHaveBeenCalledWith('1', 'pressure')
  expect(onCellEdit).toHaveBeenCalledTimes(1)
})
```

Also assert that a Choice resource-unavailable result calls neither invalid nor persistence, a
read-only Grid exposes no edit callback, and DecimalEditor sends the rejected raw candidate to the
Grid boundary while Escape finishes with `undefined`.

- [ ] **Step 2: Write failing visual, selection, and placement tests**

Prove:

- `getCellContent` uses invalid raw input as display/copy data and exposes coordinate, reason, and
  `저장되지 않음` in accessible data;
- `drawCell` adds an inset error boundary and non-color marker without changing `rowHeight`;
- selecting an invalid cell shows one alert popover; selecting another cell removes it without
  clearing the draft; returning shows it again;
- the pure placement helper prefers below and flips above near the viewport bottom.

```ts
expect(invalidDraftPopoverPlacement(
  { x: 300, y: 700, width: 120, height: 32 },
  { width: 1024, height: 768 },
  { width: 280, height: 104 },
).placement).toBe('above')
```

- [ ] **Step 3: Run focused Grid tests to verify RED**

```bash
cd frontend
npm test -- --run src/grid/decimalCell.test.tsx src/grid/GlideConditionGrid.test.tsx
```

Expected: FAIL for missing invalid callbacks, display projection, popover, and placement helper.

- [ ] **Step 4: Implement invalid edit routing in `handleCellEdited`**

Keep one validation branch:

```ts
const validation = validateSingleCellEdit(column, oldValue, candidate ?? '', resource)
if (!validation.ok) {
  if (validation.code !== 'choice_resource_unavailable') {
    callbacks?.onCellInvalid?.({
      conditionId: target.conditionId,
      parameterCode: target.parameterCode,
      rawValue: validation.rawValue,
      code: validation.code,
      message: validation.message,
      constraint: validation.constraint,
    })
  }
  return
}
callbacks?.onInvalidDraftClear?.(target.conditionId, target.parameterCode)
if (shouldPersistCellChange(oldValue, validation.value)) callbacks?.onCellEdit?.({ ... })
```

Update DecimalEditor so invalid Enter finishes an editable custom cell containing its raw value;
the Grid's single validator remains authoritative. Do not maintain a second durable error state in
the editor.

- [ ] **Step 5: Implement display precedence, marker, and active popover**

Index `data.invalidDrafts` once with `useMemo`. Invalid draft display precedes row values and status
themes, while paste staging retains its existing whole-surface priority. Use
`gridRef.current?.getBounds(col, row)` after selection changes to anchor the active draft. Render
one fixed alert with four short lines and `pointerEvents: 'none'`; recompute on selected-cell change
and relevant Grid scroll/resize callbacks already exposed by Glide. Do not add a global listener.

- [ ] **Step 6: Run focused Grid tests and typecheck**

```bash
npm test -- --run src/grid/decimalCell.test.tsx src/grid/GlideConditionGrid.test.tsx
npm run typecheck
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 7: Commit Task 3**

```bash
git add frontend/src/grid/types.ts frontend/src/grid/decimalCell.tsx \
  frontend/src/grid/decimalCell.test.tsx frontend/src/grid/GlideConditionGrid.tsx \
  frontend/src/grid/GlideConditionGrid.test.tsx
git commit -m "feat: explain invalid Grid cell drafts"
```

---

### Task 4: Wire drafts into the Sheet session and navigation guard

**Files:**
- Modify: `frontend/src/features/sheets/SheetView.tsx`
- Modify: `frontend/src/features/sheets/useSheetEditing.ts`
- Test: `frontend/src/features/sheets/SheetView.test.tsx`
- Test: `frontend/src/features/sheets/useSheetEditing.test.ts` if hook-boundary helpers are extracted; otherwise extend `SheetView.test.tsx` and existing pure editing tests.
- Test: `frontend/src/shared/navigation/useUnsavedChanges.test.ts`

**Interfaces:**
- Consumes: Task 1 store actions/selectors and Task 3 Grid callbacks/data.
- Produces:
  - Sheet `displayRows = applyInvalidDraftsToRows(applyDirtyToRows(serverRows, dirtyCells), invalidDrafts)`
  - `editing.invalidDraftCount` and `editing.unsavedCount`
  - one `useUnsavedChanges({ when: unsavedCount > 0, ... })` invocation for Sheet route changes
  - invalid draft pruning when authoritative row/column identities disappear.

- [ ] **Step 1: Write failing mounted Sheet tests for persistence isolation and refresh survival**

Using the real store and mounted Sheet harness, assert:

- invalid callback installs raw draft and does not call `patchCells`;
- valid correction clears the draft and calls the existing `setCell`/persistence path once;
- query refresh with the same coordinate preserves the invalid display;
- refresh after condition/parameter removal prunes the orphan;
- read-only and lost-lock modes cannot install or clear drafts.

The valid-correction test must wait through the actual autosave harness rather than manually
calling store internals.

- [ ] **Step 2: Write failing navigation and status tests**

Mount inside a data router and prove that an invalid-only session triggers the existing confirmation
message. Stub `window.confirm` twice:

```ts
vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
```

The first navigation remains on the Sheet and preserves the draft; the second proceeds, unmounts
the Sheet, and clears it. Also assert the header says `입력 오류 1` separately from persisted
`미저장 N`, and that the existing discard action clears both maps only when explicitly invoked.

- [ ] **Step 3: Run focused Sheet tests to verify RED**

```bash
cd frontend
npm test -- --run src/features/sheets/SheetView.test.tsx \
  src/features/sheets/editStore.test.ts \
  src/shared/navigation/useUnsavedChanges.test.ts
```

Expected: FAIL because Sheet does not yet pass invalid state or guard route navigation.

- [ ] **Step 4: Wire store state and callbacks without adding an orchestration layer**

In `SheetView` read `invalidDrafts`, compose display rows, and extend `gridCallbacks`:

```ts
onCellInvalid: (draft) => {
  if (!interaction.canEditCells || pasteRef.current !== null) return
  useEditStore.getState().setInvalidDraft(draft)
},
onInvalidDraftClear: (conditionId, parameterCode) => {
  if (!interaction.canEditCells || pasteRef.current !== null) return
  useEditStore.getState().clearInvalidDraft(conditionId, parameterCode)
},
```

Pass `invalidDrafts: [...invalidDrafts.values()]` in Grid data. Prune in an effect keyed by stable
authoritative `data.rows` and `data.columns`, not filtered/current-only display rows.

- [ ] **Step 5: Extend the existing editing/session boundary and route protection**

`useSheetEditing` selects invalid count, reports `unsavedCount = dirtyCount + invalidDraftCount`,
includes invalid drafts in its unload lock-release guard, and lets existing `discard()`/session
`clearAll()` remove both maps. It must not include invalid drafts in `getPersistenceSnapshot`,
`dirtyCellList`, autosave scheduling, or validation persistence barriers.

Call the existing shared navigation hook from the mounted Sheet editor:

```ts
useUnsavedChanges({
  when: editing.unsavedCount > 0,
  message: '저장되지 않은 입력이 있습니다. 조건표를 나갈까요?',
})
```

Cancel naturally preserves mounted store state; proceed naturally unmounts and invokes the
existing session cleanup. Do not add a second confirm dialog or navigation service.

- [ ] **Step 6: Run focused tests, full frontend tests, lint, and build**

```bash
npm test -- --run src/features/sheets/SheetView.test.tsx \
  src/features/sheets/editStore.test.ts \
  src/features/sheets/useSheetEditing.test.ts \
  src/shared/navigation/useUnsavedChanges.test.ts
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Expected: all commands pass; existing Glide third-party PURE and bundle-size advisories may remain,
but no new warning is accepted.

- [ ] **Step 7: Commit Task 4**

```bash
git add frontend/src/features/sheets/SheetView.tsx \
  frontend/src/features/sheets/SheetView.test.tsx \
  frontend/src/features/sheets/useSheetEditing.ts \
  frontend/src/features/sheets/useSheetEditing.test.ts \
  frontend/src/shared/navigation/useUnsavedChanges.test.ts
git commit -m "feat: protect invalid Sheet input"
```

If `useSheetEditing.test.ts` is not created because every changed boundary is covered through
existing pure tests and mounted Sheet behavior, omit that nonexistent path from `git add`; document
the decision in the task report.

---

### Task 5: Verify the complete desktop interaction and evidence

**Files:**
- Create: `docs/superpowers/evidence/condition-cell-invalid-drafts/README.md`
- Create or adapt: `docs/superpowers/evidence/condition-cell-invalid-drafts/browser-fixture.cjs`
- Create: `docs/superpowers/evidence/condition-cell-invalid-drafts/browser-results.json`
- Create: `.impeccable/review/condition-cell-invalid-draft-1024.png`
- Create: `.impeccable/review/condition-cell-invalid-draft-1440.png`
- Create: `.impeccable/review/condition-cell-invalid-draft-1920.png`
- Modify production or test files only if this bounded verification finds a concrete defect.

**Interfaces:**
- Consumes: Tasks 1–4 final UI and the existing deterministic Signal Grid browser fixture pattern.
- Produces: reproducible evidence for invalid retention, repair, navigation protection, popover placement, accessibility, and overflow.

- [ ] **Step 1: Run the final focused and full automated gates**

```bash
cd frontend
npm test -- --run src/features/sheets/editStore.test.ts \
  src/features/sheets/sheetAdapter.test.ts src/grid/cellValue.test.ts \
  src/grid/decimalCell.test.tsx src/grid/GlideConditionGrid.test.tsx \
  src/features/sheets/SheetView.test.tsx \
  src/shared/navigation/useUnsavedChanges.test.ts
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Expected: all pass on the exact commit under verification.

- [ ] **Step 2: Run the required Impeccable detector exactly once**

```bash
node /home/appuser/.codex/skills/impeccable/scripts/detect.mjs --json \
  frontend/src/grid/decimalCell.tsx \
  frontend/src/grid/GlideConditionGrid.tsx \
  frontend/src/features/sheets/SheetView.tsx
```

Record the exact JSON result in the evidence README. Do not rerun the detector during screenshot
fixes.

- [ ] **Step 3: Build a deterministic browser scenario and capture all viewports in one run**

Reuse the existing local Playwright cache when available; do not download a browser or package.
The fixture must exercise:

1. enter invalid numeric form and confirm raw value, marker, popover, and zero PATCH calls;
2. move to another cell and confirm popover closes while marker/raw draft remain;
3. return and confirm popover reopens;
4. enter an out-of-range and required failure and confirm repair copy;
5. correct one value and confirm exactly one PATCH while the other draft remains;
6. cancel route navigation and confirm the draft survives;
7. confirm route navigation and re-enter to confirm server value restoration;
8. place an invalid edit in a bottom-visible row and confirm the popover flips above;
9. verify the accessible description contains coordinate, reason, and `저장되지 않음`.

At 1024, 1440, and 1920 widths record document client/scroll width, Grid scroller ownership, active
cell bounds, popover bounds, and whether the popover remains inside the viewport.

- [ ] **Step 4: Inspect screenshots once and apply at most one bounded fix batch**

Inspect all three PNGs at original resolution together. Fix only concrete defects in legibility,
overlap, placement, focus, or overflow. Add a failing regression test before each production fix,
then run the affected focused test, full frontend suite, and build once. Confirm screenshots once
more and stop polishing.

- [ ] **Step 5: Write evidence and commit verification artifacts**

The README records exact commands, tool/cache paths, assertion counts, expected fixture errors,
viewport measurements, PNG SHA-256 hashes, detector output, and any known pre-existing warnings.

```bash
git diff --check
git add docs/superpowers/evidence/condition-cell-invalid-drafts \
  .impeccable/review/condition-cell-invalid-draft-1024.png \
  .impeccable/review/condition-cell-invalid-draft-1440.png \
  .impeccable/review/condition-cell-invalid-draft-1920.png
git commit -m "test: verify invalid condition cell drafts"
```

If the bounded browser pass required production fixes, commit those fixes separately before the
evidence commit with their regression tests.

---

## Completion criteria

- A rejected single-cell value remains visibly editable for the mounted Sheet session and never
  reaches persistence.
- One active-cell popover explains the problem and repair without changing Grid row geometry.
- Valid correction clears exactly one draft and uses the existing persistence path exactly once.
- Focus movement, query refresh, filtering, virtualization, read-only mode, and coordinate removal
  obey the approved lifecycle.
- Route cancellation preserves invalid work; confirmed departure discards it; reload/re-entry shows
  server-backed values.
- Paste, validation workbench, history, Backbone, lock, autosave, and performance contracts remain
  intact.
- All automated gates, detector, browser assertions, screenshots, and final review are clean.
