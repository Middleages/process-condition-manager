# SPEC-003: Approval Workflow and Review Comments

**SPEC ID**: SPEC-003
**Title**: Approval Workflow and Review Comments
**Phase**: Phase 3 (Workflow & Output) - First SPEC
**Status**: Planned
**Priority**: High
**Created**: 2026-02-16

---

## 1. Overview

### 1.1 Purpose

This SPEC defines the complete approval workflow and review commenting system for PCM (Process Condition Manager). It covers the Draft -> Review -> Approved/Rejected status flow with server-side validation enforcement, role-based approval authority, cell-level commenting with position tracking, and post-rejection editing workflows.

### 1.2 Background

- PCM manages semiconductor Photo process condition tables with ~300 columns x 30-60 layers per product
- Phase 1 (MVP editing) and Phase 2 (data automation, revision) are complete
- SPEC-001 (Admin Settings) and SPEC-002 (Conditional Validation + Revision) are implemented
- The `PATCH /api/projects/{id}/status` endpoint exists but lacks validation checks, role enforcement, and comment requirements
- Database tables `project_status_logs` and `review_comments` already exist but `review_comments` needs additional columns
- The Project model already supports `draft`, `review`, `approved`, `rejected`, `archived` statuses
- The User model has `role` field with values: `editor`, `reviewer`, `admin`
- Phase 1 auth model uses dropdown user selection (no JWT) with `X-User-Id` header

### 1.3 Scope

**In Scope**:
- Status transition API enhancement with validation, role, and comment checks
- Review read-only mode in AG Grid
- Review request modal with validation summary and change statistics
- Comment CRUD API (create, list, update/resolve, delete) with cell/layer/project targeting
- Comment UI: cell markers, context menu, comment panel with navigation
- Approval and rejection UI for reviewers
- Post-rejection editor view with comment highlights and resolution workflow
- Status transition history recording and display

**Out of Scope**:
- Change history detailed panel and timeline (Phase 3, separate SPEC)
- Export/output functionality - Type A/B/C (Phase 3, separate SPEC)
- Real-time notifications for status changes (Phase 3, optional feature 3-11)
- JWT authentication (Phase 4)
- WebSocket-based real-time collaboration

### 1.4 Dependencies

| Dependency | Status | Impact |
|---|---|---|
| Project model with status/revision fields | Complete | Base for status transitions |
| User model with role field (editor/reviewer/admin) | Complete | Role-based approval control |
| ProjectStatusLog model (change_log.py) | Complete | Status transition recording |
| ReviewComment model (change_log.py) | Partial | Needs additional columns (see DB Changes) |
| PATCH /api/projects/{id}/status endpoint | Complete | Needs enhancement |
| Validation service (backend/app/services/validation.py) | Complete | Used for pre-review validation check |
| AG Grid condition editor | Complete | Needs read-only mode and comment markers |
| Zustand editor store | Complete | Needs comment state integration |

---

## 2. Environment

### 2.1 Current System State

- **Stack**: FastAPI 0.115.6 (Python 3.12) + React 18.3.1 (TypeScript 5.7.3) + PostgreSQL 16 + AG Grid Community 32.3.3
- **Auth**: Phase 1 dropdown user selection, user identification via `X-User-Id` header
- **Status flow**: Draft -> Review -> Approved -> (Revision) -> Archived, with Rejected returning to Draft
- **Existing models**: ProjectStatusLog records status changes; ReviewComment stores cell/layer comments

### 2.2 Existing Database Models

**ProjectStatusLog** (complete, no changes needed):
```
project_status_logs: id, project_id, from_status, to_status, changed_by, comment, changed_at
```

**ReviewComment** (needs additions):
```
review_comments: id, project_layer_id(FK), column_name, comment, is_resolved, created_by, created_at, resolved_at
```

### 2.3 Required DB Changes

The `review_comments` table needs three additional columns via Alembic migration:

| Column | Type | Default | Description |
|---|---|---|---|
| `comment_type` | VARCHAR(20) | `'general'` | Comment classification: `'rejection'`, `'general'` |
| `resolved_by` | INTEGER FK users(id) | NULL | User who resolved the comment |
| `project_id` | INTEGER FK projects(id) | NULL | For project-level comments (no specific layer/cell) |

**Migration rationale**:
- `comment_type` distinguishes reviewer rejection comments from general feedback
- `resolved_by` tracks who resolved each comment for auditability
- `project_id` enables project-level comments without requiring a layer target. When `project_id` is set and `project_layer_id` is NULL, the comment applies to the entire project.

**Note**: The existing `project_layer_id` foreign key constraint uses `ondelete="CASCADE"`. Project-level comments use `project_id` instead, so `project_layer_id` must become nullable (it already is nullable in the current schema but enforced at the application level).

---

## 3. Assumptions

1. The existing `PATCH /api/projects/{id}/status` endpoint will be enhanced in-place rather than replaced
2. Server-side validation for Review transition reuses the existing `validation_service.validate_project()` function
3. "Reviewer" role check in Phase 1 uses the `user.role` field; any user with role `reviewer` or `admin` can approve/reject
4. Rejected status automatically reverts to Draft -- there is no separate "Rejected" state that persists; rejection triggers immediate Draft reversion with status log recording the rejection event
5. Comments created during Review state persist through status transitions (not auto-deleted on approval/rejection)
6. Comment resolution is a soft state change (marks `is_resolved=True`) rather than deletion
7. AG Grid Community Edition supports custom cell renderers for comment markers and context menu integration
8. Project-level comments (no layer/cell target) are supported for general feedback
9. The change summary in the Review Request Modal is computed from `change_logs` table data
10. Multiple comments can exist on the same cell; each is tracked independently

---

## 4. Requirements

### Feature 1: Status Transition API Enhancement

**REQ-001** (Event-Driven): **When** an editor requests a transition from Draft to Review, **then** the system **shall** execute server-side validation on all project layers and reject the transition with a 400 error if any validation errors exist, returning the error count and details.

**REQ-002** (Event-Driven): **When** a user requests a transition from Review to Approved, **then** the system **shall** verify that the requesting user has `reviewer` or `admin` role and reject with 403 if the user has `editor` role.

**REQ-003** (Event-Driven): **When** a reviewer requests a transition from Review to Rejected, **then** the system **shall** verify that at least one unresolved comment exists for the project and reject with 400 if no comments exist, returning an error message indicating that rejection requires at least one comment.

**REQ-004** (Event-Driven): **When** any status transition occurs successfully, **then** the system **shall** create a record in `project_status_logs` with the project ID, from-status, to-status, user ID, optional comment, and timestamp.

**REQ-005** (Event-Driven): **When** a project is rejected, **then** the system **shall** set the project status back to `draft` so the editor can make corrections, while the `project_status_logs` records the full transition path (review -> rejected -> draft).

**REQ-006** (Unwanted): The system **shall not** allow status transitions that violate the workflow rules:
- Draft can only transition to Review
- Review can only transition to Approved or Rejected (which goes to Draft)
- Approved can only transition to Archived (via revision)
- Archived cannot transition to any status

### Feature 2: Review Read-only Mode

**REQ-007** (State-Driven): **While** a project has status `review` or `approved`, the AG Grid condition editor **shall** disable all cell editing, preventing any data modification.

**REQ-008** (Ubiquitous): The system **shall** display a prominent status banner at the top of the editor page showing the current project status with distinct visual styling per status (Draft=blue, Review=orange, Approved=green, Rejected=red, Archived=gray).

**REQ-009** (State-Driven): **While** a project is in `review` or `approved` status, the system **shall** hide the Save button, auto-save functionality, Recipe Upload button, and Backbone Replace button.

### Feature 3: Review Request Modal

**REQ-010** (Event-Driven): **When** an editor clicks the "Review Request" button (visible only in Draft status), **then** the system **shall** display a summary modal containing:
- Validation result (must show 0 errors to proceed)
- Change summary: changed layers count, changed cells count, backbone replacements count, recipe applications count
- Optional memo text field for the reviewer

**REQ-011** (Unwanted): The system **shall not** enable the "Submit Review Request" button in the modal if validation errors exist; the button remains disabled with a message indicating errors must be resolved first.

**REQ-012** (Event-Driven): **When** the editor confirms the review request, **then** the system **shall** call `PATCH /api/projects/{id}/status` with `new_status: "review"` and the optional memo as the status log comment.

### Feature 4: Comment CRUD API

**REQ-013** (Event-Driven): **When** a user creates a comment via `POST /api/projects/{id}/comments`, **then** the system **shall** store the comment with the following targeting options:
- Project-level: only `project_id` set, `project_layer_id` and `column_name` are null
- Layer-level: `project_layer_id` set, `column_name` is null
- Cell-level: both `project_layer_id` and `column_name` set

**REQ-014** (Event-Driven): **When** a user retrieves comments via `GET /api/projects/{id}/comments`, **then** the system **shall** return all comments for the project with position information (layer name, column display name), commenter details (user name, role), and resolution status.

**REQ-015** (Event-Driven): **When** a user updates a comment via `PATCH /api/projects/{id}/comments/{commentId}`, **then** the system **shall** support updating the comment content and/or marking it as resolved (setting `is_resolved=True`, `resolved_by`, and `resolved_at`).

**REQ-016** (Event-Driven): **When** a user deletes a comment via `DELETE /api/projects/{id}/comments/{commentId}`, **then** the system **shall** remove the comment record and return 204 No Content.

**REQ-017** (Unwanted): The system **shall not** allow creating comments on projects with `archived` status.

**REQ-018** (Unwanted): The system **shall not** allow a user to resolve or delete comments created by other users, except for users with `admin` role.

### Feature 5: Comment UI

**REQ-019** (Event-Driven): **When** a user right-clicks a cell while the project is in `review` status and the user has `reviewer` or `admin` role, **then** the AG Grid context menu **shall** include an "Add Comment" option that opens a comment creation dialog pre-filled with the cell's layer and column information.

**REQ-020** (Ubiquitous): The system **shall** display a red triangle marker in the top-right corner of any AG Grid cell that has one or more unresolved comments, using a custom AG Grid `cellRenderer`.

**REQ-021** (Event-Driven): **When** a user clicks on a comment in the comment panel, **then** the system **shall** navigate the AG Grid to the commented cell's position (switching category tab if needed, scrolling to the row and column).

**REQ-022** (Event-Driven): **When** a user hovers over a cell with comment markers, **then** the system **shall** display a tooltip showing the comment count and a preview of the latest comment.

### Feature 6: Approval/Rejection UI

**REQ-023** (State-Driven): **While** a project is in `review` status and the current user has `reviewer` or `admin` role, the editor header **shall** display "Approve" and "Reject" action buttons.

**REQ-024** (Event-Driven): **When** a reviewer clicks "Approve", **then** the system **shall** call the status transition API with `new_status: "approved"` and on success, display a success message and refresh the page to show approved status.

**REQ-025** (Event-Driven): **When** a reviewer clicks "Reject", **then** the system **shall** verify at least one unresolved comment exists before proceeding. If no comments exist, display an error message prompting the reviewer to add at least one comment before rejecting.

**REQ-026** (Event-Driven): **When** rejection is confirmed with existing comments, **then** the system **shall** call the status transition API with `new_status: "rejected"`, and on success, the project returns to Draft status for the editor.

### Feature 7: Post-Rejection Editor View

**REQ-027** (Event-Driven): **When** a project returns to Draft from a rejection, **then** the editor view **shall** display all rejection comments with red highlights on the commented cells, showing a visual indicator that these cells need attention.

**REQ-028** (Event-Driven): **When** an editor resolves a rejection comment after making corrections, **then** the system **shall** mark the comment as resolved (`is_resolved=True`) with the editor's user ID and timestamp, without deleting the comment.

**REQ-029** (State-Driven): **While** a project in Draft status has unresolved rejection comments, the comment panel **shall** display unresolved comments prominently at the top with a distinct "Needs Attention" styling.

### Feature 8: Status Transition History

**REQ-030** (Ubiquitous): The system **shall** record every status transition in the `project_status_logs` table with from-status, to-status, user ID, optional comment, and server timestamp.

**REQ-031** (Event-Driven): **When** a user views the project detail page, **then** the system **shall** display a status transition timeline showing all historical status changes in chronological order, with each entry showing the transition direction, user name, timestamp, and any associated comment.

---

## 5. API Specifications

### 5.1 Status Transition Enhancement

**PATCH /api/projects/{id}/status** (existing, enhanced)

Request Body:
```json
{
  "new_status": "review" | "approved" | "rejected",
  "changed_by": 1,
  "comment": "Optional memo or rejection reason"
}
```

Enhanced Logic:
- **Draft -> Review**: Run `validation_service.validate_project(project_id)`. If errors > 0, return 400 with `{"detail": "Cannot submit for review: {n} validation errors found", "error_count": n}`.
- **Review -> Approved**: Check `changed_by` user role. If not `reviewer` or `admin`, return 403 with `{"detail": "Only reviewers can approve projects"}`.
- **Review -> Rejected**: Check unresolved comment count for project. If 0, return 400 with `{"detail": "At least one comment is required for rejection"}`. On success, set project status to `draft` and record two status log entries: `review -> rejected` and `rejected -> draft`.
- **Invalid transitions**: Return 400 with `{"detail": "Invalid status transition from {current} to {requested}"}`.

Response 200:
```json
{
  "id": 1,
  "status": "review",
  "previous_status": "draft",
  "changed_by": 1,
  "changed_at": "2026-02-16T10:00:00Z"
}
```

### 5.2 Comment CRUD Endpoints

Router prefix: `/api/projects/{project_id}/comments`

#### POST /api/projects/{project_id}/comments

Create a new comment.

Request Body:
```json
{
  "user_id": 2,
  "project_layer_id": 5,
  "column_name": "SP_PREBAKE_TEMP_C",
  "content": "Temperature value needs verification",
  "comment_type": "rejection"
}
```

Fields:
- `user_id` (required): Comment author
- `project_layer_id` (optional): Target layer. Null = project-level comment
- `column_name` (optional): Target column. Null = layer-level comment. Requires `project_layer_id`
- `content` (required): Comment text, max 2000 chars
- `comment_type` (optional, default `"general"`): `"rejection"` or `"general"`

Response 201:
```json
{
  "id": 10,
  "project_id": 1,
  "project_layer_id": 5,
  "layer_name": "AA_PHOTO",
  "column_name": "SP_PREBAKE_TEMP_C",
  "column_display_name": "Prebake Temp (C)",
  "content": "Temperature value needs verification",
  "comment_type": "rejection",
  "is_resolved": false,
  "created_by": 2,
  "creator_name": "Park Engineer",
  "creator_role": "reviewer",
  "created_at": "2026-02-16T10:30:00Z",
  "resolved_at": null,
  "resolved_by": null,
  "resolver_name": null
}
```

Error 400: Invalid targeting (column_name without project_layer_id).
Error 403: Attempting to comment on archived project.

#### GET /api/projects/{project_id}/comments

List all comments for a project.

Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| is_resolved | boolean | No | Filter by resolution status |
| comment_type | string | No | Filter by type: `rejection`, `general` |
| project_layer_id | integer | No | Filter by specific layer |

Response 200:
```json
{
  "comments": [
    {
      "id": 10,
      "project_id": 1,
      "project_layer_id": 5,
      "layer_name": "AA_PHOTO",
      "column_name": "SP_PREBAKE_TEMP_C",
      "column_display_name": "Prebake Temp (C)",
      "content": "Temperature value needs verification",
      "comment_type": "rejection",
      "is_resolved": false,
      "created_by": 2,
      "creator_name": "Park Engineer",
      "creator_role": "reviewer",
      "created_at": "2026-02-16T10:30:00Z",
      "resolved_at": null,
      "resolved_by": null,
      "resolver_name": null
    }
  ],
  "total": 1,
  "unresolved_count": 1
}
```

#### PATCH /api/projects/{project_id}/comments/{comment_id}

Update or resolve a comment.

Request Body:
```json
{
  "content": "Updated comment text",
  "is_resolved": true,
  "resolved_by": 1
}
```

All fields are optional. Setting `is_resolved: true` requires `resolved_by`.

Response 200: Updated comment object (same shape as create response).
Error 403: Attempting to modify another user's comment (non-admin).
Error 404: Comment not found.

#### DELETE /api/projects/{project_id}/comments/{comment_id}

Delete a comment.

Response 204: No content.
Error 403: Attempting to delete another user's comment (non-admin).
Error 404: Comment not found.

### 5.3 Status Transition History

**GET /api/projects/{project_id}/status-history**

Returns all status transitions for a project.

Response 200:
```json
{
  "history": [
    {
      "id": 3,
      "from_status": "review",
      "to_status": "approved",
      "changed_by": 2,
      "changer_name": "Park Engineer",
      "comment": null,
      "changed_at": "2026-02-17T14:00:00Z"
    },
    {
      "id": 2,
      "from_status": "draft",
      "to_status": "review",
      "changed_by": 1,
      "changer_name": "Kim Engineer",
      "comment": "M1-M3 Energy values verified",
      "changed_at": "2026-02-16T10:00:00Z"
    },
    {
      "id": 1,
      "from_status": null,
      "to_status": "draft",
      "changed_by": 1,
      "changer_name": "Kim Engineer",
      "comment": "Project created",
      "changed_at": "2026-02-15T09:00:00Z"
    }
  ]
}
```

### 5.4 Change Summary (for Review Request Modal)

**GET /api/projects/{project_id}/change-summary**

Returns aggregated change statistics for the Review Request modal.

Response 200:
```json
{
  "validation_error_count": 0,
  "changed_layers_count": 8,
  "total_layers_count": 45,
  "changed_cells_count": 23,
  "backbone_replacements_count": 3,
  "recipe_applications_count": 2
}
```

---

## 6. UI Specifications

### 6.1 Status Banner

Displayed at the top of the ConditionEditorPage, below the toolbar:

```
+--------------------------------------------------------------+
|  [Draft]  You can edit conditions. Save before requesting     |
|           review.                                             |
+--------------------------------------------------------------+
```

Status variants:
- **Draft** (blue): "You can edit conditions. Save before requesting review."
- **Review** (orange): "Under review. Editing is disabled."
- **Approved** (green): "Approved. This condition table is finalized."
- **Rejected** (red): "Rejected. Please review comments and make corrections."
- **Archived** (gray): "Archived (v{n}). This is a previous version."

### 6.2 Review Request Modal

```
+--------------------------------------------------------------+
|  Review Request                                               |
+--------------------------------------------------------------+
|                                                               |
|  Validation Result: 0 errors                                  |
|                                                               |
|  Change Summary:                                              |
|    - Changed layers: 8 / 45                                   |
|    - Changed cells: 23                                        |
|    - Backbone replacements: 3 layers                          |
|    - Recipe applications: 2 layers                            |
|                                                               |
|  Memo (optional):                                             |
|  +----------------------------------------------------------+|
|  | Please verify M1-M3 Energy values                         ||
|  +----------------------------------------------------------+|
|                                                               |
|              [Cancel]  [Submit Review Request]                |
+--------------------------------------------------------------+
```

### 6.3 Reviewer View (Review State)

```
+--------------------------------------------------------------+
|  PROD-2025A  Status: Review        Reviewer: Park Engineer    |
|  <- Back to list                    [Approve] [Reject]        |
+------+-------------------------------------------------------+
|      |  [SP] [SC] [OVL] [DEV]  |  Comments: 3 unresolved    |
|Layers|--------------------------------------------------------+
|      |                                                        |
|AA    |  (Read-only grid -- right-click cell to add comment)   |
|GATE  |  Yellow=changed, Green=recipe, Red=comment marker      |
|POLY  |                                                        |
+------+--------------------------------------------------------+
|  Comment Panel:                                               |
|  [!] AA_PHOTO > SP_PREBAKE_TEMP: "Temperature needs check"   |
|  [!] M1_PHOTO > SC_ENERGY: "5mJ difference from recipe"      |
|  [!] Project-level: "Please verify OVL specs overall"         |
+--------------------------------------------------------------+
```

### 6.4 Comment Panel

```
+--------------------------------------------------------------+
|  Comments                    [Filter: All / Unresolved]      |
+--------------------------------------------------------------+
|                                                               |
|  Unresolved (3):                                              |
|  +----------------------------------------------------------+|
|  | [!] AA_PHOTO > SP_PREBAKE_TEMP_C            [rejection]  ||
|  |     "Temperature value needs verification"                ||
|  |     By: Park Engineer (reviewer) - 2026-02-16 10:30      ||
|  |     [Navigate to cell]                                    ||
|  +----------------------------------------------------------+|
|  | [!] M1_PHOTO > SC_ENERGY                    [rejection]  ||
|  |     "5mJ difference from Recipe, please confirm"          ||
|  |     By: Park Engineer (reviewer) - 2026-02-16 10:35      ||
|  |     [Navigate to cell]  [Resolve]                         ||
|  +----------------------------------------------------------+|
|                                                               |
|  Resolved (1):                                                |
|  +----------------------------------------------------------+|
|  | [ok] GATE > SP_SPIN1_SPEED                  [general]    ||
|  |     "Speed looks high, is this intentional?"              ||
|  |     Resolved by: Kim Engineer - 2026-02-16 15:00          ||
|  +----------------------------------------------------------+|
+--------------------------------------------------------------+
```

### 6.5 Status Transition Timeline

```
+--------------------------------------------------------------+
|  Status History                                               |
+--------------------------------------------------------------+
|                                                               |
|  2026-02-17 14:00  Park Engineer                              |
|  Review -> Approved                                           |
|                                                               |
|  2026-02-16 10:00  Kim Engineer                               |
|  Draft -> Review                                              |
|  "M1-M3 Energy values verified"                               |
|                                                               |
|  2026-02-15 09:00  Kim Engineer                               |
|  Project Created (Draft)                                      |
|  "Backbone: PROD-2024X (45 layers)"                           |
+--------------------------------------------------------------+
```

---

## 7. Technical Architecture

### 7.1 Backend Structure

**New Files**:
```
backend/app/
  routers/
    comments.py                # Comment CRUD endpoints
  services/
    comment_service.py         # Comment business logic
  schemas/
    comment.py                 # Comment Pydantic schemas
```

**Modified Files**:
```
backend/app/
  models/
    change_log.py              # Add columns to ReviewComment model
  routers/
    projects.py                # Enhance status transition logic
  services/
    project.py                 # Add status validation, change summary
  schemas/
    project.py                 # Add StatusTransitionRequest/Response schemas
  main.py                      # Register comments router
```

**New Migration**:
```
backend/alembic/versions/
  004_add_review_comment_columns.py  # Add comment_type, resolved_by, project_id
```

**New Test Files**:
```
backend/tests/
  test_approval_workflow.py    # Status transition tests
  test_comment_service.py      # Comment CRUD tests
```

### 7.2 Frontend Structure

**New Files**:
```
frontend/src/
  components/editor/
    ReviewRequestModal.tsx      # Review request summary modal
    ApprovalButtons.tsx         # Approve/Reject buttons for reviewer
    CommentPanel.tsx            # Comment list panel with navigation
    CommentMarkerRenderer.tsx   # AG Grid cell renderer for comment markers
    CommentDialog.tsx           # Add/edit comment dialog
    StatusBanner.tsx            # Status indicator banner
    StatusTimeline.tsx          # Status transition history timeline
  api/
    comments.ts                # Comment API client functions
  hooks/
    useComments.ts             # React Query hooks for comments
    useStatusTransition.ts     # Status transition mutation hooks
    useChangeSummary.ts        # Change summary query hook
  stores/
    commentStore.ts            # Zustand store for comment UI state
  types/
    comment.ts                 # Comment TypeScript types
```

**Modified Files**:
```
frontend/src/
  pages/
    ConditionEditorPage.tsx    # Read-only mode, comment integration, status banner
  components/editor/
    ConditionGrid.tsx          # Comment markers, context menu, read-only mode
    EditorToolbar.tsx          # Review request button, approval buttons
    CellRenderer.tsx           # Comment marker overlay
  App.tsx                      # No new routes needed (comments are within editor page)
```

### 7.3 Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Comment storage | PostgreSQL (existing `review_comments` table) | Consistent with existing data model; adds minimal columns |
| Comment state management | Zustand + React Query | Zustand for UI state (selected comment, panel visibility), React Query for server state (comment list, mutations) |
| Cell comment markers | AG Grid custom `cellRenderer` | AG Grid Community supports custom cell renderers; red triangle overlay drawn via CSS |
| Context menu | AG Grid `getContextMenuItems` | AG Grid Community supports context menu customization |
| Comment panel | Side panel (right side) | Consistent with existing ValidationPanel placement; can coexist with category tabs |
| Status validation | Server-side only for transition | Frontend shows preview but server makes authoritative decision |

---

## 8. Constraints

### 8.1 Technical Constraints

- **Database migration required**: Add 3 columns to `review_comments` table (Alembic migration)
- **Phase 1 auth model**: User identification via `X-User-Id` header and dropdown selection, no JWT
- **AG Grid Community Edition**: No enterprise features (e.g., no server-side row model). Comment markers use custom cell renderer overlay
- **No real-time sync**: Comments are fetched on demand (React Query with polling or manual refresh). WebSocket is out of scope
- **Comment targeting validation**: `column_name` without `project_layer_id` is not allowed (cell-level comments require layer context)

### 8.2 Business Constraints

- Review transition requires 0 validation errors (server-side enforcement)
- Only `reviewer` or `admin` roles can approve or reject
- Rejection requires at least 1 unresolved comment
- Rejected projects return to Draft status immediately
- Comments persist through status transitions (not auto-deleted)
- Archived projects cannot receive new comments

### 8.3 Workflow Rules Matrix

| From \ To | Draft | Review | Approved | Rejected | Archived |
|---|---|---|---|---|---|
| Draft | - | Validation 0 errors | - | - | - |
| Review | - | - | Reviewer role | Comment required | - |
| Approved | - | - | - | - | Via revision only |
| Rejected | (auto) | - | - | - | - |
| Archived | - | - | - | - | - |

Note: Rejected is a transient state that immediately transitions to Draft.

---

## 9. Test Strategy

### 9.1 Backend Tests (pytest)

**Approval Workflow Tests** (`tests/test_approval_workflow.py`):
- Draft to Review: valid (0 errors) succeeds
- Draft to Review: invalid (N errors) returns 400 with error count
- Review to Approved: reviewer role succeeds
- Review to Approved: editor role returns 403
- Review to Rejected: with comments succeeds, project becomes Draft
- Review to Rejected: without comments returns 400
- Invalid transitions: Draft to Approved returns 400
- Invalid transitions: Approved to Draft returns 400
- Status log creation on every transition
- Rejection creates two log entries (review->rejected, rejected->draft)

**Comment Service Tests** (`tests/test_comment_service.py`):
- Create project-level comment (no layer/column)
- Create layer-level comment (layer only)
- Create cell-level comment (layer + column)
- Invalid: column_name without project_layer_id
- List comments with filter by is_resolved
- List comments with filter by comment_type
- Update comment content
- Resolve comment (sets is_resolved, resolved_by, resolved_at)
- Delete comment by owner
- Delete comment by admin (different user)
- Delete comment by non-owner non-admin returns 403
- Create comment on archived project returns 403
- Change summary endpoint returns correct counts

### 9.2 Frontend Tests (Vitest)

**Utility Tests**:
- Status transition validation logic (valid/invalid transitions)
- Comment targeting validation (cell requires layer)
- Change summary data formatting

**Component Tests** (if patterns exist):
- StatusBanner renders correct status and message
- ReviewRequestModal shows validation result and change summary
- CommentPanel displays comments in correct order
- ApprovalButtons visible only for reviewer in Review state

---

## 10. Traceability

| Requirement | API Endpoint | UI Component | Test |
|---|---|---|---|
| REQ-001 | PATCH /status (validation check) | ReviewRequestModal | test_draft_to_review_validation |
| REQ-002 | PATCH /status (role check) | ApprovalButtons | test_review_to_approved_role |
| REQ-003 | PATCH /status (comment check) | ApprovalButtons | test_review_to_rejected_comments |
| REQ-004 | PATCH /status (log creation) | StatusTimeline | test_status_log_creation |
| REQ-005 | PATCH /status (rejection->draft) | ConditionEditorPage | test_rejection_reverts_to_draft |
| REQ-006 | PATCH /status (invalid transitions) | N/A | test_invalid_transitions |
| REQ-007 | N/A | ConditionGrid (read-only) | Manual/E2E |
| REQ-008 | N/A | StatusBanner | Manual/E2E |
| REQ-009 | N/A | ConditionEditorPage | Manual/E2E |
| REQ-010 | GET /change-summary | ReviewRequestModal | test_change_summary |
| REQ-011 | PATCH /status | ReviewRequestModal | test_review_request_disabled |
| REQ-012 | PATCH /status | ReviewRequestModal | Manual/E2E |
| REQ-013 | POST /comments | CommentDialog | test_create_comment_targeting |
| REQ-014 | GET /comments | CommentPanel | test_list_comments |
| REQ-015 | PATCH /comments/{id} | CommentPanel | test_update_resolve_comment |
| REQ-016 | DELETE /comments/{id} | CommentPanel | test_delete_comment |
| REQ-017 | POST /comments (archived check) | N/A | test_comment_archived_blocked |
| REQ-018 | PATCH/DELETE /comments (owner check) | N/A | test_comment_ownership |
| REQ-019 | N/A | ConditionGrid (context menu) | Manual/E2E |
| REQ-020 | N/A | CommentMarkerRenderer | Manual/E2E |
| REQ-021 | N/A | CommentPanel (navigation) | Manual/E2E |
| REQ-022 | N/A | CellRenderer (tooltip) | Manual/E2E |
| REQ-023 | N/A | ApprovalButtons | Manual/E2E |
| REQ-024 | PATCH /status | ApprovalButtons | test_approve_success |
| REQ-025 | PATCH /status | ApprovalButtons | test_reject_no_comments |
| REQ-026 | PATCH /status | ApprovalButtons | test_reject_with_comments |
| REQ-027 | GET /comments | ConditionEditorPage | Manual/E2E |
| REQ-028 | PATCH /comments/{id} | CommentPanel | test_resolve_comment |
| REQ-029 | N/A | CommentPanel | Manual/E2E |
| REQ-030 | PATCH /status (logging) | N/A | test_all_transitions_logged |
| REQ-031 | GET /status-history | StatusTimeline | test_status_history |
