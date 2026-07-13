# Sheet Interaction UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make staged paste values and actions visible, make condition-row operations discoverable, and open choice editors on the first click while preserving native Ctrl+C range copy.

**Architecture:** Keep the existing `SheetView` orchestration, Glide adapter boundary, paste staging model, and session write queue. Add one pure staging-value selector to the grid model, one per-cell Glide activation override for choice cells, and only reorder/clarify existing controls in `SheetView`; no backend or persistence contract changes.

**Tech Stack:** React 18, TypeScript 5.7, Glide Data Grid 6, Vitest 4, Tailwind CSS 4

## Global Constraints

- Paste remains an explicit **preview → apply/cancel** flow.
- Applying paste continues through the existing session write queue with `origin=paste`.
- Ctrl+C remains keyboard-only; do not add a copy button.
- Do not change text/number cell activation behavior.
- Do not add external dependencies, context menus, bulk row management, or custom clipboard formats.

---

### Task 1: Render staged values inside target cells

**Files:**
- Modify: `frontend/src/grid/model.ts`
- Modify: `frontend/src/grid/model.test.ts`
- Modify: `frontend/src/grid/GlideConditionGrid.tsx`

**Interfaces:**
- Consumes: `PasteStagingCell | undefined` from the existing `stagingIndex`.
- Produces: `previewCellValue(serverValue, staging): string | null`, used only while constructing Glide parameter cells.

- [ ] **Step 1: Write failing model tests**

Add `previewCellValue` to the import list and add:

```ts
describe('previewCellValue', () => {
  it('shows the staged value without mutating the server value', () => {
    const staging = {
      conditionId: '1',
      parameterCode: 'exposure',
      value: '42',
      valid: true,
    }
    expect(previewCellValue('25', staging)).toBe('42')
    expect(staging.value).toBe('42')
  })

  it('shows invalid and cleared staged values, and falls back when staging is absent', () => {
    expect(
      previewCellValue('25', {
        conditionId: '1',
        parameterCode: 'exposure',
        value: 'abc',
        valid: false,
      }),
    ).toBe('abc')
    expect(
      previewCellValue('25', {
        conditionId: '1',
        parameterCode: 'exposure',
        value: null,
        valid: true,
      }),
    ).toBeNull()
    expect(previewCellValue('25', undefined)).toBe('25')
  })
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
cd frontend
npx vitest run src/grid/model.test.ts
```

Expected: FAIL because `previewCellValue` is not exported.

- [ ] **Step 3: Implement the minimal pure selector**

Add to `model.ts`:

```ts
/** 서버 확정 값 위에 붙여넣기 스테이징 값을 미리보기한다. */
export function previewCellValue(
  serverValue: string | null,
  staging: PasteStagingCell | undefined,
): string | null {
  return staging === undefined ? serverValue : staging.value
}
```

In `GlideConditionGrid.tsx`, replace the direct `raw` lookup with:

```ts
const serverValue = rowData.values[column.key] ?? null
const staging = stagingIndex.get(overlayKey(rowData.id, column.key))
const raw = previewCellValue(serverValue, staging)
const overlay = overlayTheme(
  statusIndex.get(overlayKey(rowData.id, column.key)),
  staging,
)
```

Import `previewCellValue` from `./model`. Keep the existing green/red `themeOverride`; do not write the preview into `rowData`, React Query, or Zustand.

- [ ] **Step 4: Run focused and paste regression tests**

Run:

```bash
npx vitest run src/grid/model.test.ts src/features/sheets/pasteStaging.test.ts
```

Expected: both files PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/grid/model.ts frontend/src/grid/model.test.ts frontend/src/grid/GlideConditionGrid.tsx
git commit -m "Show staged paste values before persistence" \
  -m "Constraint: Preview must not mutate server or dirty state" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: Grid model and paste staging unit tests"
```

---

### Task 2: Open choice editors on the first click

**Files:**
- Create: `frontend/src/grid/choiceCell.test.ts`
- Modify: `frontend/src/grid/choiceCell.tsx`

**Interfaces:**
- Consumes: existing `makeChoiceCell(value, options, readOnly, themeOverride)` calls.
- Produces: the same `ChoiceCell`, with `activationBehaviorOverride: 'single-click'` only when it is editable.

- [ ] **Step 1: Write the failing choice-cell test**

Create `choiceCell.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { makeChoiceCell } from './choiceCell'

describe('makeChoiceCell', () => {
  it('opens an editable choice on the first click', () => {
    const cell = makeChoiceCell('pos', ['pos', 'neg'], false)
    expect(cell.activationBehaviorOverride).toBe('single-click')
    expect(cell.readonly).toBe(false)
  })

  it('does not advertise activation for a readonly choice', () => {
    const cell = makeChoiceCell('pos', ['pos', 'neg'], true)
    expect(cell.activationBehaviorOverride).toBeUndefined()
    expect(cell.readonly).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
cd frontend
npx vitest run src/grid/choiceCell.test.ts
```

Expected: FAIL because editable choice cells have no activation override.

- [ ] **Step 3: Add the per-cell activation override**

In `makeChoiceCell`, add only this property:

```ts
activationBehaviorOverride: readOnly ? undefined : 'single-click',
```

Do not set DataEditor-wide `cellActivationBehavior`; text and number cells must retain their current behavior.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx vitest run src/grid/choiceCell.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/grid/choiceCell.tsx frontend/src/grid/choiceCell.test.ts
git commit -m "Open choice lists without repeated cell activation" \
  -m "Constraint: Text and number editing behavior must remain unchanged" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: Choice cell factory unit tests"
```

---

### Task 3: Put paste and condition actions where operators can find them

**Files:**
- Modify: `frontend/src/features/sheets/SheetView.tsx`

**Interfaces:**
- Consumes: existing `PasteStagingPanel`, `ConditionRowManager`, `paste`, `readOnly`, and condition callbacks.
- Produces: unchanged callbacks and persistence behavior; only pre-grid layout and guidance text change.

- [ ] **Step 1: Establish the current layout failure**

With the local stack running, paste one cell and record that `data-testid="paste-staging-panel"` appears after `data-testid="sheet-view-grid"` in the current DOM. Select no condition row and record that the condition instructions are also below the 70vh grid.

Expected: the actions require scrolling below the grid, matching the reported failure.

- [ ] **Step 2: Move existing controls above the grid**

In `SheetEditor` JSX, render the existing blocks after category/search controls and before `sheet-view-grid`, in this order:

```tsx
{paste !== null ? (
  <PasteStagingPanel
    result={paste}
    columns={data.columns}
    rows={data.rows}
    applying={applying}
    readOnly={readOnly}
    error={pasteError}
    onApply={commitPaste}
    onCancel={cancelPaste}
  />
) : null}
{!readOnly ? (
  <ConditionRowManager
    activeLabel={activeRowLabel}
    busy={structBusy}
    error={structError}
    onAddEmpty={handleAddEmpty}
    onDuplicate={handleDuplicate}
    onDelete={handleDelete}
    onClear={clearActive}
  />
) : null}
<p className="text-xs text-slate-500" data-testid="sheet-interaction-guide">
  범위 복사 Ctrl+C · 붙여넣기 Ctrl+V · 조건 행은 왼쪽 Layer/조건 셀 선택 · POR는 빈 원(○) 클릭
</p>
```

Delete the old post-grid copies of `ConditionRowManager` and `PasteStagingPanel`. Update their comments from “하단” to “상단”. Do not duplicate any state or callbacks.

- [ ] **Step 3: Run static verification**

Run:

```bash
cd frontend
npm run typecheck
npm run build
```

Expected: both commands PASS with no new TypeScript or Vite errors.

- [ ] **Step 4: Verify the interaction order in the browser**

At `http://localhost:5173/projects/1/sheet`:

1. Confirm the condition toolbar and keyboard guide are visible without scrolling below the grid.
2. Paste `42` into a number cell and confirm `42` appears in the green cell while the action panel is visible above the grid.
3. Click `취소` and confirm the prior server value returns.
4. Paste again, click `적용`, wait for `저장됨`, reload, and confirm `42` persists.
5. Click a left Layer/조건 cell, confirm the selected label appears, then exercise duplicate and delete.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/sheets/SheetView.tsx
git commit -m "Expose paste and condition actions before the grid" \
  -m "Rejected: Duplicate copy button | operators use Ctrl+C" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: Frontend typecheck, build, and browser interaction flow"
```

---

### Task 4: Full regression and copy/paste browser QA

**Files:**
- Modify only if verification finds a regression; return to the owning task and add a failing test before changing production code.

**Interfaces:**
- Consumes: final outputs of Tasks 1–3.
- Produces: merge-ready verification evidence; no new feature surface.

- [ ] **Step 1: Run the complete frontend gate**

Run:

```bash
cd frontend
npm run typecheck
npm test
npm run build
```

Expected: typecheck/build PASS and all Vitest files PASS.

- [ ] **Step 2: Verify native Ctrl+C without a new button**

In the local browser:

1. Drag-select a 2×2 parameter-cell range and press Ctrl+C.
2. Select another 2×2 destination and press Ctrl+V.
3. Confirm the copied values appear as staged previews and the pre-grid action panel reports four cells.
4. Apply, wait for `저장됨`, reload, and confirm the four values persist.
5. Repeat once with Excel as source using a 10×20 range, including an empty cell and an invalid number/choice.

- [ ] **Step 3: Verify choice and condition discoverability**

In the same browser session:

1. Click an editable choice cell once and confirm the select overlay opens.
2. Select an option and confirm autosave persists it after reload.
3. Confirm Layer/조건 selection exposes add/duplicate/delete targets above the grid.
4. Confirm clicking an empty POR circle transfers POR and refreshes the row markers.

- [ ] **Step 4: Check the final diff and working tree**

Run:

```bash
git diff --check
git status --short
git log --oneline -5
```

Expected: no whitespace errors; only intentional commits; clean working tree after Task 3 commit.

- [ ] **Step 5: Push and confirm PR CI**

```bash
git push origin claude/phase-2-planning-fsg6w3
gh pr checks 72 --watch --interval 10
```

Expected: Backend and Frontend CI both PASS.
