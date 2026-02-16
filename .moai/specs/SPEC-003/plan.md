# SPEC-003: Implementation Plan

**SPEC ID**: SPEC-003
**Title**: Approval Workflow and Review Comments
**Phase**: Phase 3 (Workflow & Output)
**Status**: Planned

---

## 1. Implementation Strategy

### 1.1 Approach

This SPEC follows the existing PCM architecture pattern (Router -> Service -> Model) for the backend, and the component-based architecture (Pages -> Components -> Hooks -> API -> Stores) for the frontend.

The implementation is structured in three milestones, ordered by dependency:
1. Backend foundation (API + services) must be complete before frontend integration
2. Frontend workflow UI (read-only mode, status transitions) can proceed once APIs exist
3. Comment UI (markers, panels, context menus) is the most complex frontend work and depends on both the backend comment API and the frontend workflow state

### 1.2 Technical Approach

**Backend**:
- Enhance existing `project_service` for status transition validation logic
- Create new `comment_service` for comment CRUD operations
- Add new `comments` router with nested project routes
- Alembic migration to add columns to `review_comments` table
- Reuse existing `validation_service.validate_project()` for pre-review checks
- Reuse existing change_log data for change summary computation

**Frontend**:
- Extend `ConditionEditorPage` with read-only mode and status-based UI switching
- Create new Zustand store for comment UI state (panel visibility, selected comment, navigation target)
- Use React Query for comment server state (list, create, update, delete mutations)
- AG Grid custom `cellRenderer` for comment markers (red triangle overlay)
- AG Grid `getContextMenuItems` callback for right-click comment creation

**Database**:
- Single Alembic migration adding 3 columns to `review_comments`
- No new tables required
- Existing `project_status_logs` table used as-is

---

## 2. Milestones

### Milestone 1: Backend Core (Primary Goal)

**Scope**: Database migration, status transition enhancement, comment CRUD API, backend tests.

**Dependencies**: None (builds on existing Phase 2 infrastructure).

**Tasks**:

| # | Task | Files | Description |
|---|------|-------|-------------|
| 1.1 | Alembic migration | `alembic/versions/004_*.py` | Add `comment_type`, `resolved_by`, `project_id` columns to `review_comments` |
| 1.2 | Update ReviewComment model | `models/change_log.py` | Add new mapped columns to the SQLAlchemy model |
| 1.3 | Comment Pydantic schemas | `schemas/comment.py` (new) | `CommentCreate`, `CommentUpdate`, `CommentResponse`, `CommentListResponse` |
| 1.4 | Status transition schemas | `schemas/project.py` (modify) | `StatusTransitionRequest`, `StatusTransitionResponse`, `ChangeSummaryResponse`, `StatusHistoryResponse` |
| 1.5 | Comment service | `services/comment_service.py` (new) | CRUD operations with ownership checks, targeting validation, archived project guard |
| 1.6 | Status transition enhancement | `services/project.py` (modify) | Add validation check, role check, comment check to status transition logic |
| 1.7 | Change summary service | `services/project.py` (modify) | Aggregate change_logs for change summary endpoint |
| 1.8 | Comment router | `routers/comments.py` (new) | POST, GET, PATCH, DELETE endpoints for comments |
| 1.9 | Status history endpoint | `routers/projects.py` (modify) | GET /status-history endpoint |
| 1.10 | Change summary endpoint | `routers/projects.py` (modify) | GET /change-summary endpoint |
| 1.11 | Register comment router | `main.py` (modify) | Include comments router in FastAPI app |
| 1.12 | Approval workflow tests | `tests/test_approval_workflow.py` (new) | 10+ test cases for status transitions |
| 1.13 | Comment service tests | `tests/test_comment_service.py` (new) | 13+ test cases for comment CRUD |

**Completion Criteria**:
- All status transition rules enforced server-side
- Comment CRUD API functional with proper validation
- Change summary and status history endpoints working
- All backend tests passing with 85%+ coverage on new code

---

### Milestone 2: Frontend Workflow UI (Secondary Goal)

**Scope**: Read-only mode, status banner, review request modal, approval/rejection buttons, status timeline.

**Dependencies**: Milestone 1 (backend APIs must be available).

**Tasks**:

| # | Task | Files | Description |
|---|------|-------|-------------|
| 2.1 | Comment TypeScript types | `types/comment.ts` (new) | Comment, CommentCreate, CommentUpdate, CommentListResponse interfaces |
| 2.2 | Comment API client | `api/comments.ts` (new) | Axios functions for comment CRUD + status history + change summary |
| 2.3 | Status transition hooks | `hooks/useStatusTransition.ts` (new) | React Query mutation hooks for status changes |
| 2.4 | Change summary hook | `hooks/useChangeSummary.ts` (new) | React Query query hook for change summary data |
| 2.5 | Status banner component | `components/editor/StatusBanner.tsx` (new) | Visual status indicator with per-status styling and messaging |
| 2.6 | Read-only mode logic | `pages/ConditionEditorPage.tsx` (modify) | Disable AG Grid editing for review/approved/archived status, hide save/recipe/backbone buttons |
| 2.7 | Read-only mode in grid | `components/editor/ConditionGrid.tsx` (modify) | Pass `editable: false` to AG Grid based on project status |
| 2.8 | Review Request Modal | `components/editor/ReviewRequestModal.tsx` (new) | Summary modal with validation result, change summary, memo field |
| 2.9 | Approval buttons | `components/editor/ApprovalButtons.tsx` (new) | Approve/Reject buttons visible for reviewer in Review state |
| 2.10 | Status timeline | `components/editor/StatusTimeline.tsx` (new) | Chronological status transition display |
| 2.11 | Editor toolbar integration | `components/editor/EditorToolbar.tsx` (modify) | Add Review Request button (Draft), Approve/Reject buttons (Review) |

**Completion Criteria**:
- AG Grid properly read-only in review/approved/archived states
- Review request modal shows accurate validation and change data
- Approve/Reject buttons functional with proper role-based visibility
- Status banner and timeline display correctly
- Save, Recipe Upload, Backbone Replace buttons hidden in non-editable states

---

### Milestone 3: Comment UI + Post-Rejection Flow (Final Goal)

**Scope**: Comment markers, context menu, comment panel, post-rejection highlights, comment resolution.

**Dependencies**: Milestone 1 (comment API) and Milestone 2 (read-only mode, status integration).

**Tasks**:

| # | Task | Files | Description |
|---|------|-------|-------------|
| 3.1 | Comment Zustand store | `stores/commentStore.ts` (new) | Panel visibility, selected comment, cell navigation target, comment data cache |
| 3.2 | Comment hooks | `hooks/useComments.ts` (new) | React Query hooks for list, create, update, delete comments |
| 3.3 | Comment marker renderer | `components/editor/CommentMarkerRenderer.tsx` (new) | AG Grid cellRenderer that overlays red triangle on cells with comments |
| 3.4 | Comment marker integration | `components/editor/ConditionGrid.tsx` (modify) | Apply comment marker renderer to cells, add comment data to grid context |
| 3.5 | Context menu integration | `components/editor/ConditionGrid.tsx` (modify) | Add "Add Comment" to AG Grid context menu for reviewer in Review state |
| 3.6 | Comment dialog | `components/editor/CommentDialog.tsx` (new) | Add/edit comment dialog with layer/column pre-fill from cell context |
| 3.7 | Comment panel | `components/editor/CommentPanel.tsx` (new) | List comments with filters, navigation to cells, resolve/delete actions |
| 3.8 | Cell navigation | `components/editor/CommentPanel.tsx` | Click comment -> switch category tab, scroll to row/column in AG Grid |
| 3.9 | Comment tooltip | `components/editor/CellRenderer.tsx` (modify) | Hover tooltip showing comment count and latest comment preview |
| 3.10 | Post-rejection view | `pages/ConditionEditorPage.tsx` (modify) | Load rejection comments, apply red highlight styling to commented cells |
| 3.11 | Comment resolution workflow | `components/editor/CommentPanel.tsx` | Resolve button for editor, resolved styling, unresolved-first sorting |
| 3.12 | Frontend utility tests | `tests/` (new) | Tests for comment targeting validation, status transition logic |

**Completion Criteria**:
- Red triangle markers visible on cells with unresolved comments
- Right-click context menu creates comments pre-filled with cell position
- Comment panel displays comments grouped by resolution status
- Clicking comment navigates to correct cell (including tab switching)
- Post-rejection view shows comment highlights with resolution workflow
- Comment tooltip shows count and preview on hover

---

## 3. Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| AG Grid Community cellRenderer limitations | Cannot render comment markers as expected | Low | Test marker rendering early in Milestone 3; fallback to column-level indicators |
| AG Grid context menu customization limits | Cannot add custom context menu items | Low | AG Grid Community supports `getContextMenuItems`; verify with version 32.3.3 |
| Complex cell navigation across category tabs | Comment click may not switch tabs correctly | Medium | Build tab switching into the comment store; test with cross-tab navigation early |
| Concurrent comment creation conflicts | Two reviewers add comments simultaneously | Low | React Query's refetch-on-mutation handles this; no optimistic updates for comments |
| Migration impacts existing data | Adding columns to review_comments breaks existing rows | Low | All new columns have defaults or are nullable; existing rows unaffected |
| Status transition race conditions | Two users trigger status change simultaneously | Low | Database-level status check within transaction; last writer wins with proper validation |

---

## 4. Architecture Decisions

### 4.1 Comment Router Placement

**Decision**: Create a separate `routers/comments.py` with nested route under projects (`/api/projects/{id}/comments`).

**Rationale**: Comments are a distinct domain from project CRUD. Separating the router keeps project router manageable (already has backbone, recipe, revise, status endpoints). The nested route maintains the resource hierarchy.

**Alternative Considered**: Extending `routers/projects.py` with comment endpoints. Rejected because the projects router is already large and comments have distinct CRUD lifecycle.

### 4.2 Rejection State Handling

**Decision**: Rejection is a transient event. Project status moves from `review` to `rejected` to `draft` in a single transaction, with two status log entries.

**Rationale**: The PRD specifies "After rejection: status returns to Draft so editor can fix issues." A persistent `rejected` state would require additional UI states and transitions. The dual-log approach preserves audit trail while keeping the workflow simple.

**Alternative Considered**: Persistent `rejected` status with explicit Draft transition. Rejected because it adds workflow complexity without business benefit (editor always needs to return to editing mode).

### 4.3 Comment State Management

**Decision**: Use Zustand for comment UI state (panel visibility, selected comment) and React Query for comment server state (list, mutations).

**Rationale**: This follows the existing PCM pattern (Zustand for client state, React Query for server state). Comment UI state (which comment is selected, panel open/closed) is ephemeral and local, while comment data needs cache invalidation and refetching.

### 4.4 Comment Markers in AG Grid

**Decision**: Use AG Grid custom `cellRenderer` with CSS-based red triangle overlay.

**Rationale**: AG Grid Community supports custom cell renderers. The red triangle (CSS `::after` pseudo-element with border-based triangle) is lightweight and does not require additional DOM elements. Comment data is passed via AG Grid's `context` or `cellRendererParams`.

**Implementation Approach**:
```
- Build a Map<string, number> of (layerId:columnName -> commentCount) from comment data
- Pass this map to AG Grid via `context` prop
- In cellRenderer, check if current cell has comments
- If yes, render the base cell content + red triangle overlay
```

---

## 5. File Impact Summary

### 5.1 New Backend Files (7)

| File | Purpose |
|---|---|
| `backend/app/routers/comments.py` | Comment CRUD API endpoints |
| `backend/app/services/comment_service.py` | Comment business logic |
| `backend/app/schemas/comment.py` | Comment Pydantic schemas |
| `backend/alembic/versions/004_add_review_comment_columns.py` | DB migration |
| `backend/tests/test_approval_workflow.py` | Status transition tests |
| `backend/tests/test_comment_service.py` | Comment CRUD tests |

### 5.2 Modified Backend Files (5)

| File | Changes |
|---|---|
| `backend/app/models/change_log.py` | Add 3 columns to ReviewComment model |
| `backend/app/routers/projects.py` | Enhance status transition, add status-history and change-summary endpoints |
| `backend/app/services/project.py` | Add validation/role/comment checks to status transition |
| `backend/app/schemas/project.py` | Add status transition and change summary schemas |
| `backend/app/main.py` | Register comments router |

### 5.3 New Frontend Files (12)

| File | Purpose |
|---|---|
| `frontend/src/types/comment.ts` | Comment TypeScript interfaces |
| `frontend/src/api/comments.ts` | Comment API client |
| `frontend/src/hooks/useComments.ts` | Comment React Query hooks |
| `frontend/src/hooks/useStatusTransition.ts` | Status transition hooks |
| `frontend/src/hooks/useChangeSummary.ts` | Change summary hook |
| `frontend/src/stores/commentStore.ts` | Comment UI Zustand store |
| `frontend/src/components/editor/StatusBanner.tsx` | Status indicator banner |
| `frontend/src/components/editor/ReviewRequestModal.tsx` | Review request modal |
| `frontend/src/components/editor/ApprovalButtons.tsx` | Approve/Reject buttons |
| `frontend/src/components/editor/CommentPanel.tsx` | Comment list panel |
| `frontend/src/components/editor/CommentMarkerRenderer.tsx` | Cell comment marker |
| `frontend/src/components/editor/CommentDialog.tsx` | Comment add/edit dialog |
| `frontend/src/components/editor/StatusTimeline.tsx` | Status history timeline |

### 5.4 Modified Frontend Files (4)

| File | Changes |
|---|---|
| `frontend/src/pages/ConditionEditorPage.tsx` | Read-only mode, status banner, comment integration, post-rejection highlights |
| `frontend/src/components/editor/ConditionGrid.tsx` | Comment markers, context menu, editable toggle |
| `frontend/src/components/editor/EditorToolbar.tsx` | Review request button, conditional button visibility |
| `frontend/src/components/editor/CellRenderer.tsx` | Comment tooltip overlay |

### 5.5 Total File Count

- **New files**: 19 (7 backend + 12 frontend)
- **Modified files**: 9 (5 backend + 4 frontend)
- **Total affected**: 28 files

---

## 6. Expert Consultation Recommendations

This SPEC involves both backend and frontend implementation across multiple domains.

**Backend Consultation** (expert-backend):
- Status transition state machine design with proper validation sequencing
- Comment CRUD service with ownership authorization patterns
- Alembic migration strategy for existing table modifications
- Transaction handling for rejection (two status log entries in single transaction)

**Frontend Consultation** (expert-frontend):
- AG Grid Community cellRenderer patterns for comment markers
- AG Grid context menu integration for comment creation
- Zustand + React Query coordination for comment state
- Cell navigation across category tabs (tab switching + grid scroll)

These consultations are recommended at the start of `/moai:2-run SPEC-003` to validate the technical approach before implementation begins.
