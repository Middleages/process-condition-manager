# SPEC-004: Implementation Plan

**SPEC ID**: SPEC-004
**Title**: Change History Panel and Version History
**Phase**: 3 (Workflow & Output)

---

## 0. Existing Code Inventory

Many components assumed to be new in the original SPEC already exist. This plan distinguishes between files that need **enhancement** versus files that are **truly new**.

### Existing Frontend Files (to be Enhanced)

| File | Current State | Enhancement Needed |
|---|---|---|
| `frontend/src/components/editor/ChangeHistoryPanel.tsx` | Inline bottom panel (h-56, table format) with layer/column filters | Convert to right-side slide-out panel with unified timeline view |
| `frontend/src/components/editor/StatusTimeline.tsx` | Standalone status transition visualization using `useStatusHistory` | May be merged into unified timeline or kept for CommentPanel use |
| `frontend/src/components/projects/VersionHistoryModal.tsx` | Modal dialog with product revision list, uses `useProductRevisions` | Enhance or replace with header-area panel; add status badges, read-only navigation |
| `frontend/src/hooks/useProjects.ts` | Has `useChangeLogs(projectId, params)` and `useProductRevisions(productId)` | Add new hooks: `useTimeline`, `useCellHistory`, `useVersionHistory` |
| `frontend/src/hooks/useComments.ts` | Has `useStatusHistory(projectId)` | No change needed (used by CommentPanel) |
| `frontend/src/api/projects.ts` | Has `getChangeLogs()`, `getStatusHistory()`, `getProductRevisions()` | Add new API functions for timeline, cell history, project-centric version history |
| `frontend/src/types/index.ts` | Has `ChangeLogItem`, `ChangeLogListResponse`, `StatusHistoryItem`, `StatusHistoryResponse` | Add timeline, cell history, version history types |
| `frontend/src/components/editor/ConditionGrid.tsx` | Has `handleCellContextMenu` gated to review state + reviewer/admin role only | Add "View History" context menu item available in ALL project states |

### Existing Backend Files (to be Enhanced)

| File | Current State | Enhancement Needed |
|---|---|---|
| `backend/app/services/change_log_service.py` | Has `get_change_logs()` with `layer_id`, `column_name` filters and offset pagination | Add `change_type`, `changed_by`, `date_from`, `date_to` filters; add page-based pagination; add `get_timeline()` and `get_cell_history()` |
| `backend/app/routers/projects.py` | Has `GET /{project_id}/change-logs` and `GET /{project_id}/status-history` | Add timeline, cell history, version history endpoints |
| `backend/app/schemas/project.py` | Has `ChangeLogResponse`, `ChangeLogListResponse` | Add timeline, cell history, version history schemas |
| `backend/app/services/project_service.py` | Has `get_product_revisions()` | Add project-centric `get_version_history()` |

### Current Layout (Before SPEC-004)

```
EditorHeader -> StatusBanner -> CategoryTabs
+-- LayerNavPanel --+-- ConditionGrid (AG Grid) -----------------------+
|  (left side)      |                                                  |
|                   +-- ValidationPanel (bottom, conditional)          |
|                   +-- ChangeHistoryPanel (bottom, inline, h-56)      |
|                   +-- CommentPanel (bottom, collapsible)             |
+-------------------+--------------------------------------------------+
```

### Target Layout (After SPEC-004)

```
EditorHeader -> StatusBanner -> CategoryTabs
+-- LayerNav --+-- ConditionGrid ---------------+-- ChangeHistory ----+
|  (left)      |                                |  (slide-out,        |
|              |                                |   ~350px,           |
|              +-- ValidationPanel              |   timeline view)    |
|              +-- CommentPanel                 |                     |
+--------------+--------------------------------+---------------------+
```

---

## 1. Implementation Milestones

### Milestone 1: Backend API Enhancement (Priority: High)

**Goal**: Enhance existing changelog service with additional filters, implement timeline aggregation, cell history, and project-centric version history endpoints. No new models or migrations needed.

**Modified Files**:

1. **Enhanced Pydantic Schemas** (`backend/app/schemas/project.py` - Modified)
   - TimelineEntry: unified entry with entry_type discriminator, user info, detail variants
   - TimelineGroup: date string + list of TimelineEntry
   - TimelineResponse: total, page, limit, groups
   - CellHistoryItem: id, old_value, new_value, change_type, changed_by, changed_by_name, changed_at
   - CellHistoryResponse: project_layer_id, layer_name, column_name, total, items
   - VersionItem: project_id, revision, status, is_latest, is_current, created_by_name, created_at
   - VersionHistoryResponse: product_id, product_name, current_project_id, versions
   - Extend existing ChangeLogListResponse with `page` field

2. **Enhanced Change Log Service** (`backend/app/services/change_log_service.py` - Modified)
   - Add `change_type`, `changed_by`, `date_from`, `date_to` filter parameters to existing `get_change_logs()`
   - Add page-based pagination (convert page to offset internally)
   - Maintain backward compatibility with existing offset parameter

3. **Timeline Service** (`backend/app/services/change_log_service.py` - Modified, new functions)
   - New `get_timeline(db, project_id, page, limit)` function
   - Query change_logs with user join for the project's project_layer_ids
   - Query project_status_logs with user join for the project_id
   - Merge results by timestamp in Python, apply pagination
   - Group by date (YYYY-MM-DD) for response structure

4. **Cell History Service** (`backend/app/services/change_log_service.py` - Modified, new function)
   - New `get_cell_history(db, project_id, project_layer_id, column_name)` function
   - Validate project_layer_id belongs to the project
   - Query change_logs filtered by project_layer_id + column_name
   - Return with user display names

5. **Version History Service** (`backend/app/services/project_service.py` - Modified, new function)
   - New `get_version_history(db, project_id)` function
   - Resolve product_id from the project
   - Query all projects with same product_id, ordered by revision DESC
   - Include creator display name via user join
   - Set is_current flag for the requested project_id

6. **Router Endpoints** (`backend/app/routers/projects.py` - Modified)
   - Enhance existing `GET /{project_id}/change-logs` with new query parameters (change_type, changed_by, date_from, date_to, page)
   - Add `GET /{project_id}/changelog/timeline`
   - Add `GET /{project_id}/changelog/cell`
   - Add `GET /{project_id}/versions`

7. **Backend Tests** (New)
   - `tests/test_changelog_enhanced.py` - Enhanced filter tests (change_type, changed_by, date range, page-based pagination)
   - `tests/test_timeline.py` - Timeline merge, ordering, date grouping, user name resolution, empty status logs
   - `tests/test_cell_history.py` - Cell-level query, validation, empty state
   - `tests/test_version_history.py` - Revision chain resolution, is_current flag, creator name

**Dependencies**: None (uses existing models and data from Phase 1/2)

---

### Milestone 2: Change History Slide-out Panel + Cell History Modal (Priority: High)

**Goal**: Convert the existing inline bottom ChangeHistoryPanel to a right-side slide-out panel with unified timeline view, filters, and cell navigation. Add cell history modal via right-click context menu in ALL project states.

**Modified Files**:

1. **ChangeHistoryPanel Conversion** (`frontend/src/components/editor/ChangeHistoryPanel.tsx` - Modified, major rewrite)
   - Convert from inline bottom panel (h-56, table format) to RIGHT SIDE SLIDE-OUT panel (~350px)
   - Replace table layout with unified timeline view (change_logs + status_logs merged, date-grouped)
   - Header with title, count, and close button
   - Filter section with layer, change type, and user dropdowns
   - Scrollable timeline area with date group headers
   - "Load More" button at bottom for pagination
   - Cell navigation: click timeline entry -> scroll/highlight cell in AG Grid
   - Integration with Zustand store for panel open/close state

2. **AG Grid Context Menu Enhancement** (`frontend/src/components/editor/ConditionGrid.tsx` - Modified)
   - Current `handleCellContextMenu` is gated: `projectStatus !== 'review' || (currentUserRole !== 'reviewer' && currentUserRole !== 'admin')` returns early
   - Add "View History" context menu item that works in **ALL** project states (draft, review, approved, archived)
   - Must coexist with existing comment context menu (which remains review-only for reviewer/admin)
   - Restructure handler to separate "always available" items from "review-only" items

3. **API Client Enhancement** (`frontend/src/api/projects.ts` - Modified)
   - Add `getTimeline(projectId, page, limit)` - Fetch unified timeline
   - Add `getCellHistory(projectId, projectLayerId, columnName)` - Fetch cell history
   - Add TypeScript type definitions matching new response schemas

4. **Hook Enhancement** (`frontend/src/hooks/useProjects.ts` - Modified)
   - Add `useTimeline(projectId, page)` - Paginated timeline query
   - Add `useCellHistory(projectId, projectLayerId, columnName)` - Cell history query (enabled on demand)

5. **Type Enhancement** (`frontend/src/types/index.ts` - Modified)
   - Add TimelineEntry, TimelineGroup, TimelineResponse
   - Add CellHistoryItem, CellHistoryResponse

6. **Zustand Store Update** (existing editor store - Modified)
   - Add `isHistoryPanelOpen` state
   - Add `toggleHistoryPanel()` action

7. **ConditionEditorPage Layout Update** (`frontend/src/pages/ConditionEditorPage.tsx` - Modified)
   - Move ChangeHistoryPanel from bottom stack to right-side slide-out
   - AG Grid adjusts width when panel opens (flex layout)
   - Add "Change History" toolbar button to toggle panel
   - Wire up cell history modal trigger from context menu

**New Files**:

8. **Timeline Entry Component** (`frontend/src/components/editor/ChangeHistoryEntry.tsx` - New)
   - Renders a single timeline entry based on entry_type
   - Action type icon/indicator (manual, backbone, recipe, status_change)
   - Time and user display
   - Detail rendering per entry type
   - Click handler for cell_change entries (navigates to cell in AG Grid)

9. **Filter Controls** (`frontend/src/components/editor/ChangeHistoryFilters.tsx` - New)
   - Layer dropdown (populated from project layers)
   - Change type dropdown (All, Manual, Backbone, Recipe, Status)
   - User dropdown (populated from distinct users in timeline)
   - Filter state management and callback

10. **Cell History Modal** (`frontend/src/components/editor/CellHistoryModal.tsx` - New)
    - Modal dialog with cell identification header (column name, layer name)
    - Table display with columns: Time, User, Type, Old Value, New Value
    - Empty state message when no history exists
    - Close button

11. **Frontend Tests** (New)
    - Timeline data transformation and date grouping utility tests
    - Timeline entry type rendering logic tests
    - Cell history data formatting tests

**Dependencies**: Milestone 1 (backend API endpoints)

---

### Milestone 3: Version History Panel + Read-Only Mode (Priority: High)

**Goal**: Enhance the existing VersionHistoryModal (or create VersionHistoryPanel in header area) with status badges and current version highlighting. Implement read-only mode for archived/approved versions.

**Modified Files**:

1. **Version History Enhancement** (`frontend/src/components/projects/VersionHistoryModal.tsx` - Modified, or new `VersionHistoryPanel.tsx`)
   - Option A: Enhance existing modal with status badges and navigation
   - Option B: Create new `VersionHistoryPanel` in header area (dropdown/collapsible) and deprecate modal
   - Either way: status badges (Draft=blue, Review=yellow, Approved=green, Archived=gray)
   - Current version highlighting (bold text or accent border)
   - "View" links on non-current versions -> navigate to read-only editor view
   - "Back to Current" navigation when viewing archived version

2. **API Client Enhancement** (`frontend/src/api/projects.ts` - Modified)
   - Add `getVersionHistory(projectId)` - Fetch project-centric version history

3. **Hook Enhancement** (`frontend/src/hooks/useProjects.ts` - Modified)
   - Add `useVersionHistory(projectId)` - Version history query

4. **Type Enhancement** (`frontend/src/types/index.ts` - Modified)
   - Add VersionItem, VersionHistoryResponse

5. **Condition Editor Page: Read-Only Mode** (`frontend/src/pages/ConditionEditorPage.tsx` - Modified)
   - Detect if current project is archived/approved status
   - Set AG Grid `editable: false` for archived projects
   - Conditionally render toolbar buttons (hide Save, Validate, Recipe Upload for read-only)
   - Show ReadOnlyBanner for archived/approved projects
   - Integrate VersionHistoryPanel in header area

6. **Route Handling** (`App.tsx` - potentially Modified)
   - Existing `/projects/:id/edit` route serves both editable and read-only views
   - Condition editor internally detects read-only mode based on project status

**New Files**:

7. **ReadOnlyBanner** (`frontend/src/components/editor/ReadOnlyBanner.tsx` - New)
   - Prominent banner indicating archived/read-only state
   - Shows version number
   - "Back to Current" navigation button (navigates to is_latest=true project for same product)

**Dependencies**: Milestone 1 (backend version history API)

---

## 2. Technical Approach

### 2.1 Backend Architecture

**Service Pattern**: Follow existing PCM backend pattern:
- Router receives request, validates via Pydantic schema
- Router calls service function with database session
- Service executes business logic and returns result
- Router serializes response via Pydantic response model

**Timeline Merge Strategy**:
```python
# Two separate queries (simple, maintainable)
change_entries = await query_change_logs(db, project_id)
status_entries = await query_status_logs(db, project_id)

# Merge and sort in Python
all_entries = merge_and_sort(change_entries, status_entries, key="timestamp")

# Apply pagination
paginated = all_entries[offset:offset+limit]

# Group by date
groups = group_by_date(paginated)
```

**Optimization Path** (if needed for large datasets):
```sql
-- SQL UNION ALL approach for efficient database-level merge
SELECT 'cell_change' as entry_type, changed_at as timestamp, ...
FROM change_logs cl
JOIN project_layers pl ON cl.project_layer_id = pl.id
WHERE pl.project_id = :project_id

UNION ALL

SELECT 'status_change' as entry_type, changed_at as timestamp, ...
FROM project_status_logs
WHERE project_id = :project_id

ORDER BY timestamp DESC
LIMIT :limit OFFSET :offset
```

### 2.2 Frontend Architecture

**State Management**: React Query for server state, Zustand for UI state:
- `useQuery` for timeline, cell history, version history (cacheable)
- Zustand for panel open/close state, selected filters

**Slide-out Panel Layout**: CSS flex layout pattern
```
/* Parent container */
.editor-container {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* AG Grid takes remaining space */
.grid-area {
  flex: 1;
  min-width: 0;
}

/* History panel fixed width when open */
.history-panel {
  width: 350px;
  flex-shrink: 0;
  transition: width 0.2s ease;
}
```

**Component Hierarchy**:
```
ConditionEditorPage
  +-- VersionHistoryPanel (header area)
  +-- ReadOnlyBanner (conditional, archived projects)
  +-- Toolbar (with Change History toggle button)
  +-- [flex container]
  |     +-- [main content area, flex:1]
  |     |     +-- AG Grid (with enhanced context menu)
  |     |     +-- ValidationPanel (bottom, conditional)
  |     |     +-- CommentPanel (bottom, collapsible)
  |     +-- ChangeHistoryPanel (slide-out right, ~350px)
  |           +-- ChangeHistoryFilters
  |           +-- ChangeHistoryEntry (repeated, grouped by date)
  +-- CellHistoryModal (overlay, on demand)
```

**AG Grid Context Menu Enhancement**:
```typescript
// Restructured to support items in ALL states + review-only items
const handleCellContextMenu = (event: CellContextMenuEvent) => {
  const { data, colDef } = event
  if (!data?.projectLayerId || !colDef?.field || colDef.field === 'layerName') return

  event.event?.preventDefault()

  // "View History" - available in ALL project states
  const menuItems = [
    { label: 'View History', action: () => openCellHistory(data.projectLayerId, colDef.field) },
  ]

  // "Add Comment" - only in review state for reviewer/admin (existing behavior)
  if (projectStatus === 'review' && (currentUserRole === 'reviewer' || currentUserRole === 'admin')) {
    menuItems.push({
      label: 'Add Comment',
      action: () => onCellRightClick(data.projectLayerId, data.layerName, colDef.field, displayName),
    })
  }

  showContextMenu(event.event, menuItems)
}
```

**Cell Navigation Pattern**:
```typescript
// Navigate to cell from history panel click
const navigateToCell = (layerName: string, columnName: string) => {
  const rowIndex = gridApi.getRowNode(layerName)?.rowIndex
  if (rowIndex !== undefined) {
    gridApi.ensureIndexVisible(rowIndex)
    gridApi.setFocusedCell(rowIndex, columnName)
    gridApi.flashCells({
      rowNodes: [gridApi.getRowNode(layerName)!],
      columns: [columnName],
    })
  }
}
```

---

## 3. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Large change_logs dataset (500+ per project) | Slow timeline loading | Medium | Pagination (50 per page), SQL UNION optimization if needed |
| SPEC-003 not yet implemented | Empty status_change entries in timeline | Expected | Timeline gracefully handles zero status logs; renders cell changes only |
| AG Grid context menu limitations in Community Edition | Custom context menu may need custom implementation | Medium | AG Grid Community `onCellContextMenu` is already used; extend with custom dropdown overlay (not `getContextMenuItems` which is Enterprise) |
| Context menu coexistence (View History + Add Comment) | Two context menu behaviors must work together | Medium | Restructure `handleCellContextMenu` to build menu items conditionally; "View History" always available, "Add Comment" review-only |
| Timeline merge ordering edge case (same timestamp) | Unstable sort | Low | Use secondary sort key (entry type, then ID) for deterministic ordering |
| Panel layout breaking AG Grid responsiveness | AG Grid may not resize properly when panel opens | Medium | Use CSS flex layout; panel takes fixed width, grid fills remaining space; test resize behavior |
| Slide-out panel transition disrupting grid state | AG Grid may lose scroll position or selection during resize | Low | Use `gridApi.sizeColumnsToFit()` after panel transition; debounce resize events |
| Version history chain broken (orphaned parent_project_id) | Incomplete version list | Low | Use product_id-based query (all projects with same product_id) rather than parent chain traversal |
| Existing ChangeHistoryPanel consumers need updating | Other components may reference the old inline panel | Low | The panel is only used in ConditionEditorPage; update all references during M2 |

---

## 4. Architecture Decisions

### 4.1 Extend Existing Files vs. New Files

**Decision**: Enhance existing backend and frontend files rather than creating parallel structures.

**Rationale**: The change history and version history are intrinsically tied to existing project entities. Backend services (`change_log_service.py`, `project_service.py`) already contain core query logic. Frontend components (`ChangeHistoryPanel.tsx`, `VersionHistoryModal.tsx`) already have the base structure. Extending these files keeps the codebase cohesive and avoids duplicate code.

### 4.2 Timeline Merge Strategy: Python vs. SQL UNION

**Decision**: Start with Python merge, optimize to SQL UNION if performance requires.

**Rationale**: The Python merge approach is simpler to implement, test, and debug. Most PCM projects will have < 500 change_log entries, making in-memory merge performant. SQL UNION is the optimization path if profiling reveals a bottleneck.

### 4.3 Version Resolution: Parent Chain vs. Product Query

**Decision**: Query all projects by product_id, not by traversing parent_project_id chain.

**Rationale**: The parent chain approach requires recursive queries and can break if any link is missing. Querying by product_id is a simple indexed query that always returns the complete version set. The existing `get_product_revisions()` already uses this approach.

### 4.4 Cell History Endpoint: Separate vs. Reuse Changelog

**Decision**: Create a dedicated `GET /{project_id}/changelog/cell` endpoint.

**Rationale**: While the existing changelog endpoint with filters could serve this purpose, a dedicated endpoint provides a simpler interface for the frontend (required params enforced), a focused response schema without unnecessary fields, and clearer intent in the API surface.

### 4.5 Read-Only Mode: Route-Based vs. State-Based

**Decision**: State-based detection within the existing editor route.

**Rationale**: Using a separate route (e.g., `/projects/:id/view`) would duplicate the editor page. Instead, the condition editor page checks the project status and toggles AG Grid editability and toolbar visibility. This keeps routing simple and avoids component duplication.

### 4.6 Slide-out Panel vs. Bottom Panel (UI Decision)

**Decision**: Convert ChangeHistoryPanel from inline bottom panel to right-side slide-out panel (~350px width).

**Rationale**: The bottom area is already congested with ValidationPanel and CommentPanel competing for vertical space. A right-side slide-out panel provides dedicated space for the timeline view, enables a richer vertical layout (date-grouped entries with filters), and AG Grid adjusts width naturally via CSS flex when the panel opens/closes.

### 4.7 Context Menu in All States

**Decision**: "View History" context menu available in all project states; comment context menu remains review-only.

**Rationale**: The current `handleCellContextMenu` in `ConditionGrid.tsx` gates the entire context menu to review state for reviewer/admin. SPEC-004 requires cell history access in all states. The handler must be restructured to separate always-available items (View History) from state-restricted items (Add Comment).

---

## 5. Milestone Dependencies

```
M1: Backend API Enhancement
  |
  +---> M2: Change History Slide-out Panel + Cell History Modal
  |
  +---> M3: Version History Panel + Read-Only Mode
```

- M2 depends on M1 (timeline and cell history APIs)
- M3 depends on M1 (version history API)
- M2 and M3 are independent of each other and can be developed in parallel after M1 completes
