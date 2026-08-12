# PCM Drafting Table Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop condition-sheet surface with the approved Drafting Table composition: a persistent one-click virtualized Layer Navigator, a Layer-scoped grid, and a right-side evidence inspector with no bottom revision rail.

**Architecture:** Keep `SheetView.tsx` as the workflow coordinator, but extract Layer navigation state and rendering into focused modules. Change `SheetFocusFrame` from a vertical grid/workbench stack to a horizontal navigator/grid/inspector shell. Reuse the existing validation, history, backbone-diff controllers and Glide grid; only their layout and default history scope change.

**Tech Stack:** React 18, TypeScript 5.7, Tailwind CSS 4, Glide Data Grid, TanStack Query, Vitest, Testing Library server rendering.

## Global Constraints

- Desktop web only; minimum supported viewport 1024px, primary target 1440px and above.
- No external fonts, runtime CDN, new network dependency, or new npm package.
- Preserve existing routes, API contracts, Glide virtualization, editing, lock, paste, autosave, validation, history, and backbone-diff behavior.
- Meet WCAG 2.2 AA and preserve keyboard access, visible focus, live status, and non-color state cues.
- Preserve the user's existing uncommitted `frontend/vite.config.ts` change.
- Approved comp: `.impeccable/mocks/drafting-table/option-2c-layer-navigator-no-rail.png`.
- No bottom revision ruler or cross-Layer global timeline.

---

## File Map

- Create `frontend/src/features/sheets/layerNavigatorState.ts`: pure filtering, recent-Layer, active-index, and keyboard navigation rules.
- Create `frontend/src/features/sheets/layerNavigatorState.test.ts`: 100-Layer state and navigation tests.
- Create `frontend/src/features/sheets/LayerNavigator.tsx`: accessible virtualized Layer list and collapse/search UI.
- Create `frontend/src/features/sheets/LayerNavigator.test.tsx`: rendered semantics, selection, and interaction tests.
- Modify `frontend/src/features/sheets/SheetFocusFrame.tsx`: horizontal Drafting Table geometry.
- Modify `frontend/src/features/sheets/SheetFocusFrame.test.tsx`: navigator/grid/inspector geometry contract.
- Modify `frontend/src/features/sheets/SheetWorkbench.tsx`: right-side inspector host and width persistence; remove height resizing.
- Modify `frontend/src/features/sheets/SheetWorkbench.test.tsx`: inspector tabs, width/collapse semantics, and absence of bottom rail.
- Modify `frontend/src/features/sheets/SheetWorkbenchNavigation.tsx`: compact vertical/segmented inspector navigation.
- Modify `frontend/src/features/sheets/SheetView.tsx`: selected Layer state, scoped rows, navigator integration, and current-Layer history scope.
- Modify `frontend/src/features/sheets/SheetView.test.tsx`: integrated Layer selection, grid scope, and evidence flow.
- Modify `frontend/src/features/sheets/HistoryWorkbench.tsx`: current-Layer default scope and `현재 셀만` affordance.
- Modify `frontend/src/features/sheets/HistoryWorkbench.test.tsx`: Layer scope and cell-only filtering tests.
- Modify `frontend/src/features/sheets/ValidationWorkbench.tsx`: inspector-density issue list.
- Modify `frontend/src/features/sheets/ValidationWorkbench.test.tsx`: selected issue and cell-jump affordance tests.
- Modify `frontend/src/features/sheets/sheetWorkbenchStorage.ts`: persist collapsed state and inspector width instead of bottom height.
- Modify `frontend/src/features/sheets/sheetWorkbenchStorage.test.ts`: storage migration and clamping tests.
- Modify `frontend/src/styles.css`: Drafting Table semantic tokens and component state utilities.
- Modify `frontend/src/shared/designTokens.test.ts`: token presence and prohibited-color checks.

### Task 1: Drafting Table tokens and focus-shell geometry

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/shared/designTokens.test.ts`
- Modify: `frontend/src/features/sheets/SheetFocusFrame.tsx`
- Modify: `frontend/src/features/sheets/SheetFocusFrame.test.tsx`

**Interfaces:**
- Produces semantic tokens `draft-canvas`, `draft-ink`, `draft-teal`, `draft-amber`, `draft-rule`, and state tokens consumed by later tasks.
- Produces `SheetFocusFrameProps` with `navigator?: ReactNode`, `inspector?: ReactNode`, `navigatorCollapsed: boolean`, and `inspectorOpen: boolean`.

- [ ] **Step 1: Write failing token and geometry tests**

Add assertions that the CSS source contains the approved palette and that `SheetFocusFrame` renders `data-sheet-layer-navigator`, `data-sheet-grid-host`, and `data-sheet-evidence-inspector` in one horizontal `minmax(0,1fr)` work row. Assert that no `data-sheet-workbench` bottom row is emitted.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cd frontend && npm test -- src/shared/designTokens.test.ts src/features/sheets/SheetFocusFrame.test.tsx`

Expected: FAIL because Drafting Table tokens and horizontal regions do not exist.

- [ ] **Step 3: Implement semantic tokens and horizontal shell**

Use the approved colors as raw tokens and map existing semantic roles to them. Keep status colors AA-safe. Change the frame to `40px auto minmax(0,1fr)` rows, with the last row containing navigator, grid, and inspector columns. Do not add a fourth bottom row.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `cd frontend && npm test -- src/shared/designTokens.test.ts src/features/sheets/SheetFocusFrame.test.tsx`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles.css frontend/src/shared/designTokens.test.ts frontend/src/features/sheets/SheetFocusFrame.tsx frontend/src/features/sheets/SheetFocusFrame.test.tsx
git commit -m "feat: establish drafting table sheet shell"
```

### Task 2: Layer Navigator state engine

**Files:**
- Create: `frontend/src/features/sheets/layerNavigatorState.ts`
- Create: `frontend/src/features/sheets/layerNavigatorState.test.ts`

**Interfaces:**
- Consumes: `readonly ProjectLayerOut[]`, current key, query, and recent keys.
- Produces:

```ts
export interface LayerNavigatorItem {
  key: string
  number: string
  label: string
  searchText: string
  sortOrder: number
  errorCount: number
  dirty: boolean
}

export function buildLayerNavigatorItems(
  layers: readonly ProjectLayerOut[],
  issueCounts: ReadonlyMap<string, number>,
  dirtyLayerKeys: ReadonlySet<string>,
): readonly LayerNavigatorItem[]

export function filterLayerNavigatorItems(
  items: readonly LayerNavigatorItem[],
  query: string,
): readonly LayerNavigatorItem[]

export function updateRecentLayerKeys(
  current: readonly string[],
  activatedKey: string,
  limit?: number,
): readonly string[]

export function resolveLayerNavigatorIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null
```

- [ ] **Step 1: Write failing pure-state tests**

Cover 100 sorted layers, Korean/name/key search, exact numbering `01`–`100`, issue/dirty decoration, recent-list de-duplication limited to three, and ArrowUp/ArrowDown/Home/End boundaries.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd frontend && npm test -- src/features/sheets/layerNavigatorState.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal pure functions**

Keep all functions deterministic and avoid React or DOM dependencies. Derive display label from `layer_id`, `step_seq`, and `eqp_type_desc` without changing stored `layer_key`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd frontend && npm test -- src/features/sheets/layerNavigatorState.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/sheets/layerNavigatorState.ts frontend/src/features/sheets/layerNavigatorState.test.ts
git commit -m "feat: add layer navigator state model"
```

### Task 3: Accessible virtualized Layer Navigator component

**Files:**
- Create: `frontend/src/features/sheets/LayerNavigator.tsx`
- Create: `frontend/src/features/sheets/LayerNavigator.test.tsx`

**Interfaces:**
- Consumes:

```ts
export interface LayerNavigatorProps {
  items: readonly LayerNavigatorItem[]
  activeLayerKey: string
  recentLayerKeys: readonly string[]
  query: string
  collapsed: boolean
  onQueryChange(query: string): void
  onActivate(layerKey: string): void
  onCollapsedChange(collapsed: boolean): void
}
```

- Produces a 220px navigator using fixed 36px rows and windowed rendering based on scroll position. It exposes `aria-label="Layer 선택"`, `aria-current="true"`, a polite result-count status, visible hover/focus states, and one-click activation.

- [ ] **Step 1: Write failing component tests**

Assert the search label, current Layer semantics, recent section, `100개 Layer` status, one-click callback, keyboard activation, collapse callback, error count text, and that a 100-item input does not render all 100 row buttons simultaneously.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd frontend && npm test -- src/features/sheets/LayerNavigator.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement fixed-row virtualization and interactions**

Use a scroll container, calculated start/end indices, top/bottom spacers, and a small overscan. Do not add a virtualization package. Clicking a row calls `onActivate` directly; no confirmation or dropdown state exists.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd frontend && npm test -- src/features/sheets/LayerNavigator.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/sheets/LayerNavigator.tsx frontend/src/features/sheets/LayerNavigator.test.tsx
git commit -m "feat: add one-click virtualized layer navigator"
```

### Task 4: Scope the grid to the active Layer

**Files:**
- Modify: `frontend/src/features/sheets/SheetView.tsx`
- Modify: `frontend/src/features/sheets/SheetView.test.tsx`

**Interfaces:**
- Consumes `project.layers`, adapted grid rows, validation issues, and dirty cells.
- Produces `activeLayerKey`, `recentLayerKeys`, `layerQuery`, `navigatorCollapsed`, `layerItems`, and `layerRows` state/derived values.
- Calls existing `GlideConditionGrid` with only rows whose `row.layerKey === activeLayerKey`; columns and cell values remain unchanged.

- [ ] **Step 1: Add an integrated failing test fixture with 100 Layers**

Render a sheet with 100 project layers and at least two condition rows per representative Layer. Assert that Layer 03 is initially active, clicking Layer 08 once changes the grid fixture to only Layer 08 rows, and search/recent state remains intact.

- [ ] **Step 2: Run the integrated test and verify RED**

Run: `cd frontend && npm test -- src/features/sheets/SheetView.test.tsx`

Expected: FAIL because SheetView renders no navigator and passes every Layer row to the grid.

- [ ] **Step 3: Integrate LayerNavigator and scoped grid rows**

Default to the first sorted Layer unless a pending coordinate/history/validation jump identifies another Layer. Preserve paste gating: while paste review is active, Layer activation reports `붙여넣기를 적용 또는 취소한 뒤 이동해 주세요.` and does not switch. When a validation/history target lives in another Layer, activate that Layer before scrolling to its cell.

- [ ] **Step 4: Run the integrated test and verify GREEN**

Run: `cd frontend && npm test -- src/features/sheets/SheetView.test.tsx`

Expected: PASS, including existing lock/paste/validation/history tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/sheets/SheetView.tsx frontend/src/features/sheets/SheetView.test.tsx
git commit -m "feat: scope sheet editing by active layer"
```

### Task 5: Replace the bottom workbench with a right evidence inspector

**Files:**
- Modify: `frontend/src/features/sheets/SheetWorkbench.tsx`
- Modify: `frontend/src/features/sheets/SheetWorkbenchNavigation.tsx`
- Modify: `frontend/src/features/sheets/SheetWorkbench.test.tsx`
- Modify: `frontend/src/features/sheets/sheetWorkbenchStorage.ts`
- Modify: `frontend/src/features/sheets/sheetWorkbenchStorage.test.ts`
- Modify: `frontend/src/features/sheets/SheetView.tsx`

**Interfaces:**
- `useSheetWorkbenchState()` returns `mode`, `open`, `close`, `toggle`, `selectMode`, `inspectorWidth`, and `setInspectorWidth`.
- `SheetWorkbenchPanel` becomes `SheetEvidenceInspector` with width clamped to 320–520px, vertical separator semantics, and no height property.
- Existing validation/history/backbone-diff content props remain React nodes and controller behavior stays unchanged.

- [ ] **Step 1: Rewrite tests for right-side semantics**

Assert a vertical resize separator with width values, validation/history/backbone tabs, collapse behavior, persisted width migration, and absence of `panelHeight`, row-resize cursor, and bottom host.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd frontend && npm test -- src/features/sheets/SheetWorkbench.test.tsx src/features/sheets/sheetWorkbenchStorage.test.ts`

Expected: FAIL against the existing bottom-height implementation.

- [ ] **Step 3: Implement right inspector and storage migration**

Rename storage key to a width-specific key and ignore legacy height values. Render the separator on the inspector's left edge. Keep the mode tabs compact and sticky at the top. Wire the inspector into the `inspector` slot of `SheetFocusFrame`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd frontend && npm test -- src/features/sheets/SheetWorkbench.test.tsx src/features/sheets/sheetWorkbenchStorage.test.ts src/features/sheets/SheetView.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/sheets/SheetWorkbench.tsx frontend/src/features/sheets/SheetWorkbenchNavigation.tsx frontend/src/features/sheets/SheetWorkbench.test.tsx frontend/src/features/sheets/sheetWorkbenchStorage.ts frontend/src/features/sheets/sheetWorkbenchStorage.test.ts frontend/src/features/sheets/SheetView.tsx
git commit -m "feat: move sheet evidence into right inspector"
```

### Task 6: Current-Layer history and inspector-density validation

**Files:**
- Modify: `frontend/src/features/sheets/HistoryWorkbench.tsx`
- Modify: `frontend/src/features/sheets/HistoryWorkbench.test.tsx`
- Modify: `frontend/src/features/sheets/ValidationWorkbench.tsx`
- Modify: `frontend/src/features/sheets/ValidationWorkbench.test.tsx`
- Modify: `frontend/src/features/sheets/SheetView.tsx`

**Interfaces:**
- Add `activeLayerKey: string` to `HistoryWorkbenchProps` and apply it to timeline filters by default.
- Preserve history controller APIs; call `onFiltersChange({...filters, layerKey: activeLayerKey})` when the active Layer changes.
- Validation issues passed to the inspector are filtered to `issue.layerKey === activeLayerKey`; aggregate project counts may remain in the tab badge but the list clearly labels its current-Layer scope.

- [ ] **Step 1: Write failing scope and density tests**

Assert current-Layer filter initialization, Layer-change filter update, `현재 셀만` switching to cell history, latest-first copy, compact vertical issue rows, and `셀로 이동` activation.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd frontend && npm test -- src/features/sheets/HistoryWorkbench.test.tsx src/features/sheets/ValidationWorkbench.test.tsx src/features/sheets/SheetView.test.tsx`

Expected: FAIL because history is not Layer-scoped and validation uses a responsive tile grid.

- [ ] **Step 3: Implement scoped evidence UI**

Use a single-column inspector list. Keep issue guidance visible on selection, and never rely on hover. Do not create any global revision visualization.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd frontend && npm test -- src/features/sheets/HistoryWorkbench.test.tsx src/features/sheets/ValidationWorkbench.test.tsx src/features/sheets/SheetView.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/sheets/HistoryWorkbench.tsx frontend/src/features/sheets/HistoryWorkbench.test.tsx frontend/src/features/sheets/ValidationWorkbench.tsx frontend/src/features/sheets/ValidationWorkbench.test.tsx frontend/src/features/sheets/SheetView.tsx
git commit -m "feat: scope sheet evidence to current layer"
```

### Task 7: Drafting Table visual fidelity and interaction polish

**Files:**
- Modify: `frontend/src/features/sheets/SheetView.tsx`
- Modify: `frontend/src/features/sheets/LayerNavigator.tsx`
- Modify: `frontend/src/features/sheets/SheetWorkbench.tsx`
- Modify: `frontend/src/features/sheets/ValidationWorkbench.tsx`
- Modify: `frontend/src/features/sheets/HistoryWorkbench.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- No new behavior. Apply the approved comp's component grammar: 1px rules, 2px focus/selection emphasis, compact control heights, off-white canvas, teal current state, amber revision state, and restrained radius.

- [ ] **Step 1: Load Impeccable craft floor before UI edits**

Read: `/home/appuser/.local/share/orca/codex-runtime-home/home/skills/impeccable/reference/craft-floor.md`

- [ ] **Step 2: Implement comp-faithful styling**

Match `.impeccable/mocks/drafting-table/option-2c-layer-navigator-no-rail.png` at 1586×992. Preserve semantic text and native controls; do not rasterize UI.

- [ ] **Step 3: Run the Impeccable mechanical detector once**

Run:

```bash
node /home/appuser/.local/share/orca/codex-runtime-home/home/skills/impeccable/scripts/detect.mjs --json \
  frontend/src/features/sheets/SheetView.tsx \
  frontend/src/features/sheets/LayerNavigator.tsx \
  frontend/src/features/sheets/SheetWorkbench.tsx \
  frontend/src/features/sheets/ValidationWorkbench.tsx \
  frontend/src/features/sheets/HistoryWorkbench.tsx \
  frontend/src/styles.css
```

Expected: no unresolved mechanical violations. Do not run the detector a second time.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/sheets/SheetView.tsx frontend/src/features/sheets/LayerNavigator.tsx frontend/src/features/sheets/SheetWorkbench.tsx frontend/src/features/sheets/ValidationWorkbench.tsx frontend/src/features/sheets/HistoryWorkbench.tsx frontend/src/styles.css
git commit -m "style: apply drafting table visual system"
```

### Task 8: Full verification and bounded desktop Vision QA

**Files:**
- Create: `.impeccable/review/desktop-1024.png`
- Create: `.impeccable/review/desktop-1440.png`
- Create: `.impeccable/review/desktop-1920.png`
- Modify only files required by the single batched visual-fix pass.

**Interfaces:**
- Verifies hierarchy, spacing, contrast, text readability, desktop layout, hover/click clarity, and natural user flow.

- [ ] **Step 1: Run the complete automated verification suite**

```bash
cd frontend
npm run typecheck
npm test
npm run build
```

Expected: all commands exit 0 with no test failures.

- [ ] **Step 2: Start the local application and capture three desktop widths**

Run the existing backend/frontend development commands. Use the browser tool first and capture the representative sheet route at 1024×768, 1440×900, and 1920×1080 into `.impeccable/review/`.

- [ ] **Step 3: Perform one batched Vision inspection**

Compare each screenshot with the approved comp using `view_image`. Check the seven user criteria and confirm the 100-Layer list, one-click navigation, current-Layer evidence scope, and absence of a bottom rail. Apply all material fixes in one batch.

- [ ] **Step 4: Run one final confirmation round**

Rebuild, recapture the same three sizes, and inspect once more. This is the second and final in-thread visual round.

- [ ] **Step 5: Run Impeccable finish review and record the system**

Spawn `impeccable_finish_reviewer` with the original request, approved comp, three screenshot paths, direction contract, detector result, and craft-floor path. Resolve its material findings within the allowed batch budget. Then spawn `impeccable_documenter` to update `DESIGN.md` and `.impeccable/design.json` from the built implementation.

- [ ] **Step 6: Commit verified implementation artifacts**

```bash
git add frontend/src frontend/package.json DESIGN.md .impeccable/design.json .impeccable/review
git commit -m "feat: deliver drafting table condition workspace"
```

## Plan Self-Review

- Spec coverage: Layer virtualization, one-click movement, search, recent Layers, collapse, Layer-scoped grid, right inspector, no bottom rail, accessibility, and three-width Vision QA each have an owning task.
- Placeholder scan: no TBD/TODO or unspecified implementation step remains.
- Type consistency: `activeLayerKey`, `LayerNavigatorItem`, `LayerNavigatorProps`, and inspector width naming are consistent across tasks.
