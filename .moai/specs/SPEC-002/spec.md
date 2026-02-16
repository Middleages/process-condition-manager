# SPEC-002: Sprint 2.4+2.5 - Conditional Validation Enhancement + Revision Feature

**SPEC ID**: SPEC-002
**Title**: Conditional Validation Enhancement + Revision Feature
**Status**: Planned
**Priority**: High
**Created**: 2026-02-16
**Branch**: feature/SPEC-002
**Phase**: Phase 2 (Final Sprints for Phase 2 DoD)

---

## Environment

### Current System State

- **PCM**: Semiconductor Photo process condition table management system
- **Stack**: FastAPI (Python) + React 18 (TypeScript) + PostgreSQL 16
- **Phase 2 Progress**: Sprint 2.1 (backbone replacement), 2.2 (recipe XML), 2.3 (admin settings) completed
- **Remaining Phase 2 DoD Items**:
  - Conditional required validation with cross-field triggering (Sprint 2.4)
  - Revision creation from Approved project (Sprint 2.5)
  - Project list latest version filtering (Sprint 2.5)

### Existing Infrastructure (Already Implemented)

**Conditional Validation (Sprint 2.4 baseline)**:
- DB: `column_validations` table with `conditional_required` rule_type, `rule_config` JSONB
- Backend: `_validate_conditional_required()` in `backend/app/services/validation_service.py:66-94` -- `equals` operator only
- Frontend: `validateCellValue()` in `frontend/src/lib/validation.ts:42-54` -- `equals` operator only
- Seed data: 3 conditional_required rules (SP_ADHESION_USE -> TYPE, SP_ADHESION_USE -> TEMP, OVL_APC_USE -> TYPE)
- Tests: Backend 2 tests, Frontend 5 tests for conditional_required
- Admin UI: ValidationEditModal.tsx already supports conditional_required rule editing

**Revision Feature (Sprint 2.5 baseline)**:
- DB Model: `Project` model already has `revision` (int, default=1), `parent_project_id` (FK, nullable), `is_latest` (bool, default=True) fields
- Status Enum: `ProjectStatus` already includes `'archived'` in both backend and frontend types
- Project List API: `get_projects_list()` already filters by `is_latest=True` by default
- Response Schema: `ProjectResponse` already includes `revision`, `parent_project_id`, `is_latest`

---

## Assumptions

1. The `rule_config` JSONB structure for `conditional_required` keeps backward compatibility -- existing rules with `operator: "equals"` (or no operator field) continue to work as `equals`
2. Revision creation only happens from `Approved` status -- no other status is eligible
3. A product can have at most one active (Draft/Review) project at any time
4. Deep copy of `project_layers` during revision includes `conditions` and sets `backbone_conditions` to the approved version's `conditions` (for diff highlighting)
5. The `is_latest` flag is maintained atomically within the revision transaction
6. Archived projects cannot be edited, deleted, or have their status changed
7. Version history panel is scoped to Phase 2 (basic list view); full diff comparison is Phase 4

---

## Requirements

### Sprint 2.4: Conditional Validation Enhancement

#### REQ-2.4-001: Extended Operator Support (Backend)

**WHEN** the backend validates a `conditional_required` rule, **THEN** the system **shall** support three operators: `equals`, `not_equals`, and `contains`.

**Operator Semantics**:
- `equals`: condition is met when `str(actual_value) == str(condition_value)` (existing behavior)
- `not_equals`: condition is met when `str(actual_value) != str(condition_value)`
- `contains`: condition is met when `str(condition_value) in str(actual_value)`

**Default Behavior**: **IF** the `operator` field is missing from `rule_config`, **THEN** the system **shall** default to `equals` for backward compatibility.

**File**: `backend/app/services/validation_service.py` -- `_validate_conditional_required()` function

#### REQ-2.4-002: Extended Operator Support (Frontend)

**WHEN** the frontend validates a cell with a `conditional_required` rule, **THEN** the system **shall** support the same three operators: `equals`, `not_equals`, and `contains`.

**Default Behavior**: **IF** the `operator` field is missing from `rule_config`, **THEN** the system **shall** default to `equals`.

**File**: `frontend/src/lib/validation.ts` -- `validateCellValue()` function

#### REQ-2.4-003: Cross-Field Re-Validation Trigger

**WHEN** a user edits a CONDITION column (e.g., `SP_ADHESION_USE`) that is referenced in `conditional_required` rules of other columns, **THEN** the frontend **shall** re-validate ALL DEPENDENT columns (e.g., `SP_ADHESION_TYPE`, `SP_ADHESION_TEMP_C`) for the same row.

**Current Gap**: The `handleCellChanged` callback in `ConditionEditorPage.tsx:105-137` only validates the single changed cell. It does not check if that cell is a condition source for other columns' conditional_required rules.

**Implementation Approach**:
1. Build a reverse lookup map: `conditionColumn -> [dependentColumnDefs]` from loaded column definitions
2. When a cell changes, check if that column appears as a `condition_column` in any conditional_required rule
3. If yes, re-validate all dependent columns for that row using `validateCellValue()`
4. Update validation errors in the editor store

**File**: `frontend/src/pages/ConditionEditorPage.tsx` -- `handleCellChanged` callback

#### REQ-2.4-004: Operator Selection in Admin UI

**WHEN** an admin creates or edits a `conditional_required` validation rule, **THEN** the Admin UI **shall** provide an operator dropdown with options: `equals`, `not_equals`, `contains`.

**Current State**: `ValidationEditModal.tsx` already handles `conditional_required` rule editing. The operator field needs to be added to the form.

**File**: `frontend/src/components/admin/ValidationEditModal.tsx`

#### REQ-2.4-005: Test Coverage for Extended Operators

The system **shall** have test coverage for all three operators on both backend and frontend:

**Backend Tests** (`backend/tests/test_validation_service.py`):
- `not_equals` operator: condition met when values differ, not met when equal
- `contains` operator: condition met when substring matches, not met otherwise
- Missing operator defaults to `equals`

**Frontend Tests** (`frontend/src/lib/__tests__/validation.test.ts`):
- `not_equals` operator: same scenarios as backend
- `contains` operator: same scenarios as backend
- Missing operator defaults to `equals`

---

### Sprint 2.5: Revision Feature

#### REQ-2.5-001: Revision Creation API

**WHEN** a client sends `POST /api/projects/{id}/revise` with an optional `description` body field, **THEN** the system **shall**:

1. Verify the project exists and has `status = 'approved'`
2. Verify no active (Draft/Review) project exists for the same product
3. Within a single transaction:
   a. Set the original project's `status` to `'archived'` and `is_latest` to `False`
   b. Create a new `Project` with:
      - `product_id`: same as original
      - `main_backbone_id`: same as original
      - `status`: `'draft'`
      - `revision`: original.revision + 1
      - `parent_project_id`: original.id
      - `is_latest`: True
      - `created_by`: from request body
   c. Deep-copy all `project_layers` from the original:
      - `conditions`: copy of original's `conditions` (editable)
      - `backbone_conditions`: copy of original's `conditions` (diff baseline = previous approved version)
      - `backbone_product_id`, `layer_id`, `sort_order`: same as original
4. Return the new project detail

**Error Responses**:
- 404: Project not found
- 400: Project is not in Approved status
- 409: Active Draft/Review project already exists for this product

**File**: `backend/app/services/project_service.py` (new function `revise_project`)
**Router**: `backend/app/routers/projects.py` (new endpoint)

#### REQ-2.5-002: Revision Request/Response Schema

The system **shall** define Pydantic schemas for the revision API:

**Request**: `ReviseProjectRequest`
```python
class ReviseProjectRequest(BaseModel):
    created_by: int
    description: str | None = None  # Optional revision description
```

**Response**: Reuse existing `ProjectDetailResponse` (returns the new project with all layers)

**File**: `backend/app/schemas/project.py`

#### REQ-2.5-003: Archived Status Protection

**WHILE** a project has `status = 'archived'`, the system **shall NOT** allow:
- Editing conditions (bulk save endpoint should reject with 403)
- Status changes (status update endpoint should reject with 403)
- Deleting the project or its layers
- Backbone replacement
- Recipe application

**Implementation**: Add status guard check at the beginning of relevant service functions or router endpoints.

**Files**:
- `backend/app/routers/projects.py` (bulk save, status change endpoints)
- `backend/app/services/condition_service.py` (save function)
- `backend/app/services/backbone_service.py` (replace function)
- `backend/app/services/recipe_service.py` (apply function)

#### REQ-2.5-004: Version History API

**WHEN** a client sends `GET /api/products/{productId}/revisions`, **THEN** the system **shall** return all project versions for that product, ordered by revision descending.

**Response Schema**: `RevisionListResponse`
```python
class RevisionItem(BaseModel):
    project_id: int
    revision: int
    status: str
    created_by: int
    creator_name: str
    created_at: datetime
    description: str | None = None
    change_count: int = 0  # Number of changed cells from parent version

class RevisionListResponse(BaseModel):
    product_id: int
    product_name: str
    revisions: list[RevisionItem]
```

**File**: `backend/app/services/project_service.py` (new function `get_product_revisions`)
**Router**: New router or extend existing products router

#### REQ-2.5-005: Project List Version Display

**WHEN** the project list page loads, **THEN** the system **shall** display:
1. Current version number (e.g., "v3") in a version column
2. A clickable indicator for previous versions (e.g., "v1, v2") when `revision > 1`
3. Only `is_latest = True` projects (already filtered by backend API)

**File**: `frontend/src/pages/ProjectListPage.tsx`

#### REQ-2.5-006: Revision Creation Button

**WHILE** a project has `status = 'approved'`, **THEN** the editor header **shall** display a "Create Revision" button.

**WHEN** the user clicks the "Create Revision" button, **THEN** the system **shall** open a confirmation modal.

**File**: `frontend/src/components/editor/EditorHeader.tsx`

#### REQ-2.5-007: Revision Creation Modal

**WHEN** the revision creation modal is open, **THEN** the system **shall** display:
1. Current version info (product name, version number, status)
2. New version info (product name, version + 1, Draft status)
3. Explanation text that the current version will become read-only
4. Optional "Revision description" text field
5. Cancel and Create buttons

**WHEN** the user clicks "Create", **THEN** the system **shall**:
1. Call `POST /api/projects/{id}/revise` with `created_by` and optional `description`
2. On success, navigate to the new project's editor page
3. On error, display appropriate error message

**File**: `frontend/src/components/editor/RevisionCreateModal.tsx` (new component)

#### REQ-2.5-008: Version History Panel

**WHEN** the user clicks on the version history indicator in the project list, **THEN** the system **shall** display a panel or modal showing:
1. All versions for that product (newest first)
2. Each version's: revision number, status (with badge), creator, created date
3. Navigation link to view each version (read-only for archived, edit for draft)

**File**: `frontend/src/components/projects/VersionHistoryModal.tsx` (new component)

#### REQ-2.5-009: Archived Status UI Handling

**WHILE** a project has `status = 'archived'`, **THEN** the frontend **shall**:
1. Display the `StatusBadge` with an "Archived" label and appropriate styling
2. Open the project in read-only mode (no edit capabilities)
3. Hide the save button, recipe upload button, and backbone replace options

**File**:
- `frontend/src/components/projects/StatusBadge.tsx` (add archived variant)
- `frontend/src/pages/ConditionEditorPage.tsx` (read-only mode logic)

#### REQ-2.5-010: Frontend API Integration

The system **shall** provide the following API client functions:

```typescript
// POST /api/projects/{id}/revise
reviseProject(projectId: number, data: { created_by: number; description?: string }): Promise<ProjectDetail>

// GET /api/products/{productId}/revisions
getProductRevisions(productId: number): Promise<RevisionListResponse>
```

**File**: `frontend/src/api/client.ts` (add new API functions)
**Hooks**: `frontend/src/hooks/useProjects.ts` (add mutation and query hooks)

---

## Specifications

### Data Model (No Schema Changes Required)

The `projects` table already has all required fields from Sprint 2.1:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `revision` | INTEGER | 1 | Version number within product |
| `parent_project_id` | INTEGER (FK) | NULL | Previous version's project ID |
| `is_latest` | BOOLEAN | TRUE | Whether this is the latest version for the product |

Status enum already includes: `draft`, `review`, `approved`, `rejected`, `archived`

**Note**: A new `description` column may be needed on `projects` table for revision description. Alternatively, store it in a separate metadata field or as part of the revision creation log.

### API Endpoints Summary

| Method | Path | Sprint | Description |
|--------|------|--------|-------------|
| POST | `/api/projects/{id}/revise` | 2.5 | Create new revision from approved project |
| GET | `/api/products/{productId}/revisions` | 2.5 | Get version history for a product |

### rule_config Format (Extended)

```json
{
  "condition_column": "SP_ADHESION_USE",
  "condition_value": "Y",
  "operator": "equals"     // "equals" | "not_equals" | "contains" (default: "equals")
}
```

### Cross-Field Validation Dependency Map

Built at runtime from loaded column definitions:

```
conditionDependencyMap: Map<string, ColumnDefinition[]>
  "SP_ADHESION_USE" -> [colDef(SP_ADHESION_TYPE), colDef(SP_ADHESION_TEMP_C)]
  "OVL_APC_USE" -> [colDef(OVL_APC_TYPE)]
```

When `SP_ADHESION_USE` changes value, re-validate `SP_ADHESION_TYPE` and `SP_ADHESION_TEMP_C` for the same row.

---

## Traceability

| Requirement | Phase 2 DoD Item | Implementation File(s) |
|-------------|-----------------|----------------------|
| REQ-2.4-001 | Conditional required validation | `backend/app/services/validation_service.py` |
| REQ-2.4-002 | Conditional required validation | `frontend/src/lib/validation.ts` |
| REQ-2.4-003 | Conditional required validation | `frontend/src/pages/ConditionEditorPage.tsx` |
| REQ-2.4-004 | Admin UI for validation rules | `frontend/src/components/admin/ValidationEditModal.tsx` |
| REQ-2.4-005 | Test coverage | `backend/tests/`, `frontend/src/lib/__tests__/` |
| REQ-2.5-001 | Revision creation | `backend/app/services/project_service.py`, `backend/app/routers/projects.py` |
| REQ-2.5-002 | Revision API schema | `backend/app/schemas/project.py` |
| REQ-2.5-003 | Archived read-only | Multiple backend files |
| REQ-2.5-004 | Version history | `backend/app/services/project_service.py` |
| REQ-2.5-005 | Project list version display | `frontend/src/pages/ProjectListPage.tsx` |
| REQ-2.5-006 | Revision button | `frontend/src/components/editor/EditorHeader.tsx` |
| REQ-2.5-007 | Revision modal | `frontend/src/components/editor/RevisionCreateModal.tsx` |
| REQ-2.5-008 | Version history panel | `frontend/src/components/projects/VersionHistoryModal.tsx` |
| REQ-2.5-009 | Archived UI handling | Multiple frontend files |
| REQ-2.5-010 | API integration | `frontend/src/api/client.ts`, `frontend/src/hooks/useProjects.ts` |
