# SPEC-006: Version History Enhancement & Change Log Accuracy

**SPEC ID**: SPEC-006
**Title**: Version History Enhancement & Change Log Accuracy Improvement
**Phase**: 3 (Workflow & Output)
**Status**: Planned
**Priority**: High
**Created**: 2026-02-18

---

## 1. Overview

### 1.1 Purpose

This SPEC addresses three related improvements to PCM's version management and change tracking accuracy:

1. **Change Log Value Comparison Fix** -- Eliminate false-positive change_log entries caused by naive `str()` comparison of numeric types (e.g., `490.0` vs `490` recorded as a change when they are numerically identical).
2. **Revision Reason Storage** -- Persist the revision description/reason to the database so it can be displayed in the version history panel.
3. **Version Diff** -- Enable direct JSONB comparison between two project versions to show exactly which layers and cells changed between revisions.

### 1.2 Background

- PCM records cell-level changes in the `change_logs` table with `old_value` and `new_value` as Text columns.
- The current `_values_differ()` function (duplicated in `condition_service.py`, `backbone_service.py`, and `recipe_service.py`) compares values via `str(old_val) != str(new_val)`, which produces false positives when JSONB deserializes numeric values to different Python types (int vs float with same mathematical value).
- The `ReviseProjectRequest` schema accepts a `description` field, but `revise_project()` in `project_service.py` never stores it in the database. There is no `revision_reason` column on the `projects` table.
- The `VersionHistoryPanel` component lists versions but cannot show what changed between them. Users must manually compare cell-by-cell to understand what a revision modified.
- The `_values_differ()` function is duplicated across three service files, violating the single source of truth principle.

### 1.3 Scope

**In Scope**:
- Fix `_values_differ()` to normalize numeric types before comparison
- Consolidate duplicated `_values_differ()` into a shared utility module
- Net-zero change detection: skip change_log when value reverts to original (A -> B -> A scenario)
- One-time Alembic migration to clean up existing false-positive change_log entries
- Add `revision_reason` column to `projects` table
- Store and display revision reason in version history
- Enhance revision creation modal UI with prominent reason input
- New API for JSONB-based diff between two project versions
- Frontend version diff view integrated into version history panel

**Out of Scope**:
- Real-time change notifications (WebSocket)
- Change log export to Excel/PDF
- Cross-layer diff visualization
- Full audit trail UI for admin users
- Retroactive assignment of revision reasons to existing archived projects

### 1.4 Dependencies

| Dependency | Status | Impact |
|---|---|---|
| `change_logs` table and data population | Complete (Phase 1/2) | Contains existing false-positive entries to clean |
| `projects` table with revision chain | Complete (SPEC-002) | Will receive new `revision_reason` column |
| `project_layers.conditions` JSONB | Complete (Phase 1) | Foundation for JSONB diff comparison |
| `VersionHistoryPanel.tsx` | Complete (SPEC-004 M3) | Will be enhanced with revision reason and diff view |
| `RevisionCreateModal.tsx` | Complete (SPEC-002) | Will be enhanced with prominent reason input |
| `_values_differ()` in 3 service files | Complete (Phase 1/2) | Will be consolidated and fixed |

---

## 2. Environment

- **Backend**: FastAPI (Python 3.11+), SQLAlchemy 2.x (async), Alembic, Pydantic v2
- **Frontend**: React 18 + TypeScript + Vite, AG Grid Community, React Router, Axios
- **Database**: PostgreSQL 16 with JSONB condition storage
- **Infrastructure**: Docker Compose (backend:8000, frontend:5173, nginx:80, db:5432)
- **Existing Data**: `change_logs` table may contain false-positive entries from prior `str()` comparison

---

## 3. Assumptions

- **ASM-001**: Numeric values in JSONB conditions are stored as either Python `int` or `float`. No other numeric types (e.g., `Decimal`) are used.
- **ASM-002**: The `old_value` and `new_value` columns in `change_logs` are stored as `Text`. The cleanup migration can identify false positives by attempting numeric parsing and comparing parsed values.
- **ASM-003**: The number of false-positive change_log entries is manageable for a single Alembic migration (not millions of rows). If the table is very large, the migration can be batched.
- **ASM-004**: JSONB conditions are flat dictionaries of `{column_name: value}` per project_layer. Nested structures are not expected.
- **ASM-005**: Version diff only needs to compare the latest state of conditions JSONB between two projects. It does not need to replay the full change_log history.
- **ASM-006**: Empty string `""` and `None`/`null` should be treated as equivalent in value comparison (both represent "no value").

---

## 4. Requirements

### Milestone 1: Change Log Value Comparison Fix

#### REQ-001: Numeric Type Normalization

**WHEN** the system compares `old_value` and `new_value` during bulk save, backbone replace, or recipe apply, **THEN** the system **shall** normalize numeric types before comparison so that values with identical mathematical meaning (e.g., `490` vs `490.0`, `0` vs `0.0`) are treated as equal.

#### REQ-002: Consolidated Value Comparison Utility

The system **shall** provide a single shared `_values_differ()` function in a dedicated utility module (`backend/app/utils/comparison.py`) and all three service files (`condition_service.py`, `backbone_service.py`, `recipe_service.py`) **shall** import from this shared module instead of maintaining their own copies.

#### REQ-003: Net-Zero Change Detection

**WHEN** a user edits a cell value from A to B and then back to A within a single bulk save operation, **THEN** the system **shall not** create a change_log entry for that cell, because the net change is zero.

Implementation note: The bulk save already compares current DB value vs submitted value. Since the submitted value (A) equals the DB value (A), no diff is detected and no change_log is created. This requirement is inherently satisfied by the current architecture but must be validated by tests.

#### REQ-004: Empty Value Equivalence

**WHEN** comparing values, the system **shall** treat `None`, `null`, and empty string `""` as equivalent (i.e., changing from `None` to `""` or vice versa should not create a change_log entry).

#### REQ-005: False-Positive Cleanup Migration

The system **shall** include a one-time Alembic data migration that:
1. Scans all `change_logs` rows where `old_value` and `new_value` are both non-null
2. Attempts to parse both as numeric (float)
3. Deletes rows where the parsed numeric values are equal
4. Also deletes rows where the only difference is `None` vs `""` equivalence
5. Logs the number of deleted rows for audit purposes

#### REQ-006: Whitespace Normalization

**WHEN** comparing values, the system **shall** strip leading and trailing whitespace before comparison so that `" 490 "` and `"490"` are treated as equal.

### Milestone 2: Revision Reason Storage

#### REQ-101: Revision Reason Column

The system **shall** add a `revision_reason` column (nullable Text) to the `projects` table via an Alembic migration.

#### REQ-102: Store Reason on Revision Creation

**WHEN** a user creates a new revision via `POST /api/projects/{id}/revise` with a `description` field, **THEN** the system **shall** store the `description` value in the new project's `revision_reason` column.

#### REQ-103: Return Reason in Version History API

**WHEN** the version history API (`GET /api/projects/{id}/version-history`) returns version items, **THEN** each item **shall** include a `revision_reason` field (nullable string).

#### REQ-104: Display Reason in Version History Panel

**WHEN** a version item in the VersionHistoryPanel has a `revision_reason`, **THEN** the panel **shall** display the reason text below the version metadata (creator, date).

#### REQ-105: Enhanced Revision Creation Modal

**WHEN** the user opens the revision creation modal, **THEN** the modal **shall** display a multi-line text area (instead of a single-line input) for the revision reason, with a label indicating it is recommended (not optional), and a placeholder suggesting what to include (e.g., "Describe what changes will be made and why").

### Milestone 3: Version Diff (JSONB Direct Comparison)

#### REQ-201: Version Diff API Endpoint

The system **shall** provide `GET /api/projects/{project_id}/versions/{compare_project_id}/diff` that:
1. Loads `project_layers` with `conditions` JSONB for both projects
2. Matches layers by `layer_id` between the two projects
3. For each matching layer, compares conditions key-by-key using the improved `_values_differ()` function
4. Returns a response containing:
   - `summary`: `{ total_layers_changed: int, total_cells_changed: int }`
   - `layers`: list of changed layers, each with `layer_id`, `layer_name`, `changes`: list of `{ column_name, old_value, new_value }`
5. Layers with zero changes are excluded from the response
6. Layers present in only one project are reported as fully added or fully removed

#### REQ-202: Version Diff Authorization

**IF** either `project_id` or `compare_project_id` does not exist, **THEN** the system **shall** return HTTP 404. **IF** the two projects do not belong to the same `product_id`, **THEN** the system **shall** return HTTP 400 with a clear error message.

#### REQ-203: Version Diff Summary in Version History Panel

**WHEN** a user clicks on a non-current version in the VersionHistoryPanel, **THEN** the panel **shall** display a compact diff summary (e.g., "5 layers, 23 cells changed") between that version and the next version in the revision chain.

#### REQ-204: Expandable Layer Diff View

**WHEN** a user expands a layer in the version diff view, **THEN** the system **shall** show the list of changed columns with old and new values side by side.

#### REQ-205: Diff View Navigation to Cell History

**WHEN** a user clicks on a specific cell change within the diff view, **THEN** the system **shall** open the existing cell history modal for that layer and column, providing full change_log lineage.

---

## 5. Specifications

### 5.1 Backend Specifications

#### SPEC-5.1.1: Shared Value Comparison Utility

**File**: `backend/app/utils/comparison.py` (new)

```python
def normalize_value(val: Any) -> Any:
    """Normalize a value for comparison purposes."""
    if val is None:
        return None
    if isinstance(val, str):
        val = val.strip()
        if val == "":
            return None
        # Attempt numeric parse
        try:
            num = float(val)
            if num == int(num):
                return int(num)
            return num
        except (ValueError, OverflowError):
            return val
    if isinstance(val, float):
        if val == int(val) and not (val != val):  # not NaN
            return int(val)
        return val
    return val

def values_differ(old_val: Any, new_val: Any) -> bool:
    """Compare two values with numeric normalization."""
    norm_old = normalize_value(old_val)
    norm_new = normalize_value(new_val)
    if norm_old is None and norm_new is None:
        return False
    if norm_old is None or norm_new is None:
        return True
    return str(norm_old) != str(norm_new)
```

#### SPEC-5.1.2: Alembic Migration -- revision_reason Column

**Migration**: Add `revision_reason` column to `projects` table.

```sql
ALTER TABLE projects ADD COLUMN revision_reason TEXT;
```

#### SPEC-5.1.3: Alembic Data Migration -- False-Positive Cleanup

**Migration**: Remove change_log entries where old_value and new_value are numerically equal.

Logic:
1. Select all change_logs where both old_value and new_value are non-null
2. For each row, attempt float parse of both values
3. If both parse successfully and are equal, delete the row
4. Also delete rows where one is NULL and other is empty string (or vice versa)
5. Log count of deleted rows

#### SPEC-5.1.4: Revision Reason in Project Service

Modify `revise_project()` in `project_service.py`:
- Store `description` parameter into `new_project.revision_reason`

Modify `get_version_history()` in `project_service.py`:
- Include `revision_reason` in the returned `VersionItem` objects

#### SPEC-5.1.5: Version Diff Service

**File**: `backend/app/services/diff_service.py` (new)

Function: `async def get_version_diff(db, project_id, compare_project_id) -> VersionDiffResponse`

Algorithm:
1. Load both projects with project_layers (eager load conditions JSONB)
2. Validate both projects belong to same product_id
3. Create layer lookup by layer_id for both projects
4. For each layer_id present in either project:
   a. If layer only in one project: report as added/removed with all columns
   b. If layer in both: compare conditions dict key-by-key using `values_differ()`
   c. Collect changed columns with old_value and new_value
5. Build summary (total_layers_changed, total_cells_changed)
6. Return structured response

#### SPEC-5.1.6: Version Diff API Endpoint

**Endpoint**: `GET /api/projects/{project_id}/versions/{compare_project_id}/diff`

**Response Schema**:
```python
class CellDiff(BaseModel):
    column_name: str
    old_value: str | None
    new_value: str | None

class LayerDiff(BaseModel):
    layer_id: int
    layer_name: str
    change_type: str  # "modified" | "added" | "removed"
    changes: list[CellDiff]

class DiffSummary(BaseModel):
    total_layers_changed: int
    total_cells_changed: int

class VersionDiffResponse(BaseModel):
    base_project_id: int
    compare_project_id: int
    base_revision: int
    compare_revision: int
    summary: DiffSummary
    layers: list[LayerDiff]
```

### 5.2 Frontend Specifications

#### SPEC-5.2.1: Enhanced Revision Creation Modal

**File**: `frontend/src/components/editor/RevisionCreateModal.tsx` (modify)

Changes:
- Replace single-line `<Input>` with multi-line `<Textarea>` (3-4 rows)
- Change label from "Description (optional)" to "Revision Reason (recommended)"
- Add informative placeholder: "Describe the changes to be made and the reason for this revision"
- Add character counter showing current/max (500)

#### SPEC-5.2.2: Version History Panel -- Revision Reason Display

**File**: `frontend/src/components/editor/VersionHistoryPanel.tsx` (modify)

Changes:
- Add `revision_reason` field to version item type
- Display revision reason as a truncated line below version metadata
- Show full reason on hover (title attribute) or via expandable text

#### SPEC-5.2.3: Version Diff Summary in History Panel

**File**: `frontend/src/components/editor/VersionHistoryPanel.tsx` (modify)

Changes:
- For each non-latest version, fetch diff summary against its successor version
- Display compact summary: "N layers, M cells changed"
- Lazy-load diff data only when panel is open

#### SPEC-5.2.4: Version Diff Detail Component

**File**: `frontend/src/components/editor/VersionDiffView.tsx` (new)

Features:
- Expandable/collapsible layer sections
- Each layer section shows changed columns with old vs new values
- Color coding: green for added values, red for removed, yellow for modified
- Click on a cell change opens existing cell history modal
- Summary header with total layers and cells changed

#### SPEC-5.2.5: API Client Functions

**File**: `frontend/src/api/projects.ts` (modify)

Add:
- `getVersionDiff(projectId: number, compareProjectId: number): Promise<VersionDiffResponse>`

**File**: `frontend/src/hooks/useProjects.ts` (modify)

Add:
- `useVersionDiff(projectId: number, compareProjectId: number, enabled: boolean)`

---

## 6. Non-Functional Requirements

### NFR-001: Diff API Performance

**WHILE** the system is comparing two projects each with up to 60 layers and 300 columns per layer, the diff API **shall** return a response within 2 seconds.

### NFR-002: Cleanup Migration Safety

The false-positive cleanup migration **shall** be wrapped in a single transaction with a row count log, allowing rollback if unexpected behavior is detected.

### NFR-003: Backward Compatibility

**IF** the `revision_reason` column is NULL for existing projects, **THEN** the version history panel **shall** gracefully hide the reason field (no "null" or "undefined" displayed).

### NFR-004: Value Comparison Consistency

The shared `values_differ()` function **shall** be the single source of truth for all value comparison logic across all services. The system **shall not** maintain duplicate comparison functions.

---

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cleanup migration deletes legitimate change_logs | Low | High | Run migration in dry-run mode first (count only); review before committing. Include WHERE clause to only target numeric-equivalent rows. |
| Large change_logs table causes slow migration | Medium | Medium | Batch the DELETE in chunks of 1000 rows. Add index on (old_value, new_value) temporarily if needed. |
| Diff API slow for products with 300+ columns | Low | Medium | Load only conditions JSONB (not full model relationships). Compare in Python dict comprehension for O(n) per layer. |
| Empty string vs NULL inconsistency in existing data | Medium | Low | Normalize both to NULL in comparison. Cleanup migration handles historical data. |

---

## 8. Traceability

| Requirement | Milestone | Files Affected |
|---|---|---|
| REQ-001, REQ-002, REQ-004, REQ-006 | M1 | `backend/app/utils/comparison.py` (new), `condition_service.py`, `backbone_service.py`, `recipe_service.py` |
| REQ-003 | M1 | Test validation only (architecture already handles this) |
| REQ-005 | M1 | New Alembic migration (data migration) |
| REQ-101 | M2 | `backend/app/models/project.py`, new Alembic migration |
| REQ-102 | M2 | `backend/app/services/project_service.py`, `backend/app/schemas/project.py` |
| REQ-103 | M2 | `backend/app/services/project_service.py`, `backend/app/schemas/project.py` |
| REQ-104 | M2 | `frontend/src/components/editor/VersionHistoryPanel.tsx` |
| REQ-105 | M2 | `frontend/src/components/editor/RevisionCreateModal.tsx` |
| REQ-201, REQ-202 | M3 | `backend/app/services/diff_service.py` (new), `backend/app/routers/projects.py`, `backend/app/schemas/project.py` |
| REQ-203 | M3 | `frontend/src/components/editor/VersionHistoryPanel.tsx` |
| REQ-204, REQ-205 | M3 | `frontend/src/components/editor/VersionDiffView.tsx` (new) |
