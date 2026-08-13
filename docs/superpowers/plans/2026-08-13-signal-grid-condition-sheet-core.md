# Signal Grid Condition Sheet Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the PCM condition sheet as one continuous Layer grid with explicit Step Seq/Layer/condition/POR columns, Layer jump navigation, a `현재만` focus toggle, Layer-specific Backbone context, and a backend-enforced exactly-one-POR rule.

**Architecture:** Keep the existing `SheetView`, Glide adapter, editing hooks, Query cache, and workbench controllers. Add only one small pure viewport-state module, one domain-level Grid jump command, and one focused Backbone context component; do not split or broadly refactor the existing SheetView. Add explicit row identity fields to the Sheet API instead of parsing display strings, and enforce POR integrity in the condition service plus a deterministic data-only migration.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, PostgreSQL, React 18, TypeScript, TanStack Query, Glide Data Grid, Vitest, pytest.

## Global Constraints

- Desktop web only; minimum supported width is 1024px and primary use is 1440px or wider.
- Preserve Glide Data Grid virtualization, keyboard editing, range selection, paste staging, dirty autosave, locks, validation, comments, history, and Backbone diff behavior.
- Do not add external fonts, runtime CDN dependencies, or new network dependencies.
- Fixed columns are exactly `STEP SEQ`, `LAYER`, `조건`, `POR`, followed by one column per Parameter.
- The default view contains every Layer; selecting a Layer jumps to it and does not filter rows.
- Only the `현재만` toggle filters rows to the current Layer, and it exposes `aria-pressed`.
- Each Layer has at least one condition and exactly one POR after migration and after every supported write.
- A condition row has no `is_active` field.
- Keep user copy short, direct Korean and preserve WCAG 2.2 AA keyboard/focus semantics.
- Prefer direct functions and existing hooks over new frameworks, stores, context providers, or generalized abstractions.

---

### Task 1: Make row identity explicit and render the approved fixed columns

**Files:**
- Modify: `backend/app/features/sheets/schema.py`
- Modify: `backend/app/features/sheets/service.py`
- Modify: `backend/tests/features/test_sheets_api.py`
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/grid/types.ts`
- Modify: `frontend/src/features/sheets/sheetAdapter.ts`
- Modify: `frontend/src/features/sheets/sheetAdapter.test.ts`
- Modify: `frontend/src/grid/model.ts`
- Modify: `frontend/src/grid/model.test.ts`
- Modify: `frontend/src/grid/GlideConditionGrid.tsx`
- Modify: `frontend/src/grid/GlideConditionGrid.test.tsx`

**Interfaces:**
- Consumes: existing Sheet row ordering and `SheetLayer.step_seq`, `SheetLayer.layer_id`.
- Produces: `SheetRowOut.step_seq`, `SheetRowOut.layer_id`, `ConditionGridRow.stepSeq`, `ConditionGridRow.layerId`, and `IDENTITY_COLUMNS` with four entries.

- [ ] **Step 1: Write failing backend and adapter contract tests**

In the Sheet API test, assert every returned row includes unparsed identity:

```python
row = response.json()["rows"][0]
assert row["step_seq"] == "010"
assert row["layer_id"] == "ACT"
```

In `sheetAdapter.test.ts`, assert the mapping:

```ts
expect(toConditionGridData(sheet).rows[0]).toMatchObject({
  stepSeq: '010',
  layerId: 'ACT',
  conditionLabel: 'POR',
  isPor: true,
})
```

In `model.test.ts`, replace the three-column expectation with:

```ts
expect(IDENTITY_COLUMNS).toEqual([
  { id: '__step_seq__', title: 'STEP SEQ' },
  { id: '__layer__', title: 'LAYER' },
  { id: '__condition__', title: '조건' },
  { id: '__por__', title: 'POR' },
])
expect(IDENTITY_COLUMN_COUNT).toBe(4)
```

Add a Glide source-contract test that fixed columns are frozen and the POR click branch uses column index 3.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
cd backend && uv run pytest tests/features/test_sheets_api.py -q
cd ../frontend && npm test -- --run src/features/sheets/sheetAdapter.test.ts src/grid/model.test.ts src/grid/GlideConditionGrid.test.tsx
```

Expected: FAIL because the API and Grid row contracts lack the explicit fields and still expose three identity columns.

- [ ] **Step 3: Add the two API fields without parsing on the client**

Extend `SheetRowOut`:

```python
step_seq: str
layer_id: str
```

Populate them directly from the owning `SheetLayer` in the existing Sheet row construction. Mirror them in `SheetRowOut` TypeScript and map them in `toConditionGridRows`:

```ts
stepSeq: row.step_seq,
layerId: row.layer_id,
```

Extend `ConditionGridRow` with required `stepSeq: string` and `layerId: string`. Update fixtures mechanically; do not retain a fallback parser for `layerLabel`.

- [ ] **Step 4: Render four fixed columns**

Change `IDENTITY_COLUMNS` to the four-entry contract above. In `GlideConditionGrid`, render Step Seq and Layer only at `groupMeta.isGroupStart[row]`, condition on every row, and POR at column 3. Parameter lookup remains `col - IDENTITY_COLUMN_COUNT`; `freezeColumns` remains derived from the constant.

Use widths near 84/120/104/64px and retain the existing compact row height, group shading, overlays, editing, copy, and paste behavior. Parameter header units remain available through the existing tooltip/display mechanism; do not create a second header row.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run the commands from Step 2. Expected: all pass with no React warnings.

- [ ] **Step 6: Commit the identity unit**

```bash
git add backend/app/features/sheets backend/tests/features/test_sheets_api.py frontend/src/api/types.ts frontend/src/grid frontend/src/features/sheets/sheetAdapter.ts frontend/src/features/sheets/sheetAdapter.test.ts
git commit -m "feat: expose condition sheet row identity"
```

---

### Task 2: Add a small, pure Layer viewport state boundary

**Files:**
- Create: `frontend/src/features/sheets/layerViewportState.ts`
- Create: `frontend/src/features/sheets/layerViewportState.test.ts`
- Modify: `frontend/src/features/sheets/LayerNavigator.tsx`
- Modify: `frontend/src/features/sheets/LayerNavigator.test.tsx`

**Interfaces:**
- Consumes: `readonly ConditionGridRow[]`, current Layer key, and focus-only boolean.
- Produces: `rowsForLayerViewport(rows, activeLayerKey, currentOnly)`, `firstConditionIdForLayer(rows, layerKey)`, `recoverLayerSelection(rows, orderedLayerKeys, previousLayerKey)`.

- [ ] **Step 1: Write failing pure-state tests**

Cover these exact cases:

```ts
expect(rowsForLayerViewport(rows, 'L2', false)).toEqual(rows)
expect(rowsForLayerViewport(rows, 'L2', true).map((row) => row.layerKey)).toEqual(['L2'])
expect(firstConditionIdForLayer(rows, 'L2')).toBe('3')
expect(recoverLayerSelection(rowsWithoutL2, ['L1', 'L2', 'L3'], 'L2')).toEqual({
  layerKey: 'L3',
  conditionId: '4',
})
expect(recoverLayerSelection([], ['L1', 'L2'], 'L2')).toBeNull()
```

`recoverLayerSelection` receives the original ordered Layer keys explicitly. It locates the previous key in that order, scans later keys first, then earlier keys in reverse, and returns the first key that still has a row. It does not read React state.

Add a navigator render test with `currentOnly={false}`, `onCurrentOnlyChange`, exact visible copy `현재만`, and `aria-pressed="false"`.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
cd frontend && npm test -- --run src/features/sheets/layerViewportState.test.ts src/features/sheets/LayerNavigator.test.tsx
```

Expected: FAIL because the module and toggle props do not exist.

- [ ] **Step 3: Implement only three pure functions**

Use linear array operations; do not add a class or Zustand store:

```ts
export function rowsForLayerViewport(
  rows: readonly ConditionGridRow[],
  activeLayerKey: string,
  currentOnly: boolean,
): readonly ConditionGridRow[] {
  return currentOnly ? rows.filter((row) => row.layerKey === activeLayerKey) : rows
}

export function firstConditionIdForLayer(
  rows: readonly ConditionGridRow[],
  layerKey: string,
): string | null {
  return rows.find((row) => row.layerKey === layerKey)?.id ?? null
}
```

Implement recovery as one deterministic ordered scan with no side effects.

- [ ] **Step 4: Put the toggle in the navigator header**

Add required props:

```ts
currentOnly: boolean
onCurrentOnlyChange(currentOnly: boolean): void
```

Render the rectangular `현재만` button next to the collapse control, with `aria-pressed={currentOnly}` and Signal Grid selected/unselected classes. Keep Layer search, recent items, virtualization, and collapsed rail unchanged.

- [ ] **Step 5: Run focused tests and commit**

Run the Step 2 command, then:

```bash
git add frontend/src/features/sheets/layerViewportState.ts frontend/src/features/sheets/layerViewportState.test.ts frontend/src/features/sheets/LayerNavigator.tsx frontend/src/features/sheets/LayerNavigator.test.tsx
git commit -m "feat: add condition sheet Layer viewport state"
```

---

### Task 3: Change Layer selection from filtering to Grid jump

**Files:**
- Modify: `frontend/src/grid/types.ts`
- Modify: `frontend/src/grid/model.ts`
- Modify: `frontend/src/grid/model.test.ts`
- Modify: `frontend/src/grid/GlideConditionGrid.tsx`
- Modify: `frontend/src/grid/GlideConditionGrid.test.tsx`
- Modify: `frontend/src/features/sheets/SheetView.tsx`
- Modify: `frontend/src/features/sheets/SheetView.test.tsx`

**Interfaces:**
- Consumes: Task 2 viewport functions and current `ConditionGridHandle`.
- Produces: `ConditionGridHandle.scrollToCondition(conditionId: string): void` and continuous/full versus current-only Sheet wiring.

- [ ] **Step 1: Write failing Grid jump and Sheet composition tests**

Add a pure row target helper test:

```ts
expect(conditionRowScrollTarget('3', rows)).toEqual({ col: 0, row: 2 })
expect(conditionRowScrollTarget('missing', rows)).toBeNull()
```

Add a Glide handle source/interaction test proving `scrollToCondition` scrolls vertically, selects the Step Seq cell, and requests Grid focus.

In `SheetView.test.tsx`, assert the composed grid receives all rows by default, `현재만` filters to the active Layer, and activating a Layer calls the new jump command instead of permanently replacing the source data.

- [ ] **Step 2: Run tests and confirm RED**

```bash
cd frontend && npm test -- --run src/grid/model.test.ts src/grid/GlideConditionGrid.test.tsx src/features/sheets/SheetView.test.tsx
```

Expected: FAIL because `scrollToCondition` and current-only state are absent and `gridData.rows` is always filtered.

- [ ] **Step 3: Add the smallest Grid command**

Extend the handle:

```ts
scrollToCondition(conditionId: string): void
```

Implement it using `conditionRowScrollTarget`, `gridRef.current.scrollTo`, the existing controlled selection state, and `requestedFocusRef`. Keep all Glide calls inside `GlideConditionGrid`.

- [ ] **Step 4: Wire continuous rows and current-only into SheetView**

Add one boolean state:

```ts
const [currentLayerOnly, setCurrentLayerOnly] = useState(false)
```

Build `gridData.rows` with `rowsForLayerViewport(displayRows, activeLayerKey, currentLayerOnly)`. On Layer activation:

1. reject movement during paste review using the existing message;
2. set the active Layer and recent list;
3. after the row set commits, call `scrollToCondition(firstConditionId)`;
4. keep current-only enabled if it was already enabled.

On every `onCellActivate` and `onConditionActivate`, set `activeLayerKey` from the callback payload before retaining the existing cell/comment/row-selection behavior. Workbench coordinate jumps must do the same using the target row.

Use a single pending condition ID state or ref to cross the React commit boundary. Do not introduce a reducer or new context.

- [ ] **Step 5: Preserve recovery and paste behavior**

When refetched rows remove the active Layer, use `recoverLayerSelection` and jump once after commit. Switching current-only must not clear dirty cells, paste state, selected comments, or workbench state. A Layer navigation attempt during paste review stays blocked exactly as today.

- [ ] **Step 6: Run focused tests and commit**

Run the Step 2 command, then:

```bash
git add frontend/src/grid frontend/src/features/sheets/SheetView.tsx frontend/src/features/sheets/SheetView.test.tsx
git commit -m "feat: make Layer navigation jump through the full sheet"
```

---

### Task 4: Show the current Layer's Backbone source

**Files:**
- Create: `frontend/src/features/sheets/LayerBackboneContext.tsx`
- Create: `frontend/src/features/sheets/LayerBackboneContext.test.tsx`
- Modify: `frontend/src/features/sheets/SheetView.tsx`
- Modify: `frontend/src/features/sheets/SheetView.test.tsx`

**Interfaces:**
- Consumes: current `ProjectLayerOut`, existing `getProject(sourceProjectId)`, and TanStack Query.
- Produces: `LayerBackboneContext({ layer }: { layer: ProjectLayerOut | null })` with linked, none, loading, and unavailable states.

- [ ] **Step 1: Write failing state tests**

Test these exact visible outcomes:

```ts
// no source IDs
expect(html).toContain('백본 없음')

// loaded source project and source layer
expect(html).toContain('LINE-02 / COATING / A16-CATH-02')
expect(html).toContain('010 / ACT')

// source request error or missing source layer
expect(html).toContain('백본 정보를 불러올 수 없음')
```

Also assert `SheetView` supplies the currently active Layer, not the first project Layer.

- [ ] **Step 2: Run tests and confirm RED**

```bash
cd frontend && npm test -- --run src/features/sheets/LayerBackboneContext.test.tsx src/features/sheets/SheetView.test.tsx
```

- [ ] **Step 3: Implement one cached query component**

Use one conditional query keyed exactly like the existing project query:

```ts
useQuery({
  queryKey: ['project', sourceProjectId],
  queryFn: () => getProject(sourceProjectId),
  enabled: sourceProjectId !== null,
})
```

Find `source_layer_key` in the returned project's `layers`. Render short Korean status copy and no action buttons. Query caching naturally reuses source projects; do not build a manual cache or batch endpoint.

- [ ] **Step 4: Place it above the Grid**

Render the context in the existing Sheet tool/header area, adjacent to the current coordinate—not as a card or modal. It updates from `activeLayerKey` in both full and current-only modes. A source failure must not replace or disable the Grid.

- [ ] **Step 5: Run focused tests and commit**

```bash
cd frontend && npm test -- --run src/features/sheets/LayerBackboneContext.test.tsx src/features/sheets/SheetView.test.tsx
git add frontend/src/features/sheets/LayerBackboneContext.tsx frontend/src/features/sheets/LayerBackboneContext.test.tsx frontend/src/features/sheets/SheetView.tsx frontend/src/features/sheets/SheetView.test.tsx
git commit -m "feat: show Layer Backbone context"
```

---

### Task 5: Enforce exactly one POR and restore focus after row changes

**Files:**
- Create: `backend/alembic/versions/0009_backfill_layer_por.py`
- Create: `backend/tests/migrations/test_layer_por_migration_pg.py`
- Modify: `backend/app/features/conditions/service.py`
- Modify: `backend/tests/features/test_conditions_api.py`
- Modify: `frontend/src/features/sheets/SheetView.tsx`
- Modify: `frontend/src/features/sheets/SheetView.test.tsx`
- Modify: `frontend/src/grid/GlideConditionGrid.tsx`
- Modify: `frontend/src/grid/GlideConditionGrid.test.tsx`

**Interfaces:**
- Consumes: existing condition add/delete/POR endpoints and `runStructuralChange` dirty-flush boundary.
- Produces: migration revision `0009`, server rejection of POR deletion, single-row POR locked presentation, and post-mutation focus restoration.

- [ ] **Step 1: Write failing backend invariant tests**

Add service/API tests:

```python
por_delete = await _delete(client, project_id, por_id, token=token)
assert por_delete.status_code == 422
assert por_delete.json()["message"] == "POR 조건 행은 다른 행에 POR을 지정한 후 삭제할 수 있다"

await _set_por(client, project_id, other_id, token=token)
assert (await _delete(client, project_id, por_id, token=token)).status_code == 204
```

Keep the existing last-row rejection test. Add a PostgreSQL migration test that upgrades from `0008` with one single-row gap and one multi-row gap, then asserts the lowest `condition_index` is POR in each Layer and only one POR exists.

- [ ] **Step 2: Run backend tests and confirm RED**

```bash
cd backend
uv run pytest tests/features/test_conditions_api.py -q
APP_TEST_DATABASE_URL="$APP_TEST_DATABASE_URL" uv run pytest tests/migrations/test_layer_por_migration_pg.py -q
```

Expected: POR deletion currently succeeds and migration `0009` does not exist. If PostgreSQL is unavailable, record the migration test as an environment blocker; do not substitute SQLite evidence.

- [ ] **Step 3: Implement deterministic POR backfill**

Create revision `0009` with `down_revision = "0008"`. The upgrade uses one SQL update selecting `row_number() over (partition by layer_id order by condition_index, id)` only for Layers with no current POR, and sets rank 1 to true. Downgrade is intentionally data-preserving and does nothing because the prior missing-POR state cannot be reconstructed safely.

- [ ] **Step 4: Reject POR deletion in the service**

After the last-row count guard and before event creation/deletion, add:

```python
if condition.is_por:
    raise DomainValidationError(
        "POR 조건 행은 다른 행에 POR을 지정한 후 삭제할 수 있다",
        details={"layer_key": condition.layer.layer_key, "condition_id": condition_id},
    )
```

Do not add a replacement-POR parameter or combine POR transfer with delete; two explicit user actions are simpler and auditable.

- [ ] **Step 5: Write failing frontend behavior tests**

Cover:

- a single-row Layer renders its POR as selected and non-actionable;
- a non-POR click in a multi-row Layer calls `onPorChange`;
- add/duplicate success requests focus on the returned condition ID after query refresh;
- non-POR delete restores focus to next row, then previous when no next row exists;
- a rejected POR delete preserves active row, Layer, and scroll state and displays the server message.

- [ ] **Step 6: Implement simple post-mutation focus**

Make `performStructural<T>` return the API result or `null`, instead of only boolean. Store at most one pending condition ID. For add/duplicate, use returned `ConditionOut.id`; for deletion, compute next/previous condition ID before calling the API. After refreshed `gridData.rows` contains the target, call `scrollToCondition` once and clear pending state.

In Glide POR interaction, a Layer group with `rowCount === 1` is non-actionable; its selected mark still comes only from `rowData.isPor`. Do not synthesize persisted POR data in the frontend. A false value after migration remains visible through the existing POR-gap error path so corrupted data is not hidden.

- [ ] **Step 7: Run focused tests and commit**

```bash
cd backend && uv run pytest tests/features/test_conditions_api.py -q
cd ../frontend && npm test -- --run src/features/sheets/SheetView.test.tsx src/grid/GlideConditionGrid.test.tsx
git add backend/alembic/versions/0009_backfill_layer_por.py backend/tests/migrations/test_layer_por_migration_pg.py backend/app/features/conditions/service.py backend/tests/features/test_conditions_api.py frontend/src/features/sheets/SheetView.tsx frontend/src/features/sheets/SheetView.test.tsx frontend/src/grid/GlideConditionGrid.tsx frontend/src/grid/GlideConditionGrid.test.tsx
git commit -m "fix: enforce one POR per Layer"
```

---

### Task 6: Verify the whole slice and record bounded evidence

**Files:**
- Create: `docs/superpowers/evidence/signal-grid-condition-sheet-core/README.md`
- Create: `.impeccable/review/signal-grid-condition-sheet-1024.png`
- Create: `.impeccable/review/signal-grid-condition-sheet-1440.png`
- Create: `.impeccable/review/signal-grid-condition-sheet-1920.png`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: reproducible test/build/browser evidence and final review input.

- [ ] **Step 1: Run all focused checks**

```bash
cd backend
uv run pytest tests/features/test_sheets_api.py tests/features/test_conditions_api.py -q
cd ../frontend
npm test -- --run src/features/sheets/sheetAdapter.test.ts src/features/sheets/layerViewportState.test.ts src/features/sheets/LayerNavigator.test.tsx src/features/sheets/LayerBackboneContext.test.tsx src/features/sheets/SheetView.test.tsx src/grid/model.test.ts src/grid/GlideConditionGrid.test.tsx
```

- [ ] **Step 2: Run full repository checks**

```bash
cd backend
uv run ruff check .
uv run pyright
uv run pytest -q
cd ../frontend
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Expected: all exit 0. Existing third-party bundle warnings may be recorded but no new warning is accepted.

- [ ] **Step 3: Run the Impeccable detector exactly once**

```bash
node /home/appuser/.codex/skills/impeccable/scripts/detect.mjs --json \
  frontend/src/features/sheets/LayerNavigator.tsx \
  frontend/src/features/sheets/LayerBackboneContext.tsx \
  frontend/src/features/sheets/SheetView.tsx \
  frontend/src/grid/GlideConditionGrid.tsx
```

Fix only concrete findings, run affected tests, and do not rerun the detector.

- [ ] **Step 4: Capture browser evidence at three desktop sizes**

Use a committed or fully documented deterministic fixture. Capture the Sheet route at 1024×768, 1440×900, and 1920×1080. Record document/Grid overflow measurements, console/page errors, fixture assumptions, and exact commands.

Exercise:

- all Layers visible by default and navigator selection jumps without filtering;
- current-only on/off and selection of another Layer while on;
- Step Seq/Layer repetition suppression and horizontal Parameter scrolling;
- cell selection synchronizes navigator and Backbone context;
- add, duplicate, non-POR delete, POR transfer, and blocked POR delete;
- dirty save failure, structural failure, read-only lock state;
- validation/history/Backbone-diff cell jumps and Back focus behavior.

- [ ] **Step 5: Review simplicity and diff hygiene**

Confirm:

- only one new viewport-state module and one Backbone component were introduced;
- no new store, context, global listener, dependency, or Grid-library leak exists;
- `SheetView` orchestration changed narrowly and existing hooks/controllers remain intact;
- `git diff --check` passes and `git diff --stat` contains no unrelated files.

- [ ] **Step 6: Commit evidence**

```bash
git add docs/superpowers/evidence/signal-grid-condition-sheet-core .impeccable/review
git commit -m "test: verify Signal Grid condition sheet core"
```
