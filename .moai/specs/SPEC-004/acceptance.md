# SPEC-004: Acceptance Criteria

**SPEC ID**: SPEC-004
**Title**: Change History Panel and Version History
**Phase**: 3 (Workflow & Output)

---

## 1. Enhanced Change History API (REQ-001, REQ-005)

### AC-1.1: Filter by Change Type

```gherkin
Given a project with change_logs containing:
  | change_type | count |
  | manual      | 10    |
  | backbone    | 5     |
  | recipe      | 3     |
When the user requests GET /api/projects/{id}/changelog?change_type=manual
Then the response status is 200
  And the response total equals 10
  And all returned items have change_type="manual"
```

### AC-1.2: Filter by User

```gherkin
Given a project with changes made by user_id=1 (8 changes) and user_id=2 (10 changes)
When the user requests GET /api/projects/{id}/changelog?changed_by=1
Then the response status is 200
  And the response total equals 8
  And all returned items have changed_by=1
```

### AC-1.3: Filter by Date Range

```gherkin
Given a project with changes spanning from 2026-02-01 to 2026-02-10
When the user requests GET /api/projects/{id}/changelog?date_from=2026-02-05T00:00:00Z&date_to=2026-02-07T23:59:59Z
Then the response status is 200
  And all returned items have changed_at between 2026-02-05 and 2026-02-07
```

### AC-1.4: Combined Filters

```gherkin
Given a project with diverse change_logs
When the user requests GET /api/projects/{id}/changelog?layer_id=5&change_type=recipe&changed_by=1
Then the response contains only entries matching ALL three filter criteria
```

### AC-1.5: Pagination

```gherkin
Given a project with 142 change_logs
When the user requests GET /api/projects/{id}/changelog?page=1&limit=50
Then the response total equals 142
  And the response contains 50 items
  And the response page equals 1
When the user requests GET /api/projects/{id}/changelog?page=3&limit=50
Then the response contains 42 items
  And the response page equals 3
```

### AC-1.6: Backward Compatibility

```gherkin
Given the existing changelog endpoint with offset-based pagination
When the user requests GET /api/projects/{id}/changelog?limit=50&offset=0
Then the response structure is compatible with the existing ChangeLogListResponse
  And the items are returned correctly
```

### AC-1.7: Project Not Found

```gherkin
Given project_id=9999 does not exist
When the user requests GET /api/projects/9999/changelog
Then the response status is 404
```

---

## 2. Unified Timeline API (REQ-002, REQ-003, REQ-004, REQ-005)

### AC-2.1: Timeline with Cell Changes Only

```gherkin
Given a project with 5 cell changes and 0 status transitions
When the user requests GET /api/projects/{id}/changelog/timeline
Then the response status is 200
  And the response total equals 5
  And all entries have entry_type="cell_change"
  And entries are ordered by timestamp descending
```

### AC-2.2: Timeline with Mixed Entries

```gherkin
Given a project with:
  | entry_type    | timestamp           | details                     |
  | status_change | 2026-02-10T14:30:00 | draft -> review             |
  | cell_change   | 2026-02-10T14:25:00 | SP_PREBAKE_TEMP: 110 -> 115 |
  | cell_change   | 2026-02-10T13:50:00 | SP_PR_THICK: 800 -> 850     |
  | cell_change   | 2026-02-09T11:00:00 | backbone replacement        |
When the user requests GET /api/projects/{id}/changelog/timeline
Then the response contains 4 total entries
  And the first entry is the status_change (newest)
  And entries are grouped by date:
    | date       | count |
    | 2026-02-10 | 3     |
    | 2026-02-09 | 1     |
```

### AC-2.3: Timeline User Names

```gherkin
Given a cell change made by user_id=1 (display_name="Kim Engineer")
  And a status change made by user_id=2 (display_name="Park Reviewer")
When the user requests the timeline
Then the cell change entry has user_name="Kim Engineer"
  And the status change entry has user_name="Park Reviewer"
```

### AC-2.4: Timeline Entry IDs

```gherkin
Given a cell change with id=500 and a status log with id=5
When the user requests the timeline
Then the cell change has id="change-500"
  And the status change has id="status-5"
  And all IDs are unique across the response
```

### AC-2.5: Timeline Pagination

```gherkin
Given a project with 85 combined entries (cell changes + status transitions)
When the user requests GET /api/projects/{id}/changelog/timeline?page=1&limit=50
Then the response total equals 85
  And the first page contains up to 50 entries grouped by date
When the user requests page=2
Then the response contains up to 35 remaining entries
```

### AC-2.6: Timeline Empty Project

```gherkin
Given a newly created project with no changes and no status transitions
When the user requests GET /api/projects/{id}/changelog/timeline
Then the response status is 200
  And the response total equals 0
  And the response groups is an empty array
```

### AC-2.7: Timeline Project Not Found

```gherkin
Given project_id=9999 does not exist
When the user requests GET /api/projects/9999/changelog/timeline
Then the response status is 404
```

---

## 3. Cell-Level History (REQ-012, REQ-013, REQ-014, REQ-015)

### AC-3.1: Cell with Multiple Changes

```gherkin
Given cell (project_layer_id=12, column_name="SP_PREBAKE_TEMP_C") has 3 changes:
  | old_value | new_value | change_type | changed_by      | changed_at          |
  | 110       | 115       | manual      | Kim Engineer    | 2026-02-10T14:25:00 |
  | 105       | 110       | backbone    | Kim Engineer    | 2026-02-09T11:00:00 |
  | null      | 105       | backbone    | Kim Engineer    | 2026-02-08T09:30:00 |
When the user requests GET /api/projects/{id}/changelog/cell?project_layer_id=12&column_name=SP_PREBAKE_TEMP_C
Then the response status is 200
  And the response total equals 3
  And items are ordered by changed_at descending (most recent first)
  And each item includes changed_by_name="Kim Engineer"
  And the response includes layer_name="AA_PHOTO" and column_name="SP_PREBAKE_TEMP_C"
```

### AC-3.2: Cell with No History

```gherkin
Given cell (project_layer_id=12, column_name="SP_SOME_COLUMN") has no change_log entries
When the user requests GET /api/projects/{id}/changelog/cell?project_layer_id=12&column_name=SP_SOME_COLUMN
Then the response status is 200
  And the response total equals 0
  And the response items is an empty array
```

### AC-3.3: Invalid Project Layer ID

```gherkin
Given project_layer_id=999 does not belong to project_id=1
When the user requests GET /api/projects/1/changelog/cell?project_layer_id=999&column_name=SP_TEMP
Then the response status is 404
  And the error message indicates the project layer was not found for this project
```

### AC-3.4: Missing Required Parameters

```gherkin
When the user requests GET /api/projects/{id}/changelog/cell without project_layer_id
Then the response status is 422
  And the error indicates project_layer_id is required
```

---

## 4. Version History (REQ-016, REQ-017, REQ-018, REQ-019, REQ-020)

### AC-4.1: Multi-Version Project

```gherkin
Given product "PROD-2025A" has 3 project revisions:
  | project_id | revision | status   | is_latest | created_by   |
  | 3          | 3        | draft    | true      | Kim Engineer |
  | 2          | 2        | archived | false     | Kim Engineer |
  | 1          | 1        | archived | false     | Park Senior  |
When the user requests GET /api/projects/3/versions
Then the response status is 200
  And the response product_name equals "PROD-2025A"
  And the response current_project_id equals 3
  And the response contains 3 versions ordered by revision descending
  And version with project_id=3 has is_current=true
  And versions with project_id=2 and 1 have is_current=false
```

### AC-4.2: Single Version Project

```gherkin
Given product "PROD-NEW" has only 1 project (revision=1, status=draft)
When the user requests GET /api/projects/{id}/versions
Then the response contains 1 version
  And that version has is_current=true and is_latest=true
```

### AC-4.3: Version History with Approved Project

```gherkin
Given product revisions: v1 (archived), v2 (approved, is_latest=true)
When the user requests GET /api/projects/{v2_id}/versions
Then v2 has status="approved", is_current=true, is_latest=true
  And v1 has status="archived", is_current=false, is_latest=false
```

### AC-4.4: Project Not Found

```gherkin
Given project_id=9999 does not exist
When the user requests GET /api/projects/9999/versions
Then the response status is 404
```

---

## 5. Change History Panel UI (REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011)

### AC-5.1: Panel Open/Close

```gherkin
Given the user is viewing the condition editor
  And the change history panel is closed
When the user clicks the "Change History" toolbar button
Then a panel slides out from the right side
  And the AG Grid adjusts its width to accommodate the panel
When the user clicks the close button (X) on the panel
Then the panel slides closed
  And the AG Grid returns to full width
```

### AC-5.2: Timeline Display

```gherkin
Given the change history panel is open
  And the project has changes on 2026-02-10 and 2026-02-09
Then the panel displays:
  - A date header "2026-02-10"
  - All entries from that date with time, user, type indicator, and details
  - A date header "2026-02-09"
  - All entries from that date
  And entries within each date group are ordered by time descending
```

### AC-5.3: Action Type Icons

```gherkin
Given the timeline contains entries of all types
Then manual edit entries display a pencil indicator
  And backbone replacement entries display a link indicator
  And recipe application entries display a file indicator
  And status change entries display a flag indicator
```

### AC-5.4: Cell Change Details

```gherkin
Given a manual edit entry for column SP_PREBAKE_TEMP_C on layer AA_PHOTO
Then the entry displays:
  - Time: "14:25"
  - User: "Kim Engineer"
  - Type: pencil icon + "Manual Edit"
  - Layer: "AA_PHOTO"
  - Change: "SP_PREBAKE_TEMP_C: 110 -> 115"
```

### AC-5.5: Status Change Details

```gherkin
Given a status transition entry from "draft" to "review"
Then the entry displays:
  - Time: "14:30"
  - User: "Kim Engineer"
  - Type: flag icon + "Status Change"
  - Detail: "Draft -> Review"
  And if a comment exists, it is shown below the status line
```

### AC-5.6: Filter Application

```gherkin
Given the change history panel is open
  And changes exist for layers AA_PHOTO and VIA2_PHOTO
When the user selects "AA_PHOTO" in the Layer filter dropdown
Then only entries related to AA_PHOTO are displayed
  And status change entries (which are not layer-specific) remain visible
When the user selects "Manual" in the Type filter dropdown
Then only manual edit entries for AA_PHOTO are displayed
  And status change entries are hidden
```

### AC-5.7: Cell Navigation on Click

```gherkin
Given the change history panel shows a cell change entry for:
  - Layer: AA_PHOTO, Column: SP_PREBAKE_TEMP_C
When the user clicks on that entry
Then the AG Grid scrolls to the AA_PHOTO row
  And the SP_PREBAKE_TEMP_C column is scrolled into view
  And the cell is briefly highlighted (flash effect)
```

### AC-5.8: Load More Pagination

```gherkin
Given the project has 85 timeline entries
  And the panel initially shows 50 entries
When the user clicks "Load More" at the bottom
Then the next 35 entries are appended to the timeline
  And the "Load More" button is no longer visible (all entries loaded)
```

---

## 6. Cell History UI (REQ-012, REQ-013, REQ-014, REQ-015)

### AC-6.1: Context Menu and Modal

```gherkin
Given the user is editing the condition table
When the user right-clicks on cell SP_PREBAKE_TEMP_C in row AA_PHOTO
Then a context menu appears with a "View History" option
When the user clicks "View History"
Then a modal dialog opens with:
  - Title: "Cell History: SP_PREBAKE_TEMP_C"
  - Subtitle: "Layer: AA_PHOTO"
  - A table of change records
```

### AC-6.2: Cell History Table

```gherkin
Given the cell has 3 changes
When the cell history modal opens
Then the table displays 3 rows with columns:
  | Time              | User         | Type     | Old Value | New Value |
  | 2026-02-10 14:25  | Kim Engineer | Manual   | 110       | 115       |
  | 2026-02-09 11:00  | Kim Engineer | Backbone | 105       | 110       |
  | 2026-02-08 09:30  | Kim Engineer | Backbone | --        | 105       |
  And null old_value is displayed as "--"
  And rows are ordered most recent first
```

### AC-6.3: Empty Cell History

```gherkin
Given the cell has no change history
When the cell history modal opens
Then the modal displays "No change history for this cell."
  And no table is rendered
```

### AC-6.4: Modal Close

```gherkin
Given the cell history modal is open
When the user clicks the "Close" button or presses Escape
Then the modal closes
  And focus returns to the AG Grid
```

---

## 7. Version History Panel and Read-Only Mode (REQ-017, REQ-018, REQ-019, REQ-020)

### AC-7.1: Version Panel Display

```gherkin
Given the project has 3 revisions (v1 archived, v2 archived, v3 draft)
  And the user is viewing v3
When the user opens the Version History panel
Then the panel displays:
  | Version | Status   | Date       | Creator      | Action   |
  | v3      | Draft    | 2026-02-10 | Kim Engineer | (current)|
  | v2      | Archived | 2026-01-15 | Kim Engineer | [View]   |
  | v1      | Archived | 2025-12-01 | Park Senior  | [View]   |
  And v3 row is visually highlighted (bold or accent border)
  And status badges use color coding: Draft=blue, Archived=gray
```

### AC-7.2: Navigate to Archived Version

```gherkin
Given the version history panel shows v1 (archived) with a "View" link
When the user clicks "View" on v1
Then the browser navigates to /projects/{v1_id}/edit
  And the condition editor loads in read-only mode
  And a "ARCHIVED - Read Only (v1)" banner is displayed at the top
```

### AC-7.3: Read-Only Mode Controls

```gherkin
Given the user is viewing an archived project (v1)
Then the AG Grid cells are not editable (clicking a cell does not open editor)
  And the toolbar does NOT show: Save, Validate, Recipe Upload buttons
  And the toolbar DOES show: Change History, Version History buttons
  And a "Back to Current" button is visible in the banner
```

### AC-7.4: Back to Current Version

```gherkin
Given the user is viewing archived v1
  And v3 is the latest version (is_latest=true)
When the user clicks "Back to Current"
Then the browser navigates to /projects/{v3_id}/edit
  And the condition editor loads in normal editable mode
  And the read-only banner is not displayed
```

### AC-7.5: Single Version - No View Link

```gherkin
Given the project has only 1 revision (v1, draft)
When the user opens the Version History panel
Then only v1 is listed
  And no "View" link is shown (already viewing the only version)
```

---

## 8. Data Integrity (REQ-021, REQ-022)

### AC-8.1: No Mutation Endpoints

```gherkin
Given the change history API endpoints
Then no PUT, POST, PATCH, or DELETE methods exist for:
  - /api/projects/{id}/changelog/*
  - /api/projects/{id}/versions
  And all endpoints are GET (read-only)
```

### AC-8.2: Invalid Project Returns 404

```gherkin
Given project_id=9999 does not exist
When the user requests any of:
  - GET /api/projects/9999/changelog
  - GET /api/projects/9999/changelog/timeline
  - GET /api/projects/9999/changelog/cell?project_layer_id=1&column_name=X
  - GET /api/projects/9999/versions
Then each returns 404 Not Found
```

---

## 9. Quality Gate Criteria

### 9.1 Definition of Done

- [ ] All 22 EARS requirements (REQ-001 through REQ-022) are implemented
- [ ] Backend: Enhanced changelog endpoint with all new filter parameters working
- [ ] Backend: Timeline endpoint correctly merges change_logs and project_status_logs
- [ ] Backend: Cell history endpoint returns filtered results for specific cell
- [ ] Backend: Version history endpoint resolves full revision chain
- [ ] Backend: All endpoints return 404 for non-existent projects
- [ ] Backend: Comprehensive pytest tests for all new service functions
- [ ] Frontend: Change History panel opens/closes with toolbar button
- [ ] Frontend: Timeline entries render with correct action type indicators
- [ ] Frontend: Filter controls update the timeline display
- [ ] Frontend: Clicking cell change entry navigates to the cell in AG Grid
- [ ] Frontend: "Load More" pagination works for large timelines
- [ ] Frontend: Cell History modal opens from right-click context menu
- [ ] Frontend: Cell History modal displays correct table or empty state
- [ ] Frontend: Version History panel shows all revisions with correct highlighting
- [ ] Frontend: Clicking archived version navigates to read-only view
- [ ] Frontend: Read-only mode disables AG Grid editing and hides mutation buttons
- [ ] Frontend: "Back to Current" navigates to latest version
- [ ] No TypeScript errors or Python type hint violations
- [ ] Code follows existing project conventions (async/await, Pydantic v2, React Query, Zustand)

### 9.2 Verification Methods

| Method | Scope | Tool |
|---|---|---|
| Unit tests | Backend services (filter, timeline merge, cell history, version chain) | pytest + pytest-asyncio |
| API tests | All new/enhanced endpoints | pytest + httpx AsyncClient |
| Utility tests | Frontend data transformation and grouping logic | Vitest |
| Component tests | Timeline entry, cell history modal, version panel rendering | Vitest + Testing Library (optional) |
| Manual testing | Panel UI, context menu, cell navigation, read-only mode | Browser (Chrome/Firefox) |
| Type checking | Frontend type safety | TypeScript strict mode |
| Linting | Code style | ruff (backend), ESLint (frontend) |
