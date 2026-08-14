# Signal Grid History Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split timeline/cell history UI with a Signal Grid revision ledger that defaults to the current Layer, optionally narrows to the selected cell, preserves work context, and exposes only API-authoritative values.

**Architecture:** Keep the existing History API, TanStack Query controller, pagination, batch-detail cache, and coordinate navigation as the authority. Retain the controller's internal `timeline | cell` query mode to avoid a migration-only abstraction, but present it as the user-facing `현재 Layer | 현재 셀만` scope. Reshape `HistoryWorkbench` in place and wire selected-cell availability through `SheetView`; do not add a store, context, backend endpoint, or speculative value parser.

**Tech Stack:** React 18, TypeScript, TanStack Query, Tailwind CSS 4, Vitest/Testing Library, Glide Data Grid, deterministic Playwright browser fixture.

## Global Constraints

- Preserve existing routes, History API payloads, database schema, query keys, pagination, batch cache, and coordinate navigation contracts.
- The default history scope is the current Layer even when a grid cell is selected.
- `현재 셀만` is enabled only when a selected cell is available; switching to it must use the existing cell-history query.
- Timeline items must never invent, infer, or parse old/new values; exact diffs appear only in cell history and expanded batch detail.
- Layer changes preserve actor, date, origin/source, source-project, and event-type filters while replacing only `layerKey`.
- Row activation selects or expands; only an explicit `셀로 이동` control changes the grid position.
- Preserve successful rows during filter validation, next-page failure, and batch-detail failure.
- Preserve the existing 320–520px inspector width/storage contract and the 1024/1440/1920 desktop viewport support.
- Use the PCM Signal Grid system: paper/ink neutrals, cobalt only for action/current state, amber only for revision evidence, rules instead of repeated cards/shadows.
- Use short Korean copy; problems follow `문제 + 영향 + 다음 행동`.
- Meet WCAG 2.2 AA, visible keyboard focus, non-color state cues, disclosure semantics, and non-duplicated live announcements.
- Do not add dependencies, global listeners, global state, runtime network requests, mobile support, or unrelated refactors.
- Do not modify the user-owned root checkout or `frontend/vite.config.ts` changes outside this worktree.

## File Map

- `frontend/src/features/sheets/historyWorkbenchState.ts`: retain the internal query mode; add narrow transitions that preserve selected cell and user filters while changing Layer scope.
- `frontend/src/features/sheets/historyWorkbenchState.test.ts`: reducer/state invariants for Layer scope, cell availability, batch cache, and filter preservation.
- `frontend/src/features/sheets/useHistoryWorkbenchController.ts`: expose explicit Layer/cell scope callbacks over the existing queries without duplicating data.
- `frontend/src/features/sheets/useHistoryWorkbenchController.test.ts`: query enablement, scope switching, stale-result rejection, pagination, and mutation invalidation.
- `frontend/src/features/sheets/HistoryWorkbench.tsx`: one composed revision ledger, collapsed filter disclosure, authoritative event/batch/cell rendering, and all local status UI.
- `frontend/src/features/sheets/HistoryWorkbench.test.tsx`: semantic rendering and interaction contracts for the redesigned panel.
- `frontend/src/features/sheets/SheetView.tsx`: pass current Layer label and selected cell; synchronize cell-scope requests without automatic history-scope changes on ordinary cell selection.
- `frontend/src/features/sheets/SheetView.test.tsx`: integration contracts for default Layer scope, selected-cell scope, Layer change, and explicit navigation.
- `docs/evidence/signal-grid-history-workbench/`: deterministic browser fixture, screenshots, measurements, results, and README.

---

### Task 1: Preserve Layer and cell scope authority in state and controller

**Files:**
- Modify: `frontend/src/features/sheets/historyWorkbenchState.ts`
- Modify: `frontend/src/features/sheets/historyWorkbenchState.test.ts`
- Modify: `frontend/src/features/sheets/useHistoryWorkbenchController.ts`
- Modify: `frontend/src/features/sheets/useHistoryWorkbenchController.test.ts`

**Interfaces:**
- Consumes: existing `HistoryWorkbenchState`, `HistoryCellScope`, `HistoryTimelineFilterInput`, timeline/cell query helpers, and batch-detail cache.
- Produces: `replaceHistoryLayerScope(state, layerKey)`, `rememberHistoryCellScope(state, scope)`, controller `onLayerScopeChange(layerKey)`, `onSelectedCellChange(target | null)`, and `onScopeChange('timeline' | 'cell'): boolean`.
- Invariant: `onSelectedCellChange` remembers a valid selected cell but does not switch from Layer to cell scope; `onScopeChange('cell')` fails closed when no cell is available.

- [ ] **Step 1: Write reducer tests for scope and filter preservation**

Add focused tests equivalent to:

```ts
it('replaces only the Layer filter and defaults to the Layer ledger', () => {
  const state = openHistoryCellScope(
    createHistoryWorkbenchState({
      layerKey: 'L1::10::ETCH',
      actor: 'engineer',
      origin: 'manual',
      eventTypes: ['cell_update'],
    }),
    { conditionId: 11, parameterCode: 'ETCH_P001' },
  )

  const next = replaceHistoryLayerScope(state, 'L2::20::CLEAN')

  expect(next.mode).toBe('timeline')
  expect(next.filters).toMatchObject({
    layerKey: 'L2::20::CLEAN',
    actor: 'engineer',
    origin: 'manual',
    eventTypes: ['cell_update'],
  })
  expect(next.cellScope).toEqual({ conditionId: 11, parameterCode: 'ETCH_P001' })
})

it('remembers a selected cell without opening cell history', () => {
  const next = rememberHistoryCellScope(createHistoryWorkbenchState(), {
    conditionId: 22,
    parameterCode: 'PRESSURE',
  })
  expect(next.mode).toBe('timeline')
  expect(next.cellScope).toEqual({ conditionId: 22, parameterCode: 'PRESSURE' })
})
```

- [ ] **Step 2: Run the state tests and verify RED**

Run:

```bash
cd frontend
npm test -- --run src/features/sheets/historyWorkbenchState.test.ts
```

Expected: FAIL because `replaceHistoryLayerScope` and `rememberHistoryCellScope` do not exist.

- [ ] **Step 3: Add the two narrow state transitions**

Implement without changing the wire/query mode type:

```ts
export function rememberHistoryCellScope(
  state: HistoryWorkbenchState,
  scope: HistoryCellScope | null,
): HistoryWorkbenchState {
  if (scope === null) {
    return state.mode === 'cell'
      ? { ...state, mode: 'timeline', cellScope: null, expandedBatchKey: null }
      : { ...state, cellScope: null }
  }
  return { ...state, cellScope: scope }
}

export function replaceHistoryLayerScope(
  state: HistoryWorkbenchState,
  layerKey: string,
): HistoryWorkbenchState {
  const next = updateHistoryWorkbenchFilters(state, {
    ...state.filters,
    layerKey,
  })
  return { ...next, mode: 'timeline', cellScope: state.cellScope }
}
```

Keep filter normalization, revision increments, page reset, detail invalidation, and navigation announcement behavior in the existing reducer path.

- [ ] **Step 4: Write controller tests for explicit scope switching**

Add hook/controller tests that prove:

```ts
expect(controller.result.current.onScopeChange('cell')).toBe(false)

act(() => {
  controller.result.current.onSelectedCellChange({
    conditionId: '11',
    parameterCode: 'ETCH_P001',
  })
})
expect(controller.result.current.state.mode).toBe('timeline')
expect(controller.result.current.onScopeChange('cell')).toBe(true)
expect(controller.result.current.state.mode).toBe('cell')

act(() => controller.result.current.onLayerScopeChange('L2::20::CLEAN'))
expect(controller.result.current.state.mode).toBe('timeline')
expect(controller.result.current.state.filters.actor).toBe('dev-admin')
expect(controller.result.current.state.filters.layerKey).toBe('L2::20::CLEAN')
```

Also assert that late cell/batch results from the prior authority are ignored.

- [ ] **Step 5: Run the controller tests and verify RED**

Run:

```bash
cd frontend
npm test -- --run src/features/sheets/useHistoryWorkbenchController.test.ts
```

Expected: FAIL because the new callbacks are absent.

- [ ] **Step 6: Implement the controller callbacks over existing queries**

Extend `HistoryWorkbenchController` with:

```ts
onLayerScopeChange: (layerKey: string) => void
onSelectedCellChange: (
  target: { conditionId: string; parameterCode: string } | null,
) => boolean
onScopeChange: (mode: HistoryWorkbenchMode) => boolean
```

Rules:

```ts
const onScopeChange = useCallback((mode: HistoryWorkbenchMode): boolean => {
  if (mode === 'cell' && stateRef.current.cellScope === null) return false
  // Reuse the existing request-token reset before changing authority.
  // Keep cached timeline pages; the query cache remains authoritative.
  commitState((current) => ({ ...current, mode }))
  return true
}, [commitState, commitDetailRequest])
```

`onSelectedCellChange` parses the existing target shape and calls `rememberHistoryCellScope`; it must not change `mode`. `onLayerScopeChange` validates non-empty `layerKey`, resets obsolete batch-detail request authority, and calls `replaceHistoryLayerScope`.

Retain `onCellHistoryRequest` temporarily as a compatibility wrapper that remembers the target and explicitly switches to cell scope. Remove it only in Task 4 after `SheetView` callers are migrated.

- [ ] **Step 7: Run focused state/controller tests and typecheck**

Run:

```bash
cd frontend
npm test -- --run \
  src/features/sheets/historyWorkbenchState.test.ts \
  src/features/sheets/useHistoryWorkbenchController.test.ts
npm run typecheck
```

Expected: all focused tests PASS and typecheck exits 0.

- [ ] **Step 8: Commit Task 1**

```bash
git add \
  frontend/src/features/sheets/historyWorkbenchState.ts \
  frontend/src/features/sheets/historyWorkbenchState.test.ts \
  frontend/src/features/sheets/useHistoryWorkbenchController.ts \
  frontend/src/features/sheets/useHistoryWorkbenchController.test.ts
git commit -m "refactor: model history Layer and cell scopes"
```

---

### Task 2: Collapse filters without broadening their authority

**Files:**
- Modify: `frontend/src/features/sheets/HistoryWorkbench.tsx`
- Modify: `frontend/src/features/sheets/HistoryWorkbench.test.tsx`

**Interfaces:**
- Consumes: `state.filters`, existing filter validation/apply/reset functions, and `onFiltersChange`.
- Produces: exported pure `describeHistoryFilters(filters): string` and an `aria-expanded` disclosure whose draft excludes editable `layerKey`.
- Invariant: invalid drafts never call `onFiltersChange` and never remove currently rendered rows.

- [ ] **Step 1: Write filter-summary and disclosure tests**

Add tests equivalent to:

```ts
expect(describeHistoryFilters(createHistoryWorkbenchState().filters)).toBe(
  '전체 변경 · 전체 작업자',
)
expect(
  describeHistoryFilters(
    createHistoryWorkbenchState({
      actor: '김민수',
      origin: 'manual',
      eventTypes: ['cell_update', 'por_change'],
    }).filters,
  ),
).toBe('직접 입력 · 변경 유형 2개 · 김민수')

const html = render(buildTimelineState())
expect(html).toContain('aria-expanded="false"')
expect(html).toContain('전체 변경 · 전체 작업자')
expect(html).not.toContain('>Layer<')
```

Use an interactive Testing Library test to click `필터`, verify the form appears, submit an invalid source project, and assert existing history summaries remain in the DOM.

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
cd frontend
npm test -- --run src/features/sheets/HistoryWorkbench.test.tsx
```

Expected: FAIL because the form is always open and the summary helper is absent.

- [ ] **Step 3: Implement the collapsed filter disclosure**

Add local `filtersExpanded` state, a stable form id, and a button shaped as:

```tsx
<button
  aria-controls="history-filter-panel"
  aria-expanded={filtersExpanded}
  onClick={() => setFiltersExpanded((open) => !open)}
  type="button"
>
  <span>{describeHistoryFilters(state.filters)}</span>
  <span aria-hidden="true">{filtersExpanded ? '접기' : '필터'}</span>
</button>
```

Render the existing form only when expanded. Remove the editable Layer input and force the current authoritative Layer into applied/reset filters:

```ts
const layerKey = state.filters.layerKey
onFiltersChange?.({ ...nextFilters, layerKey })
```

Reset clears user filters but retains `layerKey`. Use Korean labels (`작업자`, `입력 방식`, `Source project`, `변경 유형`, `적용`, `초기화`) without changing API enum values.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
cd frontend
npm test -- --run src/features/sheets/HistoryWorkbench.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add \
  frontend/src/features/sheets/HistoryWorkbench.tsx \
  frontend/src/features/sheets/HistoryWorkbench.test.tsx
git commit -m "feat: collapse history ledger filters"
```

---

### Task 3: Render the continuous revision ledger

**Files:**
- Modify: `frontend/src/features/sheets/HistoryWorkbench.tsx`
- Modify: `frontend/src/features/sheets/HistoryWorkbench.test.tsx`

**Interfaces:**
- Consumes: existing timeline, cell-history, batch-detail DTOs and callbacks; Task 1 scope callback; Task 2 filter disclosure.
- Produces: `currentLayerLabel`, `selectedCellAvailable`, and `onScopeChange` props; unified scope header and ruled ledger rows.
- Invariant: timeline rows show only summary metadata; only cell and batch-detail DTOs render old/new values.

- [ ] **Step 1: Write semantic ledger tests**

Cover these contracts with static and interactive rendering:

```ts
expect(html).toContain('LAYER 030 · CMP')
expect(html).toContain('현재 Layer')
expect(html).toContain('현재 셀만')
expect(html).toContain('role="radiogroup"')
expect(html).toContain('18건')
expect(html).toContain('event-1')
expect(html).not.toContain('OLD → NEW') // timeline DTO has no diff authority
```

For cell history and expanded detail:

```ts
expect(cellHtml).toContain('OLD')
expect(cellHtml).toContain('NEW')
expect(cellHtml).toContain('이전 값')
expect(cellHtml).toContain('변경 값')
expect(batchHtml).toContain('2개 변경 펼치기')
expect(batchHtml).toContain('aria-expanded="true"')
```

Assert an ordinary ledger row has no navigation handler and clicking the explicit `셀로 이동` button calls `onActivateTarget` exactly once. Assert deleted targets render their history, disable movement, and show the adjacent reason.

- [ ] **Step 2: Run the component tests and verify RED**

Run:

```bash
cd frontend
npm test -- --run src/features/sheets/HistoryWorkbench.test.tsx
```

Expected: FAIL against the old card layout and timeline/cell mode buttons.

- [ ] **Step 3: Add the scope header and Layer context**

Change props to:

```ts
currentLayerLabel: string
selectedCellAvailable: boolean
onScopeChange?: (mode: HistoryWorkbenchMode) => boolean
```

Render a fixed hierarchy:

```tsx
<header>
  <p className="font-mono text-[10px] uppercase tracking-[0.08em]">
    {currentLayerLabel}
  </p>
  <div>
    <h3>변경 이력</h3>
    <span>{activeItemCount}건</span>
  </div>
</header>

<div aria-label="이력 범위" role="radiogroup">
  <button aria-checked={state.mode === 'timeline'} role="radio">현재 Layer</button>
  <button
    aria-checked={state.mode === 'cell'}
    aria-describedby={!selectedCellAvailable ? 'history-cell-scope-help' : undefined}
    disabled={!selectedCellAvailable}
    role="radio"
  >현재 셀만</button>
</div>
```

Keep the unavailable help text in the DOM for the described-by target. Failed cell-scope activation announces one concise status and leaves Layer scope active.

- [ ] **Step 4: Replace card stacks with ruled ledger rows**

Use flat list markup (`ol`/`li` or articles separated by borders) and preserve all existing metadata. Do not add a new component hierarchy solely for styling.

Timeline row:

```tsx
<article className="border-b border-border-subtle py-3" data-history-item>
  <p className="font-mono text-[10px] text-muted">{item.started_at} · {actorLabel}</p>
  <h4 className="mt-1 text-sm font-semibold">{item.summary}</h4>
  <p className="mt-1 text-xs text-muted">{coordinateAndOrigin}</p>
  {availableTarget ? <button type="button">셀로 이동</button> : deletedCopy}
</article>
```

Do not parse `summary` or synthesize a diff. Replace raw enum presentation with the existing label mapper where one exists.

- [ ] **Step 5: Render authoritative value comparisons for cell and batch detail**

Use explicit labels and null copy:

```tsx
<dl className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2">
  <div><dt>이전 값</dt><dd>{oldCode ?? '없음'}</dd></div>
  <span aria-hidden="true">→</span>
  <div><dt>변경 값</dt><dd>{newCode ?? '없음'}</dd></div>
</dl>
```

When a Choice label exists, display it without discarding the code. Keep `getHistoryDetailItemKey(entry)` as the unique detail key. A batch disclosure uses `aria-expanded`, `aria-controls`, and `N개 변경 펼치기/접기`.

- [ ] **Step 6: Preserve successful content in every async state**

Retain existing rows while showing next-page or detail errors locally. Replace generic empty/loading text with scoped copy:

```ts
state.mode === 'timeline'
  ? '현재 Layer에 기록된 변경이 없습니다.'
  : '선택한 셀에 기록된 변경이 없습니다.'
```

Initial errors use `문제 + 영향 + 다음 행동`; do not mount duplicate live messages. Legacy coverage is one subdued status below the scope header, not a full-panel warning surface.

- [ ] **Step 7: Run focused tests, typecheck, and accessibility source guards**

Run:

```bash
cd frontend
npm test -- --run src/features/sheets/HistoryWorkbench.test.tsx
npm run typecheck
```

Expected: PASS; no duplicate `role="status"` for the same navigation message, no responsive multi-column classes based on the page viewport inside the fixed inspector, and no repeated rounded history cards.

- [ ] **Step 8: Commit Task 3**

```bash
git add \
  frontend/src/features/sheets/HistoryWorkbench.tsx \
  frontend/src/features/sheets/HistoryWorkbench.test.tsx
git commit -m "feat: render continuous history ledger"
```

---

### Task 4: Integrate selected-cell scope without automatic context loss

**Files:**
- Modify: `frontend/src/features/sheets/SheetView.tsx`
- Modify: `frontend/src/features/sheets/SheetView.test.tsx`
- Modify: `frontend/src/features/sheets/useHistoryWorkbenchController.ts`
- Modify: `frontend/src/features/sheets/useHistoryWorkbenchController.test.ts`

**Interfaces:**
- Consumes: Task 1 controller callbacks, `selectedCell`, `activeLayerKey`, Layer metadata, and existing `activateHistoryJumpTarget`.
- Produces: current Layer label and selected-cell availability for `HistoryWorkbench`; synchronized cell scope only while the user has explicitly chosen `현재 셀만`.
- Invariant: ordinary grid cell selection never opens the history panel and never changes Layer scope to cell scope.

- [ ] **Step 1: Write SheetView integration tests**

Add tests proving:

```ts
expect(historyProps.currentLayerLabel).toBe('LAYER 030 · CMP')
expect(historyProps.selectedCellAvailable).toBe(false)
```

After ordinary `onCellActivate(payload)`:

```ts
expect(mockHistoryController.onSelectedCellChange).toHaveBeenCalledWith(payload)
expect(mockHistoryController.onScopeChange).not.toHaveBeenCalled()
expect(mockWorkbenchState.selectMode).not.toHaveBeenCalled()
```

After the existing explicit grid `onCellHistoryRequest(payload)`:

```ts
expect(mockHistoryController.onSelectedCellChange).toHaveBeenCalledWith(payload)
expect(mockHistoryController.onScopeChange).toHaveBeenCalledWith('cell')
expect(mockWorkbenchState.selectMode).toHaveBeenCalledWith('history')
```

When Layer changes, assert `onLayerScopeChange(activeLayerKey)` is called once and actor/date/type filters are not reconstructed in `SheetView`.

- [ ] **Step 2: Run SheetView tests and verify RED**

Run:

```bash
cd frontend
npm test -- --run src/features/sheets/SheetView.test.tsx
```

Expected: FAIL because current Layer and selected-cell props/callbacks are not wired.

- [ ] **Step 3: Replace the broad Layer filter effect with the controller boundary**

Replace the effect that spreads `historyWorkbench.state.filters` with:

```ts
useEffect(() => {
  if (workbenchState.mode !== 'history' || activeLayerKey === '') return
  historyWorkbench.onLayerScopeChange(activeLayerKey)
}, [activeLayerKey, historyWorkbench.onLayerScopeChange, workbenchState.mode])
```

The callback itself must no-op when the Layer is already current so this effect cannot refetch in a loop.

- [ ] **Step 4: Synchronize grid selection without implicit mode changes**

Update `onCellActivate`:

```ts
onCellActivate: (payload) => {
  setActiveLayerKey(payload.layerKey)
  setSelectedCell(payload)
  historyWorkbench.onSelectedCellChange(payload)
},
```

Update explicit history request:

```ts
onCellHistoryRequest: (payload) => {
  if (!historyWorkbench.onSelectedCellChange(payload)) return
  if (!historyWorkbench.onScopeChange('cell')) return
  workbenchState.selectMode('history')
},
```

If cell scope is already active, selecting a different valid cell refreshes the cell-history query through the remembered scope; it must not remount the outer evidence panel.

- [ ] **Step 5: Pass stable presentation props**

Derive the current Layer label from existing Layer data; do not parse it from display copy. Pass:

```tsx
<HistoryWorkbench
  currentLayerLabel={activeLayerPresentationLabel}
  selectedCellAvailable={historyWorkbench.state.cellScope !== null}
  onScopeChange={historyWorkbench.onScopeChange}
  {...existingHistoryProps}
/>
```

Keep `activateHistoryJumpTarget` as the only movement path. Do not add a row click handler or second `scrollToCell` path.

- [ ] **Step 6: Remove compatibility API and run combined tests**

After every caller uses the new callbacks, remove `onCellHistoryRequest` from `HistoryWorkbenchController`. Update mocks and assert there is one explicit history-request path.

Run:

```bash
cd frontend
npm test -- --run \
  src/features/sheets/historyWorkbenchState.test.ts \
  src/features/sheets/useHistoryWorkbenchController.test.ts \
  src/features/sheets/HistoryWorkbench.test.tsx \
  src/features/sheets/SheetView.test.tsx
npm run typecheck
```

Expected: all focused tests PASS and typecheck exits 0.

- [ ] **Step 7: Commit Task 4**

```bash
git add \
  frontend/src/features/sheets/SheetView.tsx \
  frontend/src/features/sheets/SheetView.test.tsx \
  frontend/src/features/sheets/useHistoryWorkbenchController.ts \
  frontend/src/features/sheets/useHistoryWorkbenchController.test.ts
git commit -m "feat: connect history scope to sheet context"
```

---

### Task 5: Verify the finished history workbench as one bounded visual pass

**Files:**
- Create: `docs/evidence/signal-grid-history-workbench/history_workbench_browser_qa.mjs`
- Create: `docs/evidence/signal-grid-history-workbench/results.json`
- Create: `docs/evidence/signal-grid-history-workbench/README.md`
- Create: `docs/evidence/signal-grid-history-workbench/screenshots/history-1024x768.png`
- Create: `docs/evidence/signal-grid-history-workbench/screenshots/history-1440x900.png`
- Create: `docs/evidence/signal-grid-history-workbench/screenshots/history-1920x1080.png`
- Modify only if verification exposes a bounded defect: the production/test files from Tasks 1–4.

**Interfaces:**
- Consumes: finished worktree, existing deterministic browser-fixture conventions, local Playwright/Chromium cache, and Signal Grid design rules.
- Produces: reproducible evidence for scope, filters, ledger, navigation, failures, accessibility, and three viewport sizes.
- Invariant: run the Impeccable detector exactly once after UI changes are complete; use at most one batched visual correction and one confirmation run.

- [ ] **Step 1: Run all automated gates from fresh product source**

Run:

```bash
cd frontend
npm test -- --run \
  src/features/sheets/historyWorkbenchState.test.ts \
  src/features/sheets/useHistoryWorkbenchController.test.ts \
  src/features/sheets/HistoryWorkbench.test.tsx \
  src/features/sheets/SheetView.test.tsx
npm run typecheck
npm run lint
npm test -- --run
npm run build
cd ..
git diff --check
```

Expected: every command exits 0. Record exact test counts and known build advisories in the evidence README.

- [ ] **Step 2: Run the Impeccable detector exactly once**

Run once, after all Tasks 1–4 UI edits:

```bash
node /home/appuser/.codex/skills/impeccable/scripts/detect.mjs --json \
  frontend/src/features/sheets/HistoryWorkbench.tsx \
  frontend/src/features/sheets/HistoryWorkbench.test.tsx \
  frontend/src/features/sheets/SheetView.tsx \
  frontend/src/features/sheets/SheetView.test.tsx
```

Record the raw JSON result. Do not rerun the detector after this command.

- [ ] **Step 3: Create a deterministic browser fixture**

Follow the existing evidence fixtures and provide in-memory responses for timeline, cell history, batch detail, Layer changes, deletion, legacy coverage, and failures. Assert:

```js
assert.equal(defaultScope, '현재 Layer')
assert.equal(filterPanelInitiallyHidden, true)
assert.equal(ordinaryRowClickScrollCalls, 0)
assert.equal(explicitMoveScrollCalls, 1)
assert.equal(timelineInventedDiffCount, 0)
assert.equal(cellDiffText, '48.0 → 50.0')
assert.equal(batchDetailFetchCount, 1)
assert.equal(documentOverflowPx, 0)
assert.equal(unexpectedConsole.length, 0)
assert.equal(pageErrors.length, 0)
```

Also exercise filter validation with rows preserved, next-page failure/retry, batch-detail failure/retry, a deleted target, Layer switch with user filters retained, and current-cell scope disabled/enabled states.

- [ ] **Step 4: Capture and inspect all three target viewports once**

Run one fixture process that captures 1024×768, 1440×900, and 1920×1080 screenshots with inspector widths 320px and 520px represented. Inspect the three final PNGs together at original resolution for:

- continuous ruled ledger rather than repeated cards;
- readable Layer scope, timestamps, actors, values, and action labels;
- no clipped long code/value/actor text;
- no panel/document overflow;
- visible keyboard focus and selected scope without color-only dependence;
- no overlap with the resize separator or Glide grid.

- [ ] **Step 5: Apply at most one bounded correction batch**

If the first visual inspection finds defects, write regression tests first, fix all observed defects in one production batch, rerun affected focused tests plus full frontend tests/build, and perform one confirmation fixture run. Do not rerun the Impeccable detector.

- [ ] **Step 6: Write evidence and commit verification**

The README must contain exact commands, environment/cache assumptions, assertion counts, API call counts, console/page-error results, screenshot dimensions/hashes, detector invocation/result, and any bounded correction. Then run:

```bash
git diff --check
git status --short
git add docs/evidence/signal-grid-history-workbench
git commit -m "test: verify Signal Grid history workbench"
```

- [ ] **Step 7: Final branch review gate**

Review `main..HEAD` for scope, API authority, accessibility, accidental row navigation, stale query authority, duplicate state, and unrelated files. Re-run only the smallest command needed for a review-found code change, followed by the full affected gate before completion.

---

## Completion Checklist

- [ ] Current Layer is the default ledger scope.
- [ ] Current-cell scope is explicit and unavailable without a selected cell.
- [ ] Layer changes preserve user filters and return to Layer scope.
- [ ] Timeline summaries do not invent old/new values.
- [ ] Cell and batch details show exact authoritative diffs.
- [ ] Filters are collapsed by default and retain the current Layer authority.
- [ ] Row browsing never moves the grid; explicit controls do.
- [ ] Existing data survives local pagination/detail/filter failures.
- [ ] Keyboard, live-region, disclosure, and non-color state contracts pass.
- [ ] 320–520px inspector and 1024/1440/1920 viewport evidence passes.
- [ ] Focused/full tests, typecheck, lint, build, and diff-check pass.
- [ ] Impeccable detector ran exactly once and its raw result is recorded.
