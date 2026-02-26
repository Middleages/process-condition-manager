# SPEC-PROJECT-002: Implementation Plan

## Traceability Tag: SPEC-PROJECT-002

---

## Milestone Overview

| Milestone | Title | Priority | Dependencies |
|-----------|-------|----------|-------------|
| M1 | Schema Migration + Backend API | Primary Goal | SPEC-DEVICE-001 completed |
| M2 | Frontend - Device Ref Creation Modal | Secondary Goal | M1 completed |
| M3 | Short Product Support | Secondary Goal | M1, M2 completed |
| M4 | Backbone Matching + Empty Tables | Secondary Goal | M1 completed |

---

## M1: Schema Migration + Backend API

### Priority: Primary Goal
### Tag: SPEC-PROJECT-002-M1
### Dependencies: SPEC-DEVICE-001 (device_master, layer_master tables must exist)

### Technical Approach

1. **Schema Evolution**: Add device-ref columns to `projects` table using Alembic migration. Keep `product_id` nullable for backward compatibility. Add denormalized `line_id`, `product_name`, `part_id` for unique constraint enforcement.

2. **Dual-Path Creation**: Maintain existing `create_project()` for legacy callers. Add `create_project_v2()` with device-ref based flow. The API endpoint detects the request format and routes to the appropriate service method.

3. **Device Master Integration**: New service `device_master_service.py` queries `device_master` and `layer_master` tables. Provides validation, search, and layer retrieval functions.

4. **Unique Constraint**: Partial unique index `(line_id, product_name, process, part_id, revision) WHERE is_latest = true` prevents duplicate active projects at the database level. Application-level pre-check provides user-friendly error message.

### Implementation Steps

**Step 1: Alembic Migration**
- Add columns to `projects`: `device_master_id`, `process`, `device_type`, `header_metadata`, `line_id` (denormalized), `product_name` (denormalized), `part_id` (denormalized)
- Alter `product_id` to NULLABLE (was NOT NULL)
- Alter `main_backbone_id` to NULLABLE (support "No backbone")
- Create partial unique index `ix_projects_device_ref_active`
- Backfill: For existing projects, populate `line_id` from `products.line_id`, `product_name` from `products.product_name`, `part_id` from `products.part_id`

**Step 2: Model Updates**
- `backend/app/models/project.py`: Add new columns to `Project` model
- Add relationship: `device_master: Mapped["DeviceMaster | None"]`
- Update `__table_args__` if needed for new constraints

**Step 3: Pydantic Schemas**
- `backend/app/schemas/device_master.py` (NEW): `DeviceSearchResult`, `DeviceLayerItem`, `DuplicateCheckResponse`
- `backend/app/schemas/project.py`: Add `ProjectCreateRequestV2`, update `ProjectResponse` with `device_master_id`, `process`, `device_type`, `header_metadata`, denormalized `product_name`, `part_id`

**Step 4: Device Master Service**
- `backend/app/services/device_master_service.py` (NEW):
  - `search_devices(db, line_id, product_name, process, part_id)` - Cascading autocomplete search
  - `get_device_by_ref(db, line_id, product_name, process, part_id)` - Exact match
  - `get_device_layers(db, device_master_id)` - Fetch layers from layer_master
  - `get_device_header(db, device_master_id)` - Fetch header metadata

**Step 5: Project Service V2**
- `backend/app/services/project_service.py`: Add `create_project_v2()`:
  1. Validate device-ref against device_master
  2. Check for duplicate active projects
  3. Fetch layers from layer_master
  4. Filter layers for Short type
  5. Fetch backbone conditions (optional)
  6. Create project with header_metadata
  7. Create project_layers with backbone matching or empty conditions
  8. Log backbone matching summary

**Step 6: API Endpoints**
- `backend/app/routers/device_master.py` (NEW):
  - `GET /api/device-master/search?line_id=&product_name=&process=&part_id=` - Cascading search
  - `GET /api/device-master/{id}/layers` - Device layers
- `backend/app/routers/projects.py`:
  - Update `POST /api/projects` to accept both V1 and V2 schemas
  - Add `GET /api/projects/check-duplicate?line_id=&product_name=&process=&part_id=` - Duplicate check

**Step 7: Tests**
- Test device-ref based project creation (full type)
- Test duplicate detection (active project exists)
- Test UNIQUE constraint enforcement at DB level
- Test backward compatibility (V1 create still works)
- Test header_metadata population from device_master
- Test `product_id` nullable migration (existing data intact)

### Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| SPEC-DEVICE-001 not completed yet | Blocker | Clearly document dependency; define interface contract in advance |
| Migration backfill for denormalized columns fails on orphaned products | Medium | Handle NULL gracefully; skip orphans in backfill |
| Dual-path creation (V1 + V2) increases complexity | Medium | Clear separation in service layer; V1 marked as deprecated |
| Unique index creation fails on existing duplicate data | High | Pre-migration validation query to identify duplicates; manual resolution before migration |

---

## M2: Frontend - Device Ref Creation Modal

### Priority: Secondary Goal
### Tag: SPEC-PROJECT-002-M2
### Dependencies: M1 completed (API endpoints available)

### Technical Approach

1. **Cascading Dropdowns**: Four searchable Combobox components that cascade filter based on device_master data. Line -> Product Name -> Process -> Part ID, each narrowing the next dropdown's options.

2. **Debounced Duplicate Check**: Once all 4 fields are populated, debounced API call checks for existing active projects. Warning displayed inline if duplicate found.

3. **Auto-Population**: Header metadata and layer count auto-populated when device-ref combination resolves to a valid device_master record.

4. **Reuse Existing Components**: Use existing `Combobox` component (already used in current modal). Extend with multi-field search capability.

### Implementation Steps

**Step 1: API Client + Types**
- `frontend/src/api/deviceMaster.ts` (NEW):
  - `searchDevices(params)` - Cascading search API
  - `getDeviceLayers(deviceMasterId)` - Layer list
  - `checkDuplicate(params)` - Duplicate check
- `frontend/src/types/device.ts` (NEW):
  - `DeviceSearchResult`, `DeviceLayerItem`, `DuplicateCheckResponse`

**Step 2: React Query Hooks**
- `frontend/src/hooks/useDeviceMaster.ts` (NEW):
  - `useDeviceSearch(lineId, productName, process, partId)` - Cascading search with debounce
  - `useDeviceLayers(deviceMasterId)` - Layer list query
  - `useDuplicateCheck(lineId, productName, process, partId)` - Debounced duplicate check
  - `useDeviceHeader(lineId, productName, process, partId)` - Header metadata

**Step 3: ProjectCreateModal Rewrite**
- Replace current Line -> Product -> Backbone flow with:
  - Line (searchable dropdown, same as current)
  - Product Name (searchable dropdown from device_master)
  - Process (searchable dropdown, filtered by line + product)
  - Part ID (searchable dropdown, filtered by line + product + process)
  - Header preview section (auto-populated)
  - Type selector (Full / Short radio buttons)
  - Layer preview (count badge, expandable for Short)
  - Backbone selector (dropdown with "No backbone" option)
  - Duplicate warning (inline alert)

**Step 4: Update Project API Client**
- `frontend/src/api/projects.ts`: Update `createProject()` to send V2 payload
- `frontend/src/types/project.ts`: Update types for new response fields

### Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Cascading dropdown UX is slow (multiple API calls) | Medium | Debounce 300ms + caching via TanStack Query staleTime |
| device_master has many records causing slow search | Medium | Server-side LIMIT + fuzzy matching + indexed columns |
| Modal becomes too complex with all new fields | Medium | Progressive disclosure: show header/layers only after device-ref resolved |

---

## M3: Short Product Support

### Priority: Secondary Goal
### Tag: SPEC-PROJECT-002-M3
### Dependencies: M1 completed, M2 completed

### Technical Approach

1. **Layer Selection Panel**: New component `LayerSelectionPanel.tsx` with checkbox list, category grouping, Select All/Deselect All actions.

2. **Selective Layer Copy**: Backend `create_project_v2()` accepts `selected_layer_ids` parameter. Only creates project_layers for specified layers.

3. **Validation**: At least 1 layer must be selected for Short type. Frontend enforces this before submit.

### Implementation Steps

**Step 1: LayerSelectionPanel Component**
- `frontend/src/components/projects/LayerSelectionPanel.tsx` (NEW):
  - Props: `layers: DeviceLayerItem[]`, `selectedIds: number[]`, `onChange: (ids: number[]) => void`
  - Features: Checkbox per layer, category grouping, Select All / Deselect All, counter ("Selected: N/Total")
  - Layer row: checkbox + layer_name + step_seq + layer_number

**Step 2: Integration with ProjectCreateModal**
- Show LayerSelectionPanel when `device_type = 'short'`
- Track `selectedLayerIds` in modal state
- Pass to API on submit
- Disable "Create" button if Short type with 0 layers selected

**Step 3: Backend Validation**
- `create_project_v2()`: Validate `selected_layer_ids` are subset of device's layers
- Return 400 if any selected layer_id not in device's layer_master

### Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Layer list very long (60+ layers) | Low | Virtual scrolling or max-height with scroll; category grouping |
| User confusion between Full and Short types | Low | Clear explanation text + layer count preview |

---

## M4: Backbone Matching + Empty Tables

### Priority: Secondary Goal
### Tag: SPEC-PROJECT-002-M4
### Dependencies: M1 completed

### Technical Approach

1. **Layer-ID Matching**: Backbone conditions matched by `layer_id` (not layer_name). Unmatched project layers get empty conditions. Unmatched backbone layers are silently skipped.

2. **"No Backbone" Option**: When `backbone_product_id` is None, all project_layers created with `conditions = {}`, `backbone_conditions = {}`, `backbone_product_id = null`.

3. **Empty Conditions Handling**: Verify that existing downstream features (AG Grid editor, validation, export, revision) handle `conditions = {}` gracefully.

### Implementation Steps

**Step 1: Backbone Matching in create_project_v2**
- Use existing `BackboneRepository.get_backbone_layer_map()` for backbone conditions
- Match by `layer_id` key
- Log matching summary (matched, project-only, backbone-only)

**Step 2: "No Backbone" Path**
- If `backbone_product_id` is None:
  - Set `project.main_backbone_id = None`
  - All project_layers get `conditions = {}`, `backbone_conditions = {}`, `backbone_product_id = None`

**Step 3: Empty Conditions Verification**
- Verify AG Grid loads empty row without errors
- Verify validation service handles empty conditions
- Verify export service handles empty conditions (skip or empty cells)
- Verify condition save works from empty state
- Verify backbone comparison handles empty backbone_conditions

**Step 4: Frontend Backbone Dropdown**
- Add "No backbone (empty condition table)" as first option (value: null/empty)
- When selected, skip backbone-related validation
- Show info text: "All condition cells will start empty"

### Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Empty conditions break validation rules | Medium | Validation service already handles missing keys; verify with test |
| Export fails with empty conditions | Medium | Test export with empty project; handle gracefully |
| Backbone comparison fails with empty backbone_conditions | Low | BackboneComparisonPanel already handles null/empty check |

---

## Architecture Design

### Layer Responsibility

```
[Frontend]
  ProjectCreateModal (V2 - Device Ref)
    +-- Line Dropdown (existing)
    +-- ProductName/Process/PartID (NEW - from device_master)
    +-- HeaderPreview (NEW - auto-populated)
    +-- TypeSelector (NEW - Full/Short radio)
    +-- LayerSelectionPanel (NEW - Short type only)
    +-- BackboneDropdown (MODIFIED - "No backbone" option added)
    |
    +-- useDeviceMaster hooks (NEW)
         +-- GET /api/device-master/search
         +-- GET /api/device-master/{id}/layers
         +-- GET /api/projects/check-duplicate

[Backend API Layer]
  device_master.py router (NEW)
    +-- /search - Cascading autocomplete
    +-- /{id}/layers - Layer list
  projects.py router (MODIFIED)
    +-- POST /api/projects - V2 schema support
    +-- /check-duplicate - Active project check

[Backend Service Layer]
  device_master_service.py (NEW)
    +-- search_devices(), get_device_by_ref()
    +-- get_device_layers(), get_device_header()

  project_service.py (MODIFIED)
    +-- create_project_v2() (NEW)
    +-- create_project() (EXISTING - backward compat)
    |
    +-- BackboneRepository (EXISTING - unchanged)
         +-- get_backbone_layer_map()
         +-- validate_backbone_source()

[Database]
  device_master (NEW - from SPEC-DEVICE-001)
  layer_master (NEW - from SPEC-DEVICE-001)
  projects (MODIFIED - new columns)
  project_layers (UNCHANGED - same structure)
```

### Design Principles

1. **Backward Compatibility First**: Existing projects, APIs, and UIs remain functional. Migration adds columns, does not remove or rename.
2. **Progressive Enhancement**: New creation flow is additive. Old V1 flow remains as fallback during transition.
3. **Denormalization for Constraints**: `line_id`, `product_name`, `part_id` denormalized on `projects` for the unique index. Trade-off: slight data redundancy vs. robust constraint enforcement.
4. **Layer-ID as Universal Matcher**: All layer operations (backbone copy, backbone replacement, Short selection) use numeric `layer_id` for consistency.
5. **Empty as Valid State**: `conditions = {}` is a first-class state throughout the system.

### Performance Considerations

- **Device Search**: Cascading autocomplete requires indexed columns on device_master (line_id, product_name, process, part_id). Expected data: ~1000 devices, fast with B-tree indexes.
- **Duplicate Check**: Partial unique index `ix_projects_device_ref_active` makes the check O(log n) at DB level.
- **Layer List**: layer_master per device: ~30-60 rows. No performance concern.
- **Backbone Matching**: Unchanged from current system. Dictionary lookup O(1) per layer.
