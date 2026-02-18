# SPEC-006: Implementation Plan

**SPEC ID**: SPEC-006
**Title**: Version History Enhancement & Change Log Accuracy Improvement
**Phase**: 3 (Workflow & Output)

---

## 0. Existing Code Inventory

### Existing Backend Files (to be Modified)

| File | Current State | Modification Needed |
|---|---|---|
| `backend/app/services/condition_service.py` | Has `_values_differ()` using `str()` comparison (lines 13-19) | Remove local `_values_differ()`, import from shared utility |
| `backend/app/services/backbone_service.py` | Has duplicate `_values_differ()` (lines 14-19) | Remove local `_values_differ()`, import from shared utility |
| `backend/app/services/recipe_service.py` | Has duplicate `_values_differ()` (lines 45-50) | Remove local `_values_differ()`, import from shared utility |
| `backend/app/models/project.py` | `Project` model without `revision_reason` column | Add `revision_reason` mapped column |
| `backend/app/services/project_service.py` | `revise_project()` accepts but discards `description` | Store description in `revision_reason`; update `get_version_history()` |
| `backend/app/schemas/project.py` | `VersionItem` without `revision_reason` | Add `revision_reason` field; add diff response schemas |
| `backend/app/routers/projects.py` | Existing project endpoints | Add version diff endpoint |

### New Backend Files

| File | Purpose |
|---|---|
| `backend/app/utils/comparison.py` | Shared `values_differ()` with numeric normalization |
| `backend/app/utils/__init__.py` | Package init (if not exists) |
| `backend/app/services/diff_service.py` | Version diff comparison service |
| `backend/alembic/versions/xxxx_add_revision_reason.py` | Migration: add `revision_reason` column |
| `backend/alembic/versions/xxxx_cleanup_false_positive_changelogs.py` | Data migration: remove false-positive entries |

### Existing Frontend Files (to be Modified)

| File | Current State | Modification Needed |
|---|---|---|
| `frontend/src/components/editor/RevisionCreateModal.tsx` | Single-line `<Input>` for description, labeled "optional" | Replace with `<Textarea>`, label "recommended", char counter |
| `frontend/src/components/editor/VersionHistoryPanel.tsx` | Lists versions with status, creator, date | Add revision_reason display; add diff summary per version |
| `frontend/src/api/projects.ts` | Existing project API functions | Add `getVersionDiff()` |
| `frontend/src/hooks/useProjects.ts` | Existing project hooks | Add `useVersionDiff()` |
| `frontend/src/types/index.ts` | Existing types | Add diff-related types |

### New Frontend Files

| File | Purpose |
|---|---|
| `frontend/src/components/editor/VersionDiffView.tsx` | Expandable diff view with layer/cell changes |

---

## 1. Milestone 1: Change Log Value Comparison Fix

**Priority**: Primary Goal (data integrity fix)

### Tasks

#### M1-T1: Create Shared Value Comparison Utility

**File**: `backend/app/utils/comparison.py`

- Create `normalize_value(val)` function:
  - `None` -> `None`
  - `str` -> strip whitespace -> if empty return `None` -> try numeric parse -> return int if integer-valued float
  - `float` -> return int if integer-valued
  - Other types -> return as-is
- Create `values_differ(old_val, new_val)` function:
  - Normalize both values
  - Compare normalized values
- Write comprehensive unit tests covering:
  - `490` vs `490.0` -> False (equal)
  - `490` vs `491` -> True (different)
  - `None` vs `""` -> False (equal)
  - `" 490 "` vs `490` -> False (equal after strip)
  - `"abc"` vs `"abc"` -> False (equal)
  - `"abc"` vs `"def"` -> True (different)
  - `None` vs `None` -> False (equal)
  - `None` vs `490` -> True (different)
  - `0` vs `0.0` -> False (equal)
  - `1.5` vs `1.5` -> False (equal)
  - `1.5` vs `1.50` -> False (equal)
  - `"1.5"` vs `1.5` -> False (equal, mixed types)

#### M1-T2: Replace Duplicated Functions in Services

**Files**: `condition_service.py`, `backbone_service.py`, `recipe_service.py`

- Remove local `_values_differ()` definitions from all three files
- Add `from app.utils.comparison import values_differ` to each
- Update all call sites from `_values_differ(...)` to `values_differ(...)`
- Verify existing tests still pass

#### M1-T3: Create Alembic Data Migration for False-Positive Cleanup

**File**: New Alembic migration

- Query `change_logs` where both `old_value` and `new_value` are NOT NULL
- For each row, attempt to parse both as float
- If both parse and are numerically equal, mark for deletion
- Also handle `None` vs `""` equivalence (one NULL, other empty string)
- Execute batched DELETE (1000 rows per batch) to avoid long locks
- Log deletion count via `print()` or `op.execute()` with comment
- Migration is forward-only (no downgrade for data cleanup)

#### M1-T4: Write Tests

- Unit tests for `normalize_value()` and `values_differ()`
- Integration test: bulk save with `490.0` -> `490` should NOT create change_log
- Integration test: bulk save with `490` -> `491` should create change_log
- Integration test: bulk save with `None` -> `""` should NOT create change_log
- Regression test: existing change_log behavior for genuine changes preserved

### Deliverables

- `backend/app/utils/comparison.py` with full test coverage
- Three service files updated to use shared utility
- Alembic data migration script
- All existing tests pass

---

## 2. Milestone 2: Revision Reason Storage

**Priority**: Secondary Goal (feature enhancement)

**Depends on**: None (can be developed in parallel with M1)

### Tasks

#### M2-T1: Alembic Migration -- Add revision_reason Column

**File**: New Alembic migration

```sql
ALTER TABLE projects ADD COLUMN revision_reason TEXT;
```

- Nullable column, no default needed
- Existing rows will have NULL (backward compatible)

#### M2-T2: Update Project Model

**File**: `backend/app/models/project.py`

- Add: `revision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)`

#### M2-T3: Update Project Service -- Store Reason

**File**: `backend/app/services/project_service.py`

- In `revise_project()`, after creating new project:
  - Set `new_project.revision_reason = description`

#### M2-T4: Update Schemas -- Include Reason in Response

**File**: `backend/app/schemas/project.py`

- Add `revision_reason: str | None = None` to `VersionItem` model
- Update `get_version_history()` query to include `revision_reason` from Project

#### M2-T5: Update Frontend -- Revision Creation Modal

**File**: `frontend/src/components/editor/RevisionCreateModal.tsx`

- Replace `<Input>` with `<Textarea>` component (3-4 rows)
- Update label: "Revision Reason (recommended)" instead of "Description (optional)"
- Add placeholder: "Describe the changes to be made and the reason for this revision"
- Add character counter: `{description.length}/500`

#### M2-T6: Update Frontend -- Version History Panel

**File**: `frontend/src/components/editor/VersionHistoryPanel.tsx`

- Add `revision_reason?: string` to version item type
- Below the creator/date section, display truncated reason text (max ~60 chars with ellipsis)
- Full text visible via `title` attribute on hover
- Only show if `revision_reason` is non-null and non-empty

#### M2-T7: Update Frontend Types

**File**: `frontend/src/types/index.ts`

- Add `revision_reason?: string | null` to `VersionItem` type (or equivalent)

### Deliverables

- Alembic migration for `revision_reason` column
- Backend stores and returns revision reason
- Frontend displays reason in version history
- Enhanced revision creation modal with textarea

---

## 3. Milestone 3: Version Diff (JSONB Direct Comparison)

**Priority**: Final Goal (new feature)

**Depends on**: M1 (uses shared `values_differ()` for comparison)

### Tasks

#### M3-T1: Create Diff Service

**File**: `backend/app/services/diff_service.py` (new)

- Function: `async def get_version_diff(db, project_id, compare_project_id)`
- Load both projects with eager-loaded project_layers
- Validate both belong to same product_id
- Match layers by layer_id
- Compare conditions JSONB using `values_differ()`
- Return structured diff with summary

#### M3-T2: Add Diff Response Schemas

**File**: `backend/app/schemas/project.py` (modify)

- Add: `CellDiff`, `LayerDiff`, `DiffSummary`, `VersionDiffResponse` Pydantic models

#### M3-T3: Add Diff API Endpoint

**File**: `backend/app/routers/projects.py` (modify)

- Add: `GET /api/projects/{project_id}/versions/{compare_project_id}/diff`
- Validate both projects exist (404 if not)
- Validate both belong to same product (400 if not)
- Call `get_version_diff()` and return response

#### M3-T4: Add Frontend API and Hook

**File**: `frontend/src/api/projects.ts` (modify)

- Add: `getVersionDiff(projectId, compareProjectId)` function

**File**: `frontend/src/hooks/useProjects.ts` (modify)

- Add: `useVersionDiff(projectId, compareProjectId, enabled)` hook

#### M3-T5: Create Version Diff View Component

**File**: `frontend/src/components/editor/VersionDiffView.tsx` (new)

- Receives diff data as props or fetches via hook
- Summary header: "X layers, Y cells changed"
- Expandable layer sections (collapsed by default)
- Each layer shows changed columns table:
  - Column Name | Old Value | New Value
  - Color coding: red for removed, green for added, yellow for modified
- Click handler to open cell history modal for detailed lineage

#### M3-T6: Integrate Diff into Version History Panel

**File**: `frontend/src/components/editor/VersionHistoryPanel.tsx` (modify)

- Add expand/collapse button per version entry
- When expanded, show VersionDiffView for that version vs its successor
- Lazy-load diff data only when user expands
- Show compact summary line when collapsed: "N layers, M cells changed"

#### M3-T7: Add Frontend Types

**File**: `frontend/src/types/index.ts` (modify)

- Add: `CellDiff`, `LayerDiff`, `DiffSummary`, `VersionDiffResponse` types

### Deliverables

- Backend diff service and API endpoint
- Frontend diff view component
- Version history panel integration with expandable diff
- All milestone requirements verified

---

## 4. Technical Approach

### 4.1 Value Comparison Architecture

```
Before (duplicated, buggy):
  condition_service.py  -> _values_differ() [str comparison]
  backbone_service.py   -> _values_differ() [str comparison]
  recipe_service.py     -> _values_differ() [str comparison]

After (consolidated, correct):
  utils/comparison.py   -> values_differ() [normalized comparison]
  condition_service.py  -> imports from utils/comparison
  backbone_service.py   -> imports from utils/comparison
  recipe_service.py     -> imports from utils/comparison
  diff_service.py       -> imports from utils/comparison
```

### 4.2 Version Diff Data Flow

```
Frontend: VersionHistoryPanel
  -> Click "view diff" on version entry
  -> useVersionDiff(projectId, compareProjectId)
  -> GET /api/projects/{id}/versions/{cmpId}/diff
  -> diff_service.get_version_diff()
    -> Load project_layers for both projects
    -> Match by layer_id
    -> Compare conditions JSONB with values_differ()
    -> Return VersionDiffResponse
  -> VersionDiffView renders expandable diff
```

### 4.3 Migration Order

1. First: `add_revision_reason` schema migration (can run independently)
2. Second: `cleanup_false_positive_changelogs` data migration (should run after code fix is deployed)

Recommended deployment: Deploy code fix first (M1), then run cleanup migration to fix historical data.

---

## 5. Architecture Decisions

### AD-001: Shared Utility vs Service Method

**Decision**: Create standalone utility module (`utils/comparison.py`) rather than adding to an existing service.

**Rationale**: The comparison logic is pure (no DB dependency, no async), used by 4+ service files, and conceptually a utility function, not a business service.

### AD-002: JSONB Comparison in Python vs SQL

**Decision**: Load JSONB into Python and compare in application code.

**Rationale**: PostgreSQL JSONB diff operators exist but produce complex results. Python comparison is simpler, testable, and fast enough for ~60 layers x ~300 columns per comparison.

### AD-003: Diff Between Adjacent Versions Only

**Decision**: The API supports diff between any two projects (not limited to adjacent versions), but the UI defaults to comparing a version with its immediate successor in the revision chain.

**Rationale**: Flexibility in the API enables future features (e.g., "compare with v1") while the UI keeps the default behavior simple.

### AD-004: Cleanup Migration as Data-Only

**Decision**: Separate the data cleanup migration from the schema migration.

**Rationale**: Schema changes (add column) are low-risk and can roll back. Data deletion is irreversible and should be reviewed independently. Separating them allows deploying the column first and cleaning data after verification.

---

## 6. Risk Mitigation Plan

| Risk | Mitigation Strategy |
|---|---|
| Cleanup migration deletes valid change_logs | Run dry-run query (SELECT COUNT) first, review before executing DELETE. Include conservative WHERE clause. |
| Performance regression from normalize_value() overhead | Benchmark: normalize_value is O(1) per call, negligible vs DB I/O. Profile if needed. |
| Large diff response for products with many columns | Diff only returns changed cells (not unchanged). For 300 columns, typically <50 change per revision. |
| Frontend performance with many expanded diff sections | Lazy-load diff data per version. Collapse sections by default. Virtual scrolling if needed. |
