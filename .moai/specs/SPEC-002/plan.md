# SPEC-002: Implementation Plan

**SPEC ID**: SPEC-002
**Title**: Conditional Validation Enhancement + Revision Feature
**Branch**: feature/SPEC-002

---

## Milestones

### M1: Conditional Validation Enhancement (Sprint 2.4)

**Priority**: High -- Prerequisite for Phase 2 DoD
**Dependencies**: Sprint 2.3 completed (admin validation UI)

#### M1.1: Backend Extended Operators

**Goal**: Support `not_equals` and `contains` operators in backend validation

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `backend/app/services/validation_service.py` | Refactor `_validate_conditional_required()` to support operator dispatch (`equals`, `not_equals`, `contains`) with `equals` default |

**Approach**:
1. Extract operator from `rule.rule_config.get("operator", "equals")`
2. Replace the single `if str(actual_cond_val) == str(cond_val)` check with operator-based condition evaluation
3. Add helper function `_evaluate_condition(actual_value, condition_value, operator) -> bool`
4. Keep existing behavior for `equals` unchanged

#### M1.2: Frontend Extended Operators

**Goal**: Mirror backend operator support in frontend validation

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `frontend/src/lib/validation.ts` | Add operator dispatch in `conditional_required` case within `validateCellValue()` |

**Approach**:
1. Read `operator` from `rule.rule_config` with `'equals'` default
2. Replace `String(depValue) === String(config.condition_value)` with operator-based check
3. Add `evaluateCondition(actual: unknown, expected: unknown, operator: string): boolean` utility

#### M1.3: Cross-Field Re-Validation Trigger

**Goal**: When a condition column changes, re-validate all dependent columns

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `frontend/src/pages/ConditionEditorPage.tsx` | Extend `handleCellChanged` to detect condition columns and re-validate dependents |
| `frontend/src/lib/validation.ts` | Add `buildConditionDependencyMap()` utility function |

**Approach**:
1. Add `buildConditionDependencyMap(categories: ColumnCategory[]): Map<string, ColumnDefinition[]>` that scans all column validations for `conditional_required` rules and builds reverse lookup
2. In `handleCellChanged`, after validating the changed cell:
   a. Check if `columnName` exists in the dependency map
   b. If yes, iterate over dependent column definitions
   c. For each dependent column, get its current value from the row conditions (merged with dirty cells)
   d. Call `validateCellValue()` with updated row conditions
   e. Update validation errors in store
3. Memoize the dependency map using `useMemo` to avoid rebuilding on every render

#### M1.4: Admin UI Operator Field

**Goal**: Add operator dropdown in conditional_required rule editing

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `frontend/src/components/admin/ValidationEditModal.tsx` | Add operator select field to conditional_required form section |

**Approach**:
1. Add operator field with options: `equals`, `not_equals`, `contains`
2. Default to `equals` when creating new rules
3. Populate from `rule_config.operator` when editing existing rules

#### M1.5: Test Coverage

**Goal**: Comprehensive tests for new operators and cross-field logic

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `backend/tests/test_validation_service.py` | Add test cases for `not_equals`, `contains`, default operator |
| `frontend/src/lib/__tests__/validation.test.ts` | Add test cases for `not_equals`, `contains`, default operator |

**Backend Test Cases**:
- `test_conditional_required_not_equals_triggers_when_values_differ`
- `test_conditional_required_not_equals_does_not_trigger_when_values_equal`
- `test_conditional_required_contains_triggers_when_substring_matches`
- `test_conditional_required_contains_does_not_trigger_when_no_match`
- `test_conditional_required_defaults_to_equals_when_operator_missing`

**Frontend Test Cases**:
- `not_equals: returns error when values differ and target is empty`
- `not_equals: passes when values are equal`
- `contains: returns error when condition contains substring and target is empty`
- `contains: passes when condition does not contain substring`
- `missing operator defaults to equals behavior`

---

### M2: Revision Backend (Sprint 2.5)

**Priority**: High -- Core Phase 2 DoD feature
**Dependencies**: M1 completion not required (independent work stream)

#### M2.1: Revision Creation Service

**Goal**: Implement `revise_project` service function

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `backend/app/services/project_service.py` | Add `revise_project()` function |
| `backend/app/schemas/project.py` | Add `ReviseProjectRequest` schema |

**Approach**:
1. Validate source project exists and is Approved
2. Check no active (Draft/Review) project for same product
3. Single transaction:
   - Archive original: `status='archived'`, `is_latest=False`
   - Create new project: `revision=N+1`, `parent_project_id=original.id`, `is_latest=True`
   - Deep-copy project_layers with `backbone_conditions = original.conditions`
4. Return new project detail via `get_project_detail()`

**Critical Business Rule**: `backbone_conditions` in the new revision is set to the **original's approved conditions**, not the original's backbone_conditions. This enables diff highlighting showing "what changed compared to the last approved version."

#### M2.2: Revision API Endpoint

**Goal**: Expose revision creation via REST API

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `backend/app/routers/projects.py` | Add `POST /api/projects/{id}/revise` endpoint |

#### M2.3: Archived Status Protection

**Goal**: Prevent modifications to archived projects

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `backend/app/routers/projects.py` | Add archived status guard to bulk save, status change, layer operations |
| `backend/app/services/condition_service.py` | Add status check in save function |
| `backend/app/services/backbone_service.py` | Add status check in replace function |
| `backend/app/services/recipe_service.py` | Add status check in apply function |

**Approach**: Create a reusable guard function:
```python
async def _ensure_editable(db: AsyncSession, project_id: int) -> Project:
    """Ensure project exists and is in an editable state (draft only)."""
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    if project.status in ('archived', 'approved', 'review'):
        raise HTTPException(403, f"Cannot modify project in '{project.status}' status")
    return project
```

#### M2.4: Version History API

**Goal**: Provide version history endpoint

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `backend/app/services/project_service.py` | Add `get_product_revisions()` function |
| `backend/app/routers/projects.py` or `backend/app/routers/products.py` | Add `GET /api/products/{productId}/revisions` endpoint |
| `backend/app/schemas/project.py` | Add `RevisionItem`, `RevisionListResponse` schemas |

#### M2.5: Backend Tests

**Goal**: Test coverage for revision feature

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `backend/tests/test_revision.py` (new) | Revision creation tests |

**Test Cases**:
- `test_revise_approved_project_creates_new_draft`
- `test_revise_sets_original_to_archived`
- `test_revise_increments_revision_number`
- `test_revise_copies_layers_with_correct_backbone_conditions`
- `test_revise_non_approved_project_returns_400`
- `test_revise_with_existing_active_project_returns_409`
- `test_archived_project_cannot_be_saved`
- `test_archived_project_cannot_change_status`
- `test_version_history_returns_all_revisions`

---

### M3: Revision Frontend (Sprint 2.5)

**Priority**: High
**Dependencies**: M2 (backend APIs must exist)

#### M3.1: API Client and Hooks

**Goal**: Frontend API integration for revision features

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `frontend/src/api/client.ts` | Add `reviseProject()` and `getProductRevisions()` API functions |
| `frontend/src/hooks/useProjects.ts` | Add `useReviseProject` mutation and `useProductRevisions` query hooks |
| `frontend/src/types/index.ts` | Add `ReviseProjectRequest`, `RevisionItem`, `RevisionListResponse` types |

#### M3.2: Revision Creation UI

**Goal**: Button and modal for creating revisions

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `frontend/src/components/editor/EditorHeader.tsx` | Add "Create Revision" button (visible when Approved) |
| `frontend/src/components/editor/RevisionCreateModal.tsx` (new) | Revision creation confirmation modal |
| `frontend/src/pages/ConditionEditorPage.tsx` | Wire modal state and handler |

#### M3.3: Project List Version Display

**Goal**: Show version information in project list

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `frontend/src/pages/ProjectListPage.tsx` | Add version column, version history link |
| `frontend/src/components/projects/VersionHistoryModal.tsx` (new) | Version history panel/modal |

**Approach**:
1. Add "Version" column between product name and backbone columns
2. Display `v{revision}` text
3. When `revision > 1`, show small "v1, v2..." link below
4. Clicking link opens version history modal

#### M3.4: Archived Status UI

**Goal**: Handle archived projects in the UI

**File Modifications**:
| File | Change Description |
|------|-------------------|
| `frontend/src/components/projects/StatusBadge.tsx` | Add `archived` variant styling |
| `frontend/src/pages/ConditionEditorPage.tsx` | Add read-only mode for archived/approved projects |
| `frontend/src/pages/ProjectListPage.tsx` | Add `archived` filter option (or keep hidden from list since `is_latest=False`) |

---

### M4: Integration and Testing

**Priority**: High
**Dependencies**: M1, M2, M3

#### M4.1: Integration Testing

- End-to-end test: Create project -> Approve -> Create revision -> Edit -> Approve v2
- Cross-field validation: Edit condition column -> verify dependent columns re-validated
- Archived protection: Attempt to edit archived project -> verify rejection
- Version history: Create multiple revisions -> verify history list

#### M4.2: Bug Fixes and Polish

- Fix any UI inconsistencies discovered during integration
- Verify StatusBadge renders correctly for all states
- Ensure navigation between version history and project editor works smoothly
- Verify auto-save is disabled for non-draft projects

---

## File Modification Plan (Complete)

### Backend Files

| File | Sprint | Action | Lines Affected |
|------|--------|--------|---------------|
| `backend/app/services/validation_service.py` | 2.4 | Modify | ~66-94 (refactor `_validate_conditional_required`) |
| `backend/app/services/project_service.py` | 2.5 | Modify | Add `revise_project()`, `get_product_revisions()` functions |
| `backend/app/schemas/project.py` | 2.5 | Modify | Add `ReviseProjectRequest`, `RevisionItem`, `RevisionListResponse` |
| `backend/app/routers/projects.py` | 2.5 | Modify | Add `POST /revise`, archived guards |
| `backend/app/services/condition_service.py` | 2.5 | Modify | Add archived status check |
| `backend/app/services/backbone_service.py` | 2.5 | Modify | Add archived status check |
| `backend/app/services/recipe_service.py` | 2.5 | Modify | Add archived status check |
| `backend/tests/test_validation_service.py` | 2.4 | Modify | Add 5+ test cases |
| `backend/tests/test_revision.py` | 2.5 | New | ~150 lines |

### Frontend Files

| File | Sprint | Action | Lines Affected |
|------|--------|--------|---------------|
| `frontend/src/lib/validation.ts` | 2.4 | Modify | Refactor conditional_required case, add `buildConditionDependencyMap()` |
| `frontend/src/pages/ConditionEditorPage.tsx` | 2.4, 2.5 | Modify | Cross-field re-validation, revision modal wiring, read-only mode |
| `frontend/src/components/admin/ValidationEditModal.tsx` | 2.4 | Modify | Add operator dropdown |
| `frontend/src/components/editor/EditorHeader.tsx` | 2.5 | Modify | Add revision button |
| `frontend/src/components/editor/RevisionCreateModal.tsx` | 2.5 | New | ~100 lines |
| `frontend/src/components/projects/VersionHistoryModal.tsx` | 2.5 | New | ~120 lines |
| `frontend/src/components/projects/StatusBadge.tsx` | 2.5 | Modify | Add archived variant |
| `frontend/src/pages/ProjectListPage.tsx` | 2.5 | Modify | Add version column |
| `frontend/src/api/client.ts` | 2.5 | Modify | Add 2 API functions |
| `frontend/src/hooks/useProjects.ts` | 2.5 | Modify | Add mutation and query hooks |
| `frontend/src/types/index.ts` | 2.5 | Modify | Add revision-related types |
| `frontend/src/lib/__tests__/validation.test.ts` | 2.4 | Modify | Add 5+ test cases |

---

## Risk Analysis

### R1: Cross-Field Validation Performance

**Risk**: Building and consulting the dependency map on every cell change could slow down the grid
**Likelihood**: Low
**Impact**: Medium (UI lag during editing)
**Mitigation**: Memoize the dependency map with `useMemo`. The map only changes when column definitions change, which is rare during an editing session. The re-validation itself is lightweight (in-memory string comparisons).

### R2: Revision Transaction Integrity

**Risk**: Concurrent revision creation requests could create duplicate versions
**Likelihood**: Low (single-user editing typical)
**Impact**: High (data integrity issue)
**Mitigation**: Use database-level constraints:
1. The existing active project check in `revise_project()` within a transaction
2. Consider adding a DB-level partial unique index: `UNIQUE(product_id) WHERE status IN ('draft','review')` as extra safety

### R3: Deep Copy Memory Usage

**Risk**: Large condition tables (~300 columns x 60 layers) could consume significant memory during deep copy
**Likelihood**: Low
**Impact**: Low (conditions stored as JSONB, individual row size is moderate)
**Mitigation**: Use `copy.deepcopy()` which is already used in `create_project`. The data size per project_layer is typically a single JSONB document with ~300 key-value pairs, well within acceptable memory limits.

### R4: Backward Compatibility of Operator Field

**Risk**: Existing conditional_required rules lack the `operator` field in their `rule_config`
**Likelihood**: Certain (existing rules do not have operator field)
**Impact**: Low (if not handled, validation would break)
**Mitigation**: Default to `"equals"` when operator is missing. Both backend and frontend implementations must handle this default case. Existing seed data and admin-created rules will continue working without migration.

### R5: Frontend State Complexity

**Risk**: Managing cross-field validation state alongside dirty cells, recipe cells, and existing validation could introduce subtle bugs
**Likelihood**: Medium
**Impact**: Medium (incorrect validation errors displayed)
**Mitigation**: Ensure re-validation uses the latest conditions (base conditions merged with dirty cell values). Add integration tests that simulate multi-cell editing scenarios.

---

## Architecture Design Direction

### Validation Layer Enhancement

The validation enhancement follows the existing architecture pattern:
- **Backend**: Stateless validation in `validation_service.py` -- add operator dispatch without changing the function signature
- **Frontend**: Stateless validation in `validation.ts` -- mirror backend logic exactly
- **Cross-field trigger**: New logic in the page component, leveraging existing validation utility

### Revision Feature Architecture

The revision feature leverages the pre-existing model fields (`revision`, `parent_project_id`, `is_latest`):
- **Service layer**: New `revise_project()` follows the same pattern as `create_project()` (transaction-based, deep-copy)
- **API layer**: Thin router endpoint calling service
- **Frontend**: New modal components following existing modal patterns (e.g., `ProjectCreateModal`, `BackboneReplaceModal`)
- **State management**: No new Zustand store needed; revision operations use React Query mutations

### Read-Only Mode Strategy

For archived and approved projects:
- Backend: Guard functions at service/router level
- Frontend: `isDraft` check already exists in `ConditionEditorPage.tsx:49` and controls save button visibility
- Extend to cover: backbone replace, layer add/delete, recipe upload buttons
- Grid cells: Set `editable: false` in AG Grid column definitions when not in draft status
