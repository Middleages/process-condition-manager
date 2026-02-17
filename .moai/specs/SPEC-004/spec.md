# SPEC-004: Change History Panel and Version History

**SPEC ID**: SPEC-004
**Title**: Change History Panel and Version History
**Phase**: 3 (Workflow & Output)
**Status**: In Progress (M1+M2 Complete)
**Priority**: High
**Created**: 2026-02-16

---

## 1. Overview

### 1.1 Purpose

This SPEC defines the change history timeline view, cell-level history lookup, and version history panel for PCM. These features enable process engineers and reviewers to track all modifications to a condition table over time, examine individual cell change lineage, and navigate between project revisions.

### 1.2 Background

- PCM manages semiconductor photo process condition tables with ~300 columns x 30-60 layers per product
- Phase 1/2 completed: Backbone copy, layer backbone replacement, Recipe XML apply, Revision feature, Admin settings
- SPEC-003 (Approval Workflow) will be implemented before this, populating `project_status_logs` with status transitions
- All cell changes are already recorded in `change_logs` (manual, backbone, recipe) by existing Phase 1/2 services
- A basic `GET /api/projects/{id}/change-logs` endpoint exists with layer_id and column_name filters
- A basic `GET /api/projects/by-product/{product_id}/revisions` endpoint exists returning revision list
- Many frontend components and backend services already exist and will be enhanced rather than built from scratch:
  - **ChangeHistoryPanel.tsx**: Currently an inline bottom table (`h-56` height) showing change logs; will be converted to a right-side slide-out with timeline view
  - **StatusTimeline component**: Exists and renders status transitions
  - **VersionHistoryModal.tsx**: Exists with basic version list UI
  - **change_log_service.py**: Backend service with existing query logic for change logs
  - **projects.py router**: Existing endpoints for change-logs and revisions
  - **project.py schemas**: Existing Pydantic response schemas for project data
- This SPEC enhances these existing components/APIs and adds targeted new files for features not yet covered (cell history, filters, read-only banner)

### 1.3 Scope

**In Scope**:
- Enhanced change history API with additional filters (change_type, user, date range)
- Unified timeline API combining cell changes and status transitions
- Change history slide-out panel with timeline view and filters
- Cell-level history via right-click context menu
- Version history panel in project detail header
- Read-only view navigation for archived versions

**Out of Scope**:
- Change log data recording (already implemented in Phase 1/2 services)
- Status transition recording (handled by SPEC-003)
- Diff comparison between two versions (Phase 4 feature)
- Export of change history to Excel/PDF
- Real-time change notifications or WebSocket updates

### 1.4 Dependencies

| Dependency | Status | Impact |
|---|---|---|
| `change_logs` table and data population | Complete (Phase 1/2) | All cell changes already recorded with change_type |
| `project_status_logs` table | Exists | SPEC-003 will populate status transition records |
| `projects` revision/parent_project_id fields | Complete (SPEC-002) | Revision chain already functional |
| Existing `GET /api/projects/{id}/change-logs` | Complete | Will be enhanced with additional filters |
| Existing `GET /api/projects/by-product/{product_id}/revisions` | Complete | Will be enhanced with creator details |
| AG Grid context menu pattern | Complete (Phase 2) | Right-click menus exist for backbone/recipe features |
| SPEC-003 Approval Workflow | Prerequisite | Status transitions must be recorded before timeline can display them |

---

## 2. EARS Requirements

### Feature 1: Enhanced Change History API

**REQ-001** (Event-Driven): **When** a user requests the change history for a project with filter parameters (layer_id, column_name, change_type, changed_by, date_from, date_to), **then** the system **shall** return only change log entries matching all specified filter criteria, ordered by changed_at descending, with pagination support.

**REQ-002** (Event-Driven): **When** a user requests the unified timeline for a project, **then** the system **shall** return a combined list of cell changes (from `change_logs`) and status transitions (from `project_status_logs`), merged and ordered by timestamp descending.

**REQ-003** (Ubiquitous): Each timeline entry **shall** include the actor's display name (resolved from the `users` table), the timestamp, the action type, and action-specific detail fields.

**REQ-004** (Event-Driven): **When** the timeline response is generated, **then** the system **shall** group entries by date (YYYY-MM-DD) to support the UI's date-grouped rendering.

**REQ-005** (Ubiquitous): Both the enhanced changelog and the timeline API **shall** support cursor-based or offset-based pagination with configurable page size (default 50, max 200).

### Feature 2: Change History Panel UI

**REQ-006** (Event-Driven): **When** the user clicks the "Change History" toolbar button in the condition editor, **then** a slide-out panel **shall** open on the right side displaying the unified timeline for the current project.

**REQ-007** (Ubiquitous): The change history panel **shall** display entries grouped by date headers, with each entry showing: time (HH:MM), user name, action type indicator, and action details.

**REQ-008** (Ubiquitous): The change history panel **shall** visually distinguish action types with distinct indicators:
- Manual edit: pencil icon or "Manual Edit" label
- Backbone replacement: link icon or "Backbone Replace" label
- Recipe application: file icon or "Recipe Apply" label
- Status change: flag icon or "Status Change" label

**REQ-009** (Event-Driven): **When** the user applies filter controls (layer, change type, user) in the change history panel, **then** the panel **shall** refresh to display only matching entries.

**REQ-010** (Event-Driven): **When** the user clicks a cell change entry in the change history panel, **then** the AG Grid editor **shall** scroll to and highlight the corresponding cell (matching layer row and column).

**REQ-011** (Event-Driven): **When** the user scrolls to the bottom of the change history panel, **then** the system **shall** load the next page of entries (infinite scroll or "Load More" button).

### Feature 3: Cell-Level History

**REQ-012** (Event-Driven): **When** the user right-clicks a cell in the AG Grid editor and selects "View History", **then** a modal dialog **shall** open displaying all changes for that specific cell (matching project_layer_id and column_name).

**REQ-013** (Ubiquitous): The cell history modal **shall** display entries in a table format with columns: timestamp, user, change type, old value, new value.

**REQ-014** (Ubiquitous): The cell history modal **shall** sort entries by changed_at descending (most recent first).

**REQ-015** (State-Driven): **While** a cell has no change history records, the cell history modal **shall** display an informational message "No change history for this cell."

### Feature 4: Version History API and Panel

**REQ-016** (Event-Driven): **When** a user requests the version history for a project, **then** the system **shall** resolve the full revision chain using `parent_project_id` and return all versions of the same product, including version number, status, created_at, creator display name, and is_latest flag.

**REQ-017** (Ubiquitous): The version history panel **shall** be accessible from the project detail header area and display a compact version list showing each revision's version number, status badge, created date, and creator name.

**REQ-018** (Ubiquitous): The current project version **shall** be visually highlighted (bold text or accent border) in the version history panel.

**REQ-019** (Event-Driven): **When** the user clicks an archived version in the version history panel, **then** the system **shall** navigate to a read-only view of that archived project.

**REQ-020** (State-Driven): **While** viewing an archived version, the condition editor **shall** disable all editing controls and display a prominent "Archived - Read Only" banner.

### Feature 5: Data Integrity and Access

**REQ-021** (Unwanted): The system **shall not** allow modification of change_log or project_status_log entries through any API endpoint. These records are append-only.

**REQ-022** (Unwanted): The system **shall not** return change history for a project that does not exist; the API **shall** return 404 Not Found.

---

## 3. API Specifications

### 3.1 Enhanced Change History Endpoint

#### GET /api/projects/{project_id}/changelog

Enhanced version of the existing endpoint with additional filter parameters.

**Query Parameters**:
| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| layer_id | integer | No | - | Filter by layer (matched via project_layers.layer_id) |
| column_name | string | No | - | Filter by exact column name |
| change_type | string | No | - | Filter by change type: "manual", "backbone", "recipe" |
| changed_by | integer | No | - | Filter by user ID |
| date_from | datetime | No | - | Filter changes on or after this timestamp (ISO 8601) |
| date_to | datetime | No | - | Filter changes on or before this timestamp (ISO 8601) |
| page | integer | No | 1 | Page number (1-indexed) |
| limit | integer | No | 50 | Items per page (max 200) |

**Response 200** (ChangeLogListResponse):
```json
{
  "total": 142,
  "page": 1,
  "limit": 50,
  "items": [
    {
      "id": 500,
      "project_layer_id": 12,
      "layer_name": "AA_PHOTO",
      "column_name": "SP_PREBAKE_TEMP_C",
      "old_value": "110",
      "new_value": "115",
      "change_type": "manual",
      "changed_by": 1,
      "changed_by_name": "Kim Engineer",
      "changed_at": "2026-02-10T14:25:00Z"
    }
  ]
}
```

**Error 404**: Project not found.

**Note**: This enhances the existing endpoint. The response schema is backward-compatible with the addition of the `page` field. Existing consumers using `offset` will continue to work; `page` is the preferred parameter going forward.

### 3.2 Unified Timeline Endpoint

#### GET /api/projects/{project_id}/changelog/timeline

Returns a unified timeline combining cell changes and status transitions.

**Query Parameters**:
| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| page | integer | No | 1 | Page number |
| limit | integer | No | 50 | Items per page (max 200) |

**Response 200** (TimelineResponse):
```json
{
  "total": 85,
  "page": 1,
  "limit": 50,
  "groups": [
    {
      "date": "2026-02-10",
      "entries": [
        {
          "id": "status-5",
          "entry_type": "status_change",
          "timestamp": "2026-02-10T14:30:00Z",
          "user_id": 1,
          "user_name": "Kim Engineer",
          "details": {
            "from_status": "draft",
            "to_status": "review",
            "comment": "Ready for review"
          }
        },
        {
          "id": "change-500",
          "entry_type": "cell_change",
          "timestamp": "2026-02-10T14:25:00Z",
          "user_id": 1,
          "user_name": "Kim Engineer",
          "details": {
            "layer_name": "AA_PHOTO",
            "column_name": "SP_PREBAKE_TEMP_C",
            "old_value": "110",
            "new_value": "115",
            "change_type": "manual"
          }
        },
        {
          "id": "change-498",
          "entry_type": "cell_change",
          "timestamp": "2026-02-10T13:50:00Z",
          "user_id": 1,
          "user_name": "Kim Engineer",
          "details": {
            "layer_name": "AA_PHOTO",
            "column_name": "SP_PR_THICK",
            "old_value": "800",
            "new_value": "850",
            "change_type": "recipe"
          }
        }
      ]
    },
    {
      "date": "2026-02-09",
      "entries": [
        {
          "id": "change-450",
          "entry_type": "cell_change",
          "timestamp": "2026-02-09T11:00:00Z",
          "user_id": 1,
          "user_name": "Kim Engineer",
          "details": {
            "layer_name": "VIA2_PHOTO",
            "column_name": null,
            "old_value": null,
            "new_value": null,
            "change_type": "backbone",
            "backbone_info": "PROD-2024X -> PROD-2024Y (full column replacement)"
          }
        }
      ]
    }
  ]
}
```

**Error 404**: Project not found.

**Design Note**: The `id` field uses a type-prefixed format ("status-{id}" or "change-{id}") to ensure uniqueness across the two source tables. The `entry_type` field is the primary discriminator for frontend rendering.

### 3.3 Cell History Endpoint

#### GET /api/projects/{project_id}/changelog/cell

Returns change history for a specific cell.

**Query Parameters**:
| Parameter | Type | Required | Description |
|---|---|---|---|
| project_layer_id | integer | Yes | The project_layer record ID |
| column_name | string | Yes | The column name |

**Response 200** (CellHistoryResponse):
```json
{
  "project_layer_id": 12,
  "layer_name": "AA_PHOTO",
  "column_name": "SP_PREBAKE_TEMP_C",
  "total": 3,
  "items": [
    {
      "id": 500,
      "old_value": "110",
      "new_value": "115",
      "change_type": "manual",
      "changed_by": 1,
      "changed_by_name": "Kim Engineer",
      "changed_at": "2026-02-10T14:25:00Z"
    },
    {
      "id": 320,
      "old_value": "105",
      "new_value": "110",
      "change_type": "backbone",
      "changed_by": 1,
      "changed_by_name": "Kim Engineer",
      "changed_at": "2026-02-09T11:00:00Z"
    },
    {
      "id": 100,
      "old_value": null,
      "new_value": "105",
      "change_type": "backbone",
      "changed_by": 1,
      "changed_by_name": "Kim Engineer",
      "changed_at": "2026-02-08T09:30:00Z"
    }
  ]
}
```

**Error 404**: Project not found or project_layer_id not belonging to this project.
**Error 422**: Missing required query parameters.

### 3.4 Version History Endpoint

#### GET /api/projects/{project_id}/versions

Returns all revisions of the same product as the specified project.

**Response 200** (VersionHistoryResponse):
```json
{
  "product_id": 1,
  "product_name": "PROD-2025A",
  "current_project_id": 3,
  "versions": [
    {
      "project_id": 3,
      "revision": 3,
      "status": "draft",
      "is_latest": true,
      "is_current": true,
      "created_by_name": "Kim Engineer",
      "created_at": "2026-02-10T10:00:00Z"
    },
    {
      "project_id": 2,
      "revision": 2,
      "status": "archived",
      "is_latest": false,
      "is_current": false,
      "created_by_name": "Kim Engineer",
      "created_at": "2026-01-15T09:00:00Z"
    },
    {
      "project_id": 1,
      "revision": 1,
      "status": "archived",
      "is_latest": false,
      "is_current": false,
      "created_by_name": "Park Senior",
      "created_at": "2025-12-01T08:00:00Z"
    }
  ]
}
```

**Error 404**: Project not found.

**Note**: This endpoint resolves versions from the project's `product_id`, querying all projects with the same `product_id`, ordered by revision DESC. The `is_current` flag marks the project matching the request's `project_id` to support UI highlighting. This complements the existing `GET /api/projects/by-product/{product_id}/revisions` with project-centric access.

---

## 4. UI Specifications

### 4.1 Change History Panel

**Location**: Right-side slide-out panel (~350px) replacing the current inline bottom table (`ChangeHistoryPanel.tsx` with `h-56` height).
**Trigger**: "Change History" button in the editor toolbar (next to existing Save, Validate buttons).
**Rationale**: The current bottom inline layout competes for vertical space with ValidationPanel and CommentPanel, creating congestion. Converting to a right-side slide-out frees the bottom area for validation/comments while providing a dedicated, taller timeline view.

**Target Layout**:
```
+-----------+---------------------------+------------------+
| LayerNav  |  Toolbar: [Save] [Valid.] |                  |
| (left)    |  [Recipe] [ChangeHistory] |                  |
|           +---------------------------+  ChangeHistory   |
|           |                           |  (slide-out,     |
|           |  AG Grid Editor           |   ~350px,        |
|           |  (condition table)        |   timeline view) |
|           |                           |                  |
|           +---------------------------+  Filters:        |
|           |  ValidationPanel          |  Layer: [All  v] |
|           +---------------------------+  Type:  [All  v] |
|           |  CommentPanel             |  User:  [All  v] |
+-----------+---------------------------+                  |
                                        |  --- 2026-02-10  |
                                        |                  |
                                        |  14:30 Kim Eng.  |
                                        |  [flag] Status   |
                                        |  Draft -> Review |
                                        |                  |
                                        |  14:25 Kim Eng.  |
                                        |  [pen] Manual    |
                                        |  AA_PHOTO        |
                                        |  SP_PREBAKE_TEMP |
                                        |   110 -> 115     |
                                        |                  |
                                        |  13:50 Kim Eng.  |
                                        |  [file] Recipe   |
                                        |  AA_PHOTO        |
                                        |  SP_PR_THICK     |
                                        |   800 -> 850     |
                                        |                  |
                                        |  --- 2026-02-09  |
                                        |                  |
                                        |  11:00 Kim Eng.  |
                                        |  [link] Backbone |
                                        |  VIA2_PHOTO      |
                                        |  PROD-2024X ->   |
                                        |   PROD-2024Y     |
                                        |                  |
                                        |  [Load More]     |
                                        +------------------+
```

**Interactions**:
- Panel width: ~350px, resizable not required
- Filter dropdowns populated from the timeline data (distinct layers, users, types)
- Clicking a cell_change entry highlights the corresponding cell in AG Grid
- Clicking a status_change or backbone entry does not navigate (no specific cell target)
- "Load More" button fetches the next page of timeline entries
- Panel state (open/closed) persists during the editor session (Zustand)

### 4.2 Cell History Modal

**Trigger**: Right-click context menu on any cell in AG Grid -> "View History" option.

```
+------------------------------------------------------+
|  Cell History: SP_PREBAKE_TEMP_C                     |
|  Layer: AA_PHOTO                                     |
+------------------------------------------------------+
|                                                      |
|  +----------+----------+--------+------+------+      |
|  | Time     | User     | Type   | Old  | New  |      |
|  +----------+----------+--------+------+------+      |
|  | 02-10    | Kim      | Manual | 110  | 115  |      |
|  | 14:25    | Engineer |        |      |      |      |
|  +----------+----------+--------+------+------+      |
|  | 02-09    | Kim      | Back-  | 105  | 110  |      |
|  | 11:00    | Engineer | bone   |      |      |      |
|  +----------+----------+--------+------+------+      |
|  | 02-08    | Kim      | Back-  | --   | 105  |      |
|  | 09:30    | Engineer | bone   |      |      |      |
|  +----------+----------+--------+------+------+      |
|                                                      |
|  3 changes total                                     |
|                                                      |
|                                     [Close]          |
+------------------------------------------------------+
```

**Interactions**:
- Modal opens centered, max height 500px with scroll
- Old value "null" displayed as "--" (initial creation from backbone)
- Change type displayed with abbreviated labels: "Manual", "Backbone", "Recipe"
- No pagination needed (cell-level changes typically < 20 entries)

### 4.3 Version History Panel

**Location**: Accessible from the project detail header area in the condition editor page.

```
+--------------------------------------------------------------+
|  Project: PROD-2025A (v3 - Draft)        [Version History v] |
+--------------------------------------------------------------+
|                                                              |
|  +----------------------------------------------------------+
|  | Version History                                          |
|  +----------------------------------------------------------+
|  |                                                          |
|  |  v3  [Draft]     2026-02-10  Kim Engineer   * current    |
|  |  v2  [Archived]  2026-01-15  Kim Engineer   [View]       |
|  |  v1  [Archived]  2025-12-01  Park Senior    [View]       |
|  |                                                          |
|  +----------------------------------------------------------+
|                                                              |
```

**Interactions**:
- Dropdown or collapsible panel toggled by "Version History" button
- Status badges use color coding: Draft=blue, Review=yellow, Approved=green, Archived=gray
- Current version row has accent background/bold styling
- "View" button on archived versions navigates to read-only editor view
- Approved version row also has a "View" link (read-only)
- Only the current version row does not have a "View" link (already viewing)

### 4.4 Read-Only Archived View

**When** navigating to an archived or approved version from the version history panel:

```
+--------------------------------------------------------------+
|  [!] ARCHIVED - Read Only (v2)           [Back to Current]   |
+--------------------------------------------------------------+
|                                                              |
|  (AG Grid displayed with all editing disabled)               |
|  (No Save, Validate, Recipe Upload buttons)                  |
|  (Toolbar shows only: Change History, Version History)       |
|                                                              |
+--------------------------------------------------------------+
```

**Interactions**:
- Prominent banner indicates read-only state with version number
- "Back to Current" button navigates to the is_latest=true project for the same product
- AG Grid renders with `editable: false` on all columns
- Toolbar hides mutation actions (Save, Validate, Recipe Upload)
- Change History and Version History remain accessible in read-only mode

---

## 5. Data Models

### 5.1 Existing Database Tables (No Migration Required)

All required tables exist with correct schema. No database migration is needed.

**change_logs** (populated by Phase 1/2 services):
| Column | Type | Description |
|---|---|---|
| id | SERIAL PK | Auto-increment ID |
| project_layer_id | FK -> project_layers | Target layer |
| column_name | VARCHAR(100) | Column that was changed |
| old_value | TEXT NULL | Previous value |
| new_value | TEXT NULL | New value |
| change_type | VARCHAR(20) | "manual", "backbone", "recipe" |
| changed_by | FK -> users | User who made the change |
| changed_at | TIMESTAMPTZ | When the change occurred |

**project_status_logs** (populated by SPEC-003):
| Column | Type | Description |
|---|---|---|
| id | SERIAL PK | Auto-increment ID |
| project_id | FK -> projects | Target project |
| from_status | VARCHAR(20) | Previous status |
| to_status | VARCHAR(20) | New status |
| changed_by | FK -> users | User who changed status |
| comment | TEXT NULL | Optional comment |
| changed_at | TIMESTAMPTZ | When the transition occurred |

**projects** (revision fields from SPEC-002):
| Column | Type | Description |
|---|---|---|
| revision | INTEGER | Version number (1, 2, 3...) |
| parent_project_id | FK -> projects NULL | Links to previous version |
| is_latest | BOOLEAN | True for the most recent version |

### 5.2 Index Considerations

The following indexes are recommended for query performance (may already exist or can be added as needed):

- `change_logs.changed_at DESC` - For timeline ordering
- `change_logs(project_layer_id, column_name)` - For cell-level history queries
- `project_status_logs.changed_at DESC` - For timeline ordering
- `projects(product_id, revision DESC)` - For version history queries

**Note**: Index creation decisions should be made during implementation based on actual query plans and data volume. These are recommendations, not requirements for this SPEC.

---

## 6. Technical Architecture

### 6.1 File Change Map

**Modified Backend Files** (existing files to enhance):

```
backend/app/
  services/
    change_log_service.py   # Add timeline aggregation, cell history, enhanced filters (change_type, user, date range)
  routers/
    projects.py             # Add new endpoints: timeline, cell-history, versions
  schemas/
    project.py              # Add new response schemas: TimelineResponse, CellHistoryResponse, VersionHistoryResponse
```

**New Backend Files**:

```
backend/app/
  schemas/
    changelog.py            # (Optional) Separate changelog schemas if project.py grows too large
```

**Modified Frontend Files** (existing files to enhance):

```
frontend/src/
  components/editor/
    ChangeHistoryPanel.tsx      # Convert from inline bottom table (h-56) to RIGHT SIDE SLIDE-OUT with timeline view
    ConditionGrid.tsx           # Add "View History" context menu item in ALL project states (draft, review, approved, archived)
  pages/
    ConditionEditorPage.tsx     # Integrate slide-out panel, read-only mode for archived versions, version history access
  api/
    projects.ts                 # Add API calls: timeline, cell history, version history
  hooks/
    useProjects.ts              # Add React Query hooks: useTimeline, useCellHistory, useVersionHistory
  types/
    index.ts                    # Add TypeScript types: TimelineEntry, CellHistoryItem, VersionHistoryItem
  stores/
    useEditorStore.ts           # Add panel open/close state for change history slide-out
```

**New Frontend Files**:

```
frontend/src/
  components/editor/
    ChangeHistoryEntry.tsx      # Single timeline entry component (renders cell_change vs status_change)
    ChangeHistoryFilters.tsx    # Filter controls (layer, type, user dropdowns)
    CellHistoryModal.tsx        # Cell-level history popup triggered by right-click "View History"
    VersionHistoryPanel.tsx     # Version list dropdown/panel accessible from project header
    ReadOnlyBanner.tsx          # Prominent "Archived - Read Only" banner for non-current versions
```

**Design Decision**: Extend existing router, service, and frontend components rather than creating parallel files. The change history is fundamentally about the project entity, so it belongs in the projects domain. The existing `change_log_service.py` already handles the core query logic and will be extended. On the frontend, the existing `ChangeHistoryPanel.tsx` will be converted from its current inline bottom layout to a right-side slide-out to resolve bottom panel congestion with ValidationPanel and CommentPanel.

### 6.2 Backend Service Methods

**Enhanced `change_log_service.py`**:

```python
# Existing (enhanced with new filters)
async def get_change_logs(db, project_id, *, layer_id, column_name,
                          change_type, changed_by, date_from, date_to,
                          page, limit) -> ChangeLogListResponse

# New
async def get_timeline(db, project_id, *, page, limit) -> TimelineResponse

# New
async def get_cell_history(db, project_id, *,
                           project_layer_id, column_name) -> CellHistoryResponse

# New (or extend project_service.py)
async def get_version_history(db, project_id) -> VersionHistoryResponse
```

**Timeline Aggregation Strategy**:
1. Query `change_logs` for the project's project_layer_ids with user join
2. Query `project_status_logs` for the project_id with user join
3. Merge both result sets into a unified list
4. Sort by timestamp DESC
5. Apply pagination to the merged list
6. Group by date for the response

**Implementation Note**: The merge-and-sort can be done in Python after two separate queries (simpler) or via a SQL UNION ALL with ORDER BY (more efficient for large datasets). The implementation should start with the Python approach and optimize to SQL UNION if performance requires it.

### 6.3 Frontend Structure

Frontend file changes are consolidated in Section 6.1 File Change Map above, clearly distinguishing between modified existing files and new files.

### 6.4 Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Timeline query strategy | Python merge (initial), SQL UNION (if needed) | Start simple; change_logs rarely exceed 1000 records per project |
| Panel UI pattern | Right-side slide-out replacing current bottom inline panel | Resolves bottom panel congestion with ValidationPanel and CommentPanel; frees vertical space; provides taller timeline view; consistent with side-panel patterns in modern editors; no library dependency |
| Cell history trigger | AG Grid context menu | Extends existing right-click pattern from backbone/recipe features |
| Pagination strategy | "Load More" button | Infinite scroll adds complexity; Load More is simpler and sufficient |
| Version history access | Project-centric endpoint | Avoids requiring frontend to know product_id; server resolves from project |
| Read-only mode | AG Grid `editable: false` + toolbar conditional rendering | AG Grid Community supports editable toggling natively |

---

## 7. Constraints

### 7.1 Technical Constraints

- **No database migration required**: All tables exist with correct schema
- **Phase 1 auth model**: User identification via `X-User-Id` header (dropdown selection), not JWT
- **AG Grid Community Edition**: Context menu API and editable toggling available in Community edition
- **SPEC-003 prerequisite**: `project_status_logs` data will only be populated after SPEC-003 is implemented; timeline should gracefully handle empty status logs
- **Backward compatibility**: The enhanced `GET /api/projects/{id}/change-logs` must remain compatible with existing consumers (new filters are optional)

### 7.2 Business Constraints

- Change history and status logs are append-only; no edit/delete API should be exposed
- Version history must show all revisions regardless of status (including archived)
- Read-only view of archived versions must prevent any data modification
- Cell history should load quickly (target < 500ms) as it is triggered by right-click

### 7.3 Performance Constraints

- Timeline pagination prevents loading all change_logs at once (some projects may have 500+ entries)
- Cell history does not require pagination (typically < 20 changes per cell)
- Version history does not require pagination (typically < 10 revisions per product)

---

## 8. Test Strategy

### 8.1 Backend Tests (pytest)

**Enhanced Change Log Tests** (`tests/test_changelog.py`):
- Filter by change_type (manual, backbone, recipe)
- Filter by changed_by (user ID)
- Filter by date_from and date_to range
- Combined filters (layer_id + change_type + date range)
- Pagination (page parameter, total count accuracy)
- Project not found returns 404

**Timeline Tests** (`tests/test_timeline.py`):
- Timeline with only cell changes (no status logs yet)
- Timeline with cell changes and status transitions mixed
- Correct merge ordering by timestamp
- Date grouping correctness
- User display name resolution
- Pagination across merged data
- Empty project returns empty timeline
- Project not found returns 404

**Cell History Tests** (`tests/test_cell_history.py`):
- Cell with multiple changes returns correct history
- Cell with no changes returns empty items with message
- project_layer_id validation (must belong to project)
- Required parameters validation (422 on missing params)

**Version History Tests** (`tests/test_version_history.py`):
- Single version project returns one entry
- Multi-version project returns all revisions ordered by revision DESC
- is_current flag correctly set for requested project
- Creator display name resolved
- Project not found returns 404

### 8.2 Frontend Tests (Vitest)

**Utility Tests**:
- Timeline data grouping function (group entries by date)
- Timeline entry type discriminator (cell_change vs status_change rendering)
- Date formatting utility (ISO to display format)
- Cell navigation helper (extract row/column from change entry)

**Component Tests** (optional):
- ChangeHistoryPanel renders date groups and entries
- ChangeHistoryFilters updates filter state
- CellHistoryModal renders table with change records
- VersionHistoryPanel renders version list with correct highlighting
- ReadOnlyBanner displays version number and back link

---

## 9. Traceability

| Requirement | API | UI Component | Test |
|---|---|---|---|
| REQ-001 | GET /api/projects/{id}/changelog (enhanced) | ChangeHistoryPanel (via filters) | test_changelog_filters |
| REQ-002 | GET /api/projects/{id}/changelog/timeline | ChangeHistoryPanel | test_timeline_merge |
| REQ-003 | Timeline response schema | ChangeHistoryEntry | test_timeline_user_names |
| REQ-004 | Timeline date grouping | ChangeHistoryPanel (date headers) | test_timeline_date_groups |
| REQ-005 | Pagination params on both endpoints | ChangeHistoryPanel (Load More) | test_pagination |
| REQ-006 | N/A | ConditionEditorPage (toolbar button) | Manual/E2E |
| REQ-007 | N/A | ChangeHistoryPanel (layout) | Manual/E2E |
| REQ-008 | N/A | ChangeHistoryEntry (action type icons) | Manual/E2E |
| REQ-009 | N/A | ChangeHistoryFilters | test_filter_state |
| REQ-010 | N/A | ChangeHistoryPanel (cell click handler) | Manual/E2E |
| REQ-011 | N/A | ChangeHistoryPanel (Load More) | Manual/E2E |
| REQ-012 | GET /api/projects/{id}/changelog/cell | CellHistoryModal | test_cell_history |
| REQ-013 | Cell history response schema | CellHistoryModal (table) | test_cell_history_format |
| REQ-014 | Cell history ordering | CellHistoryModal | test_cell_history_ordering |
| REQ-015 | Empty cell history response | CellHistoryModal (empty state) | test_cell_history_empty |
| REQ-016 | GET /api/projects/{id}/versions | VersionHistoryPanel | test_version_history |
| REQ-017 | N/A | VersionHistoryPanel (layout) | Manual/E2E |
| REQ-018 | Version history is_current flag | VersionHistoryPanel (highlight) | test_version_current_flag |
| REQ-019 | N/A | VersionHistoryPanel (View link) | Manual/E2E |
| REQ-020 | N/A | ReadOnlyBanner + AG Grid editable:false | Manual/E2E |
| REQ-021 | No mutation endpoints | N/A | test_no_mutation_apis |
| REQ-022 | 404 on invalid project | N/A | test_project_not_found |

---

## Implementation Notes

### M1 - Backend API Enhancement (Completed 2026-02-16)

**Implemented:**
- Enhanced `GET /api/projects/{id}/change-logs` with `change_type`, `changed_by`, `date_from`, `date_to` query filters and `page`/`limit` pagination
- New unified timeline endpoint `GET /api/projects/{id}/change-logs/timeline` merging change_logs and project_status_logs
- New cell history endpoint `GET /api/projects/{id}/change-logs/cell/{project_layer_id}/{column_name}`
- New version history endpoint `GET /api/projects/{id}/versions`
- Timeline filtering: server-side `layer_id`, `change_type`, `changed_by` parameters added after M2 integration review

**Tests:** 47 new backend tests across 4 test files (test_timeline.py, test_changelog_enhanced.py, test_cell_history.py, test_version_history.py)

### M2 - Change History Panel + Cell History Modal (Completed 2026-02-17)

**Implemented:**
- ChangeHistoryPanel: Right-side 350px slide-out with date-grouped unified timeline
- ChangeHistoryEntry: Color-coded entry renderer (manual=blue, backbone=purple, recipe=green, status=orange)
- ChangeHistoryFilters: Korean-localized filter dropdowns (Layer, Type, User)
- CellHistoryModal: Cell-level change history table modal
- ConditionGrid: Custom HTML context menu with viewport boundary clamping
- EditorHeader: Change History toggle button
- AG Grid auto-resize on panel toggle (sizeColumnsToFit with 300ms delay)
- Zustand store: isHistoryPanelOpen, cellHistoryTarget states

**UX fixes applied:**
1. AG Grid column resize on panel open/close
2. Context menu viewport boundary clamping
3. Filter dropdown Korean localization
4. Status filter Load More count separation
5. Layer column browser context menu restoration

**Files created:** 3 new components (ChangeHistoryEntry, ChangeHistoryFilters, CellHistoryModal)
**Files modified:** 8 existing files (ChangeHistoryPanel, ConditionGrid, EditorHeader, ConditionEditorPage, types, API, hooks, store)

### M3 - Version History + Read-Only (Planned)

Not yet implemented. Scope: Version history panel UI, read-only condition viewer for archived versions, version comparison (optional).
