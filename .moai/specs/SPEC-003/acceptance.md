# SPEC-003: Acceptance Criteria

**SPEC ID**: SPEC-003
**Title**: Approval Workflow and Review Comments
**Phase**: Phase 3 (Workflow & Output)
**Status**: Planned

---

## 1. Feature 1: Status Transition API Enhancement

### AC-1.1: Draft to Review with Valid Project

```
Given a project in Draft status with 0 validation errors
When the editor sends PATCH /api/projects/{id}/status with new_status "review"
Then the system shall set the project status to "review"
And return 200 with the updated status information
And create a project_status_logs entry with from_status "draft" and to_status "review"
```

### AC-1.2: Draft to Review with Validation Errors

```
Given a project in Draft status with 5 validation errors
When the editor sends PATCH /api/projects/{id}/status with new_status "review"
Then the system shall return 400 with error_count 5
And the project status shall remain "draft"
And no project_status_logs entry shall be created
```

### AC-1.3: Review to Approved by Reviewer

```
Given a project in Review status
And the requesting user has role "reviewer"
When the user sends PATCH /api/projects/{id}/status with new_status "approved"
Then the system shall set the project status to "approved"
And return 200 with the updated status information
And create a project_status_logs entry with from_status "review" and to_status "approved"
```

### AC-1.4: Review to Approved by Editor (Forbidden)

```
Given a project in Review status
And the requesting user has role "editor"
When the user sends PATCH /api/projects/{id}/status with new_status "approved"
Then the system shall return 403 with detail "Only reviewers can approve projects"
And the project status shall remain "review"
```

### AC-1.5: Review to Rejected with Comments

```
Given a project in Review status
And the project has 2 unresolved comments
When the reviewer sends PATCH /api/projects/{id}/status with new_status "rejected"
Then the system shall set the project status to "draft"
And create two project_status_logs entries:
  - from_status "review", to_status "rejected"
  - from_status "rejected", to_status "draft"
And return 200 indicating the project is now in "draft" status
```

### AC-1.6: Review to Rejected without Comments

```
Given a project in Review status
And the project has 0 unresolved comments
When the reviewer sends PATCH /api/projects/{id}/status with new_status "rejected"
Then the system shall return 400 with detail "At least one comment is required for rejection"
And the project status shall remain "review"
```

### AC-1.7: Invalid Status Transition

```
Given a project in Draft status
When a user sends PATCH /api/projects/{id}/status with new_status "approved"
Then the system shall return 400 with detail "Invalid status transition from draft to approved"
And the project status shall remain "draft"
```

### AC-1.8: Archived Project Status Change Blocked

```
Given a project in Archived status
When a user sends PATCH /api/projects/{id}/status with any new_status
Then the system shall return 400 with detail "Cannot change status of archived project"
```

---

## 2. Feature 2: Review Read-only Mode

### AC-2.1: Grid Editing Disabled in Review Status

```
Given a project in Review status
When the editor page loads
Then all AG Grid cells shall be non-editable (editable: false)
And the Save button shall be hidden
And the Auto-save functionality shall be disabled
And the Recipe Upload button shall be hidden
And the Backbone Replace button shall be hidden
```

### AC-2.2: Grid Editing Disabled in Approved Status

```
Given a project in Approved status
When the editor page loads
Then all AG Grid cells shall be non-editable
And the Save button shall be hidden
And only the "Create Revision" button shall be visible (from SPEC-002)
```

### AC-2.3: Grid Editing Enabled in Draft Status

```
Given a project in Draft status
When the editor page loads
Then all AG Grid cells shall be editable according to column definitions
And the Save button shall be visible
And the Review Request button shall be visible
```

### AC-2.4: Status Banner Display

```
Given a project in any status
When the editor page loads
Then a status banner shall be displayed at the top of the editor
And the banner shall show the current status with distinct color:
  - Draft: blue background with editing instructions
  - Review: orange background with "Under review" message
  - Approved: green background with "Finalized" message
  - Rejected: red background with "Please review comments" message
  - Archived: gray background with version number
```

---

## 3. Feature 3: Review Request Modal

### AC-3.1: Review Request Modal Content

```
Given a project in Draft status with 0 validation errors
And the project has 23 changed cells across 8 layers
And 3 layers had backbone replacements
And 2 layers had recipe applications
When the editor clicks the "Review Request" button
Then a modal shall appear showing:
  - Validation Result: "0 errors" with a green indicator
  - Changed layers: "8 / {total_layers}"
  - Changed cells: "23"
  - Backbone replacements: "3 layers"
  - Recipe applications: "2 layers"
  - An optional memo text field
  - An enabled "Submit Review Request" button
```

### AC-3.2: Review Request Modal with Validation Errors

```
Given a project in Draft status with 5 validation errors
When the editor clicks the "Review Request" button
Then the modal shall appear showing:
  - Validation Result: "5 errors" with a red indicator
  - The "Submit Review Request" button shall be disabled
  - A message: "Resolve all validation errors before requesting review"
```

### AC-3.3: Review Request Submission

```
Given the Review Request modal is open with 0 validation errors
And the editor has entered "Please check M1-M3 Energy" in the memo field
When the editor clicks "Submit Review Request"
Then the system shall call PATCH /api/projects/{id}/status with:
  - new_status: "review"
  - changed_by: current user ID
  - comment: "Please check M1-M3 Energy"
And the modal shall close
And the page shall refresh to show Review status
And the grid shall become read-only
```

---

## 4. Feature 4: Comment CRUD API

### AC-4.1: Create Cell-level Comment

```
Given a project in Review status
And a user with reviewer role
When the user sends POST /api/projects/{id}/comments with:
  - user_id: 2
  - project_layer_id: 5
  - column_name: "SP_PREBAKE_TEMP_C"
  - content: "Temperature value needs verification"
  - comment_type: "rejection"
Then the system shall return 201 with the created comment
And the response shall include:
  - layer_name: "AA_PHOTO"
  - column_display_name: "Prebake Temp (C)"
  - creator_name and creator_role from the user record
  - is_resolved: false
```

### AC-4.2: Create Project-level Comment

```
Given a project in Review status
When the user sends POST /api/projects/{id}/comments with:
  - user_id: 2
  - project_layer_id: null
  - column_name: null
  - content: "Overall OVL specs need review"
  - comment_type: "general"
Then the system shall return 201 with the created comment
And the response shall have project_layer_id: null and column_name: null
```

### AC-4.3: Create Comment with Invalid Targeting

```
Given a project in Review status
When the user sends POST /api/projects/{id}/comments with:
  - column_name: "SP_PREBAKE_TEMP_C"
  - project_layer_id: null
Then the system shall return 400 with detail "column_name requires project_layer_id"
```

### AC-4.4: Create Comment on Archived Project

```
Given a project in Archived status
When the user sends POST /api/projects/{id}/comments
Then the system shall return 403 with detail "Cannot add comments to archived project"
```

### AC-4.5: List Comments with Filters

```
Given a project with 5 comments (3 unresolved, 2 resolved)
When the user sends GET /api/projects/{id}/comments?is_resolved=false
Then the system shall return 3 unresolved comments
And the response shall include unresolved_count: 3 and total: 5
```

### AC-4.6: Resolve Comment

```
Given a comment with is_resolved: false
When the editor sends PATCH /api/projects/{id}/comments/{commentId} with:
  - is_resolved: true
  - resolved_by: 1
Then the system shall update the comment with:
  - is_resolved: true
  - resolved_by: 1
  - resolved_at: current timestamp
And return the updated comment
```

### AC-4.7: Delete Comment by Owner

```
Given a comment created by user 2
When user 2 sends DELETE /api/projects/{id}/comments/{commentId}
Then the system shall return 204 No Content
And the comment shall be removed from the database
```

### AC-4.8: Delete Comment by Non-Owner (Forbidden)

```
Given a comment created by user 2
When user 3 (role: editor) sends DELETE /api/projects/{id}/comments/{commentId}
Then the system shall return 403 with detail "Cannot delete another user's comment"
```

### AC-4.9: Delete Comment by Admin (Allowed)

```
Given a comment created by user 2
When user 4 (role: admin) sends DELETE /api/projects/{id}/comments/{commentId}
Then the system shall return 204 No Content
```

---

## 5. Feature 5: Comment UI

### AC-5.1: Cell Comment Marker

```
Given a project with an unresolved comment on cell (AA_PHOTO, SP_PREBAKE_TEMP_C)
When the editor page loads
Then the cell for AA_PHOTO row and SP_PREBAKE_TEMP_C column shall display:
  - A red triangle marker in the top-right corner
  - The normal cell value underneath
```

### AC-5.2: Cell Comment Marker Disappears on Resolution

```
Given a cell with a red comment marker
When the user resolves all comments for that cell
And the comment data refreshes
Then the red triangle marker shall no longer be displayed on that cell
```

### AC-5.3: Right-click Context Menu in Review Mode

```
Given a project in Review status
And the current user has reviewer role
When the user right-clicks on a cell in the AG Grid
Then the context menu shall include an "Add Comment" option
When the user clicks "Add Comment"
Then a comment dialog shall open with:
  - Layer pre-filled with the row's layer name
  - Column pre-filled with the clicked column name
  - An empty content field for the comment text
  - Comment type defaulting to "rejection"
```

### AC-5.4: Right-click Context Menu in Draft Mode

```
Given a project in Draft status
When the user right-clicks on a cell in the AG Grid
Then the context menu shall NOT include an "Add Comment" option
  (Comment creation is only available in Review state for reviewers)
```

### AC-5.5: Comment Panel Navigation

```
Given a comment on cell (M1_PHOTO, SC_ENERGY) which is in the SC category tab
And the user is currently viewing the SP category tab
When the user clicks "Navigate to cell" on the comment in the panel
Then the system shall:
  - Switch the category tab to SC
  - Scroll the AG Grid to the M1_PHOTO row
  - Highlight the SC_ENERGY column cell
  - Optionally flash the cell briefly for visual identification
```

### AC-5.6: Comment Tooltip on Hover

```
Given a cell with 2 comments, the latest being "Temperature needs verification"
When the user hovers over the cell's red triangle marker
Then a tooltip shall display:
  - "2 comments"
  - Preview: "Temperature needs verification"
```

---

## 6. Feature 6: Approval/Rejection UI

### AC-6.1: Approval Buttons Visibility for Reviewer

```
Given a project in Review status
And the current user has role "reviewer"
When the editor page loads
Then the toolbar shall display "Approve" (green) and "Reject" (red) buttons
```

### AC-6.2: Approval Buttons Hidden for Editor

```
Given a project in Review status
And the current user has role "editor"
When the editor page loads
Then the toolbar shall NOT display "Approve" or "Reject" buttons
```

### AC-6.3: Successful Approval

```
Given a project in Review status
When the reviewer clicks "Approve"
Then the system shall call PATCH /api/projects/{id}/status with new_status "approved"
And display a success toast: "Project approved successfully"
And the status banner shall change to green "Approved"
And the Approve/Reject buttons shall disappear
```

### AC-6.4: Rejection without Comments

```
Given a project in Review status with 0 comments
When the reviewer clicks "Reject"
Then the system shall display an error message:
  "Please add at least one comment before rejecting. Comments help the editor understand what needs correction."
And the status shall remain "review"
```

### AC-6.5: Successful Rejection with Comments

```
Given a project in Review status with 2 unresolved comments
When the reviewer clicks "Reject"
Then the system shall call PATCH /api/projects/{id}/status with new_status "rejected"
And display a success toast: "Project rejected. Editor will see your comments."
And the page shall redirect to the project list
  (since the project is now in Draft for the editor)
```

---

## 7. Feature 7: Post-Rejection Editor View

### AC-7.1: Rejection Comment Highlights

```
Given a project that was just rejected with 3 rejection comments
When the editor opens the project (now in Draft status)
Then the status banner shall show red "Rejected" message:
  "Rejected. Please review comments and make corrections."
And cells with rejection comments shall have red highlight styling
And the comment panel shall automatically open showing unresolved comments
```

### AC-7.2: Comment Resolution by Editor

```
Given a post-rejection project with an unresolved comment on SP_PREBAKE_TEMP_C
When the editor fixes the temperature value
And clicks "Resolve" on the comment in the panel
Then the comment shall be marked as resolved:
  - is_resolved: true
  - resolved_by: editor's user ID
  - resolved_at: current timestamp
And the red highlight on the cell shall change to a softer resolved style
And the comment moves to the "Resolved" section of the panel
```

### AC-7.3: Unresolved Comments Sorting

```
Given a post-rejection project with 2 unresolved and 1 resolved comments
When the comment panel loads
Then unresolved comments shall appear at the top with "Needs Attention" styling
And resolved comments shall appear below in a separate section
And each unresolved comment shall have a "Resolve" button
```

---

## 8. Feature 8: Status Transition History

### AC-8.1: Status History Display

```
Given a project with the following history:
  1. Created as Draft (2026-02-15 09:00 by Kim Engineer)
  2. Draft -> Review (2026-02-16 10:00 by Kim Engineer, memo: "Energy values verified")
  3. Review -> Rejected -> Draft (2026-02-16 14:00 by Park Engineer)
  4. Draft -> Review (2026-02-16 16:00 by Kim Engineer)
  5. Review -> Approved (2026-02-17 10:00 by Park Engineer)
When the user views the status timeline
Then the timeline shall display all entries in reverse chronological order
And each entry shall show:
  - Timestamp
  - User name
  - From-status -> To-status
  - Comment (if any)
```

### AC-8.2: Status History API Response

```
Given a project with 3 status transitions
When the user sends GET /api/projects/{id}/status-history
Then the system shall return all transitions ordered by changed_at descending
And each entry shall include:
  - id, from_status, to_status
  - changed_by (user ID)
  - changer_name (user display name)
  - comment (if provided)
  - changed_at (ISO timestamp)
```

---

## 9. Quality Gates

### 9.1 Backend Quality

- All new backend tests passing (pytest)
- 85%+ code coverage on new service code (`comment_service.py`, status transition logic)
- No ruff linter warnings on new files
- Pydantic schemas validate all edge cases (missing fields, invalid types)
- Database migration runs forward and backward cleanly

### 9.2 Frontend Quality

- All new frontend tests passing (Vitest)
- TypeScript strict mode: no type errors on new files
- No ESLint warnings on new files
- All AG Grid interactions verified in browser testing

### 9.3 Integration Quality

- Full workflow tested end-to-end: Draft -> Review -> Rejected -> Draft -> Review -> Approved
- Comment lifecycle tested: Create -> List -> Resolve -> Verify marker removal
- Role-based access verified: Editor cannot approve, Reviewer can approve/reject
- Cross-tab comment navigation verified (SP tab comment navigates to SC tab)

### 9.4 Definition of Done

- [ ] All 31 EARS requirements (REQ-001 through REQ-031) implemented
- [ ] Database migration applied and reversible
- [ ] Backend tests: 23+ test cases passing
- [ ] Frontend tests: key utility and component tests passing
- [ ] AG Grid read-only mode functional in review/approved/archived states
- [ ] Comment markers visible and clickable on cells with comments
- [ ] Review request modal shows accurate validation and change data
- [ ] Approve/Reject workflow completes without errors
- [ ] Post-rejection comments highlighted with resolution workflow
- [ ] Status timeline displays complete history
- [ ] No regression in existing Phase 1/2 functionality
