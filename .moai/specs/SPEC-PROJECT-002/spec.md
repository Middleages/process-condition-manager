# SPEC-PROJECT-002: Device-Ref Based Project Creation

## Metadata

| Item | Value |
|------|-------|
| SPEC ID | SPEC-PROJECT-002 |
| Title | Device-Ref Based Project Creation |
| Status | Planned |
| Priority | High |
| Created | 2026-02-26 |
| Dependencies | SPEC-DEVICE-001 (device_master + layer_master tables) |
| Phase | Phase 5 (Enhancement) |
| Predecessor SPECs | SPEC-BACKBONE-001 (Dynamic Backbone), SPEC-EQP-001 (Column-based Equipment) |

---

## 1. Environment

### 1.1 Current System State

- **Project Creation Flow**: Line dropdown -> Product dropdown -> Backbone product dropdown -> All backbone conditions copied -> Draft project created
- **Product Selection**: Manual dropdown from `products` table. No authoritative device registry integration
- **Layer Source**: Target product's `product_layers` determines layer list. All layers are always copied (no subset/short product support)
- **Backbone Requirement**: Backbone product is mandatory. Cannot create a project with empty condition tables
- **Project Uniqueness**: Partial enforcement via `status.in_(['draft', 'review'])` check on `product_id`, but no UNIQUE constraint at DB level
- **Project Name**: Derived from `product_name` (via `products.product_name`). No composite naming from device-ref metadata
- **Header Metadata**: Not stored at project level. No pitch_size, shot_count, die_size, etc.

### 1.2 Current Code

**Backend:**
- `backend/app/models/project.py`: `Project` model with `product_id` FK, `main_backbone_id` FK, `status`, `revision`, `is_latest`
- `backend/app/models/product.py`: `Product(id, product_name, description, line_id, part_id)`, `Layer(id, layer_name, step_seq, layer_number)`, `ProductLayer(product_id, layer_id, conditions JSONB)`
- `backend/app/services/project_service.py`: `create_project(db, product_id, backbone_product_id, created_by)` - validates product, validates backbone, copies all backbone conditions
- `backend/app/schemas/project.py`: `ProjectCreateRequest(product_id, backbone_product_id, created_by)`, `ProjectResponse`, `ProjectDetailResponse`
- `backend/app/routers/projects.py`: `POST /api/projects` endpoint
- `backend/app/repositories/backbone_repository.py`: `BackboneRepository` for dynamic backbone eligibility

**Frontend:**
- `frontend/src/components/projects/ProjectCreateModal.tsx`: Line select -> Product Combobox -> Backbone Combobox -> Create
- `frontend/src/hooks/useProducts.ts`: `useProducts()`, `useBackboneProducts(lineId)`
- `frontend/src/api/projects.ts`: `createProject(data)`
- `frontend/src/types/project.ts`: `ProjectResponse`, `ProjectCreateRequest`

### 1.3 Gap Analysis

| Current (As-Is) | Target (To-Be) | Gap |
|------------------|----------------|-----|
| Product selected from `products` dropdown | Device-ref fields (line, product_name, process, part_id) from `device_master` | New data source + searchable input fields |
| No device metadata at project level | `header_metadata` JSONB (pitch_size, shot_count, die_size, etc.) | New columns + auto-population |
| All layers copied from backbone (full only) | Full or Short type; Short allows layer subset selection | Layer selection UI + selective copy logic |
| Backbone mandatory (cannot create empty tables) | Optional backbone; empty `conditions = {}` supported | "No backbone" option + empty init logic |
| Uniqueness via application-level check only | DB-level UNIQUE constraint on (line_id, product_name, process, part_id, revision) | Alembic migration + partial index |
| Project name = product_name | Auto-generated: `{product_name} \| {process} \| {part_id}` | New display name derivation |
| `product_id` FK references `products` table | `device_master_id` FK references `device_master` table | Schema migration + backward compat |
| Layer list from `product_layers` only | Layer list from `layer_master` (device-ref based) | New layer source + matching logic |

### 1.4 Technical Stack

- Backend: FastAPI + SQLAlchemy 2.x (async) + Pydantic v2 + PostgreSQL 16
- Frontend: React 18 + TypeScript + Zustand + AG Grid Community + TanStack Query
- Auth: JWT (access/refresh token) + RBAC (admin/reviewer/editor/developer)

---

## 2. Assumptions

| ID | Assumption | Confidence | Evidence | Risk (if wrong) |
|----|-----------|------------|----------|-----------------|
| A1 | `device_master` and `layer_master` tables from SPEC-DEVICE-001 exist and are populated before this SPEC is implemented | High | Hard dependency declared; SPEC-DEVICE-001 must complete first | Cannot proceed without device registry data source |
| A2 | The unique key for a project is (line_id, product_name, process, part_id, revision) with a partial index WHERE is_latest=true for active project uniqueness | High | User discussion confirmed composite key requirement | Duplicate projects for same device if not enforced |
| A3 | Existing projects (created before this SPEC) retain `product_id` FK and continue to work without migration of their data | High | Backward compatibility is essential; existing projects have no device_master reference | Data integrity issues if old projects are broken |
| A4 | "Short" products use a subset of layers from `layer_master` for the given device-ref combination. The user manually selects which layers to include | High | User discussion: "show layer selection UI -> user picks needed layers" | Full/Short distinction becomes unclear without explicit selection |
| A5 | Empty condition tables (`conditions = {}`) are valid for projects where no backbone is available or the user chooses "No backbone" | High | User confirmed: "Option: No backbone (empty condition table) for unregistered products" | Forces backbone selection even when unavailable |
| A6 | Backbone layer matching uses `layer_id` (numeric identifier from `layer_master`) for matching backbone layers to project layers | High | User confirmed: "Layer matching: by layer_id" | Layer name mismatches cause incorrect condition copying |
| A7 | Dynamic Backbone (SPEC-BACKBONE-001) continues to work. Backbone source remains Approved `project_layers.conditions` | High | User confirmed: "Dynamic Backbone continues to work" | Backbone resolution logic needs rework |
| A8 | `device_master` provides header metadata (pitch_size, shot_count, die_size, etc.) that is stored as denormalized JSONB on the project | Medium | User mentioned "fetch header info" from device_master | If device_master schema differs, JSONB structure needs adjustment |
| A9 | The `projects.product_id` column is retained for backward compatibility. New projects populate `device_master_id` instead (or in addition) | High | Migration strategy must not break existing data | Orphaned FK references if not handled carefully |
| A10 | `process` field represents a process type/step identifier that is part of the device-ref composite key, distinct from `product_name` and `part_id` | High | User spec: UNIQUE(line, product_name, process, part_id, revision) | Missing field in unique constraint causes false duplicates |

---

## 3. Requirements

### M1: Schema Migration + Backend API

#### 3.1 Projects Table Schema Changes

**REQ-PROJ-001** [Ubiquitous]
The system SHALL add the following columns to the `projects` table: `device_master_id` (FK to device_master, nullable), `process` (VARCHAR(100), nullable), `device_type` (VARCHAR(20) for 'full'/'short', default 'full'), and `header_metadata` (JSONB, nullable).

**REQ-PROJ-002** [Ubiquitous]
The system SHALL create a partial unique index on `projects` for columns `(line_id, product_name, process, part_id, revision)` WHERE `is_latest = true` to enforce active project uniqueness at the database level.

  - Acceptance Criteria:
    - Given a project exists with (line_id=1, product_name='X', process='P1', part_id='A', revision=1, is_latest=true)
    - When a new project attempts to insert with the same combination and is_latest=true
    - Then the database raises a unique constraint violation

**REQ-PROJ-003** [Ubiquitous]
The system SHALL retain the existing `product_id` column on `projects` as nullable for backward compatibility. Existing projects keep their `product_id` values unchanged.

  - Acceptance Criteria:
    - Given existing projects have non-null product_id values
    - When the migration is applied
    - Then all existing product_id values remain intact
    - And the column becomes nullable

#### 3.2 Device-Ref Based Project Creation API

**REQ-PROJ-010** [Event-Driven]
**WHEN** a client sends a project creation request with device-ref fields (line_id, product_name, process, part_id) **THEN** the system SHALL validate the combination against `device_master` and create a new project with the matched device_master_id.

  - Acceptance Criteria:
    - Given a valid device-ref combination exists in device_master
    - When POST /api/projects is called with {line_id, product_name, process, part_id, ...}
    - Then a new project is created with device_master_id populated
    - And header_metadata is auto-populated from device_master

**REQ-PROJ-011** [Event-Driven]
**WHEN** a project creation request provides device-ref fields **THEN** the system SHALL auto-populate `header_metadata` JSONB from the matched `device_master` record (pitch_size, shot_count, die_size, etc.).

  - Acceptance Criteria:
    - Given device_master has pitch_size=50, shot_count=120 for the matched device
    - When the project is created
    - Then project.header_metadata = {"pitch_size": 50, "shot_count": 120, ...}

**REQ-PROJ-012** [Event-Driven]
**WHEN** a project creation request provides device-ref fields **THEN** the system SHALL fetch the layer list from `layer_master` for the matched device and create corresponding `project_layers`.

  - Acceptance Criteria:
    - Given layer_master has 45 layers for the matched device
    - When a Full type project is created
    - Then 45 project_layers are created

**REQ-PROJ-013** [Unwanted]
The system SHALL NOT allow creation of a project if an active project (status in ['draft', 'review']) already exists for the same (line_id, product_name, process, part_id) combination.

  - Acceptance Criteria:
    - Given an active Draft project exists for device-ref (1, 'X', 'P1', 'A')
    - When another project creation is attempted for the same device-ref
    - Then HTTP 409 is returned with "Active project already exists"

**REQ-PROJ-014** [Ubiquitous]
The system SHALL auto-generate the project display name as `{product_name} | {process} | {part_id}`.

  - Acceptance Criteria:
    - Given product_name='PRODUCT_A', process='PHOTO_01', part_id='PA-001'
    - When the project is created
    - Then the display name renders as "PRODUCT_A | PHOTO_01 | PA-001"

**REQ-PROJ-015** [Event-Driven]
**WHEN** a project creation request specifies `device_type = 'full'` **THEN** the system SHALL create project_layers for ALL layers from layer_master for the matched device.

**REQ-PROJ-016** [Event-Driven]
**WHEN** a project creation request specifies `device_type = 'short'` with a `selected_layer_ids` list **THEN** the system SHALL create project_layers only for the specified layers.

  - Acceptance Criteria:
    - Given layer_master has 45 layers and user selects 10 layer_ids
    - When a Short type project is created
    - Then only 10 project_layers are created

#### 3.3 Unique Constraint Validation

**REQ-PROJ-017** [Event-Driven]
**WHEN** a project creation request is received **THEN** the system SHALL check for existing active projects with the same device-ref combination BEFORE attempting insertion, and return HTTP 409 with a descriptive error if a duplicate exists.

  - Acceptance Criteria:
    - Given a Draft project exists for (line=1, product='X', process='P1', part='A')
    - When creation is attempted for same combination
    - Then HTTP 409 with message identifying the conflicting project

**REQ-PROJ-018** [State-Driven]
**IF** the existing project for the same device-ref is in 'approved' or 'archived' status **THEN** a new project (revision+1) SHALL be allowed for the same device-ref.

  - Acceptance Criteria:
    - Given an Approved project (revision=1) exists for device-ref
    - When a revision is created (revision=2)
    - Then the new project is created successfully

### M2: Frontend - Device Ref Creation Modal

#### 3.4 Device-Ref Input Fields

**REQ-PROJ-050** [Event-Driven]
**WHEN** the user opens the ProjectCreateModal **THEN** the system SHALL display searchable dropdown fields for: Line, Product Name, Process, and Part ID, sourced from `device_master` API.

  - Acceptance Criteria:
    - Given the modal is opened
    - When the user types in the Product Name field
    - Then matching options from device_master are displayed as autocomplete suggestions

**REQ-PROJ-051** [Event-Driven]
**WHEN** the user selects a Line **THEN** the Product Name, Process, and Part ID dropdowns SHALL filter their options based on the selected line from device_master.

  - Acceptance Criteria:
    - Given Line 1 has products A, B, C and Line 2 has products D, E
    - When the user selects Line 1
    - Then only products A, B, C appear in the Product Name dropdown

**REQ-PROJ-052** [Event-Driven]
**WHEN** the user completes all four device-ref fields (Line, Product Name, Process, Part ID) **THEN** the system SHALL check for existing active projects and display a duplicate warning if found.

  - Acceptance Criteria:
    - Given an active project exists for the selected device-ref
    - When all 4 fields are filled
    - Then a warning badge/message appears: "Active project already exists"

**REQ-PROJ-053** [Event-Driven]
**WHEN** the device-ref combination matches a `device_master` record **THEN** the system SHALL display auto-populated header metadata (pitch_size, shot_count, etc.) in a read-only preview section.

  - Acceptance Criteria:
    - Given device_master has pitch_size=50 for the matched device
    - When device-ref fields are completed
    - Then a preview section shows "Pitch Size: 50"

**REQ-PROJ-054** [Event-Driven]
**WHEN** the device-ref combination is valid **THEN** the system SHALL display the layer list from `layer_master` as a preview.

  - Acceptance Criteria:
    - Given the matched device has 45 layers in layer_master
    - When device-ref fields are completed
    - Then a layer count badge shows "45 layers" with expandable list

#### 3.5 Full/Short Type Selection

**REQ-PROJ-055** [Event-Driven]
**WHEN** the user selects a device-ref **THEN** the system SHALL display a type selector (Full / Short) defaulting to Full.

  - Acceptance Criteria:
    - Given device-ref fields are completed
    - When the type selector is visible
    - Then "Full" is selected by default

**REQ-PROJ-056** [Event-Driven]
**WHEN** the user selects "Short" type **THEN** the system SHALL display a layer selection UI (checkbox list) allowing the user to choose a subset of layers from layer_master.

  - Acceptance Criteria:
    - Given "Short" is selected and layer_master has 45 layers
    - When the layer selection UI appears
    - Then all 45 layers are shown with checkboxes (none selected by default)
    - And a "Selected: 0/45" counter is displayed

### M3: Short Product Support

#### 3.6 Layer Selection UI

**REQ-PROJ-020** [Event-Driven]
**WHEN** the user selects "Short" project type in the creation modal **THEN** the system SHALL display a layer selection panel with checkboxes grouped by category, showing layer_name, step_seq, and layer_number for each layer.

  - Acceptance Criteria:
    - Given 45 layers exist in layer_master for the device
    - When "Short" is selected
    - Then layers are displayed with checkboxes, grouped by category if available
    - And each row shows layer_name, step_seq, layer_number

**REQ-PROJ-021** [Event-Driven]
**WHEN** the user selects layers for a Short product **THEN** the system SHALL validate that at least 1 layer is selected before allowing project creation.

  - Acceptance Criteria:
    - Given "Short" type is selected with 0 layers checked
    - When the user clicks "Create"
    - Then the button is disabled or validation error is shown

**REQ-PROJ-022** [Ubiquitous]
The system SHALL display a layer count indicator showing "Selected: N / Total" during Short type layer selection.

  - Acceptance Criteria:
    - Given 5 out of 45 layers are checked
    - Then the counter shows "Selected: 5 / 45"

**REQ-PROJ-023** [Optional]
**Where possible**, the system SHALL provide "Select All" and "Deselect All" buttons for the layer selection panel.

### M4: Backbone Matching + Empty Tables

#### 3.7 Empty Condition Table Support

**REQ-PROJ-030** [Event-Driven]
**WHEN** the user selects "No backbone (empty condition table)" during project creation **THEN** the system SHALL create all project_layers with `conditions = {}` and `backbone_conditions = {}`.

  - Acceptance Criteria:
    - Given the user selects "No backbone"
    - When the project is created with 45 layers
    - Then all 45 project_layers have conditions={} and backbone_conditions={}
    - And backbone_product_id is null for all layers

**REQ-PROJ-031** [Ubiquitous]
The system SHALL treat `conditions = {}` (empty JSONB) as a valid state for project_layers. All downstream features (editing, saving, validation, export) SHALL handle empty conditions gracefully.

  - Acceptance Criteria:
    - Given a project_layer has conditions={}
    - When the condition editor loads
    - Then an empty grid row is displayed without errors
    - And the user can start editing cells normally

**REQ-PROJ-032** [Event-Driven]
**WHEN** the backbone selection dropdown is shown during project creation **THEN** the system SHALL include a "No backbone (empty)" option at the top of the list.

  - Acceptance Criteria:
    - Given the backbone dropdown is displayed
    - When the user opens the dropdown
    - Then the first option is "No backbone (empty condition table)"

#### 3.8 Backbone Layer-ID Based Matching

**REQ-PROJ-040** [Event-Driven]
**WHEN** a backbone is selected during project creation **THEN** the system SHALL match backbone layers to project layers by `layer_id` (numeric identifier), NOT by layer_name.

  - Acceptance Criteria:
    - Given backbone has layers with layer_id [1, 2, 3, 5, 7]
    - And the project has layers with layer_id [1, 2, 3, 4, 5, 6, 7]
    - When backbone conditions are copied
    - Then layers 1, 2, 3, 5, 7 get backbone conditions copied
    - And layers 4, 6 get empty conditions {}

**REQ-PROJ-041** [State-Driven]
**IF** the backbone has layers that the project does not have (backbone-only layers) **THEN** those backbone layers SHALL be silently skipped without error.

  - Acceptance Criteria:
    - Given backbone has layer_id=99 which project does not have
    - When backbone matching runs
    - Then layer 99 is skipped and no error is raised

**REQ-PROJ-042** [State-Driven]
**IF** the project has layers that the backbone does not have (project-only layers) **THEN** those project layers SHALL be initialized with empty conditions `{}`.

  - Acceptance Criteria:
    - Given project has layer_id=4 which backbone does not have
    - When backbone matching runs
    - Then project layer 4 gets conditions={} and backbone_conditions={}

**REQ-PROJ-043** [Ubiquitous]
The system SHALL log a summary of backbone matching results: matched layers count, project-only layers count, and backbone-only (skipped) layers count.

  - Acceptance Criteria:
    - Given backbone has 40 layers, project has 45 layers, 38 match
    - When matching completes
    - Then a log entry records: "Matched: 38, Project-only: 7, Backbone-only: 2"

#### 3.9 Backbone Selection Options

**REQ-PROJ-044** [Event-Driven]
**WHEN** backbone selection is displayed during project creation **THEN** the system SHALL show available backbones (Approved projects via Dynamic Backbone from SPEC-BACKBONE-001) filtered by line_id.

  - Acceptance Criteria:
    - Given Line 1 has 3 Approved backbone products
    - When the backbone dropdown loads
    - Then 3 backbone options are shown plus "No backbone" option

**REQ-PROJ-045** [Event-Driven]
**WHEN** a backbone is selected **THEN** the system SHALL continue to use the existing per-layer backbone selection feature (from Phase 2) allowing individual layer backbone replacement after project creation.

---

## 4. Specifications

### 4.1 DB Schema Changes

#### Alembic Migration: `add_device_ref_columns_to_projects`

**projects table modifications:**

| Operation | Column | Type | Constraints | Description |
|-----------|--------|------|-------------|-------------|
| ADD COLUMN | `device_master_id` | INTEGER | FK -> device_master(id), NULLABLE | Reference to device registry |
| ADD COLUMN | `process` | VARCHAR(100) | NULLABLE | Process identifier (part of unique key) |
| ADD COLUMN | `device_type` | VARCHAR(20) | NOT NULL, DEFAULT 'full' | 'full' or 'short' |
| ADD COLUMN | `header_metadata` | JSONB | NULLABLE | Denormalized device header info |
| ADD COLUMN | `line_id` | INTEGER | FK -> lines(id), NULLABLE | Denormalized for unique constraint |
| MODIFY | `product_id` | INTEGER | NULLABLE (was NOT NULL) | Backward compat: old projects keep value |
| MODIFY | `main_backbone_id` | INTEGER | NULLABLE (was NOT NULL) | Support "No backbone" |
| CREATE INDEX | `ix_projects_device_ref_unique` | | UNIQUE partial index | `(line_id, product_name_derived, process, part_id_derived, revision) WHERE is_latest = true` |

Note: The unique constraint implementation requires denormalized `line_id` on `projects` and derives product_name/part_id from `device_master`. The exact index implementation will use functional index or denormalized columns.

**Alternative approach (recommended for simplicity):**
Add denormalized columns `product_name` (VARCHAR(100)) and `part_id` (VARCHAR(100)) directly on `projects` table for the unique constraint:

| Operation | Column | Type | Description |
|-----------|--------|------|-------------|
| ADD COLUMN | `product_name` | VARCHAR(100) | Denormalized from device_master for unique constraint |
| ADD COLUMN | `part_id` | VARCHAR(100) | Denormalized from device_master for unique constraint |

```sql
-- Partial unique index for active project uniqueness
CREATE UNIQUE INDEX ix_projects_device_ref_active
ON projects (line_id, product_name, process, part_id, revision)
WHERE is_latest = true;
```

#### header_metadata JSONB Schema

```json
{
  "pitch_size": 50.0,
  "shot_count": 120,
  "die_size_x": 26.0,
  "die_size_y": 33.0,
  "reticle_size": "6inch",
  "exposure_tool_type": "ArF-i"
}
```

### 4.2 API Changes

#### Modified Endpoints

| Method | Path | Change Description |
|--------|------|-------------------|
| POST | `/api/projects` | Accept new request schema with device-ref fields; support device_type and selected_layer_ids |

#### New Request Schema

```python
class ProjectCreateRequestV2(BaseModel):
    """Device-ref based project creation request."""
    # Device-ref fields (new)
    line_id: int
    product_name: str
    process: str
    part_id: str
    device_type: str = "full"  # "full" | "short"
    selected_layer_ids: list[int] | None = None  # Required when device_type="short"

    # Backbone (optional - None means "no backbone")
    backbone_product_id: int | None = None

    # Legacy support (deprecated, will be removed in future)
    product_id: int | None = None  # For backward compat during transition
```

#### New API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/device-master/search` | Search device_master by line_id, product_name, process, part_id (autocomplete) |
| GET | `/api/device-master/{id}/layers` | Get layers from layer_master for a specific device |
| GET | `/api/projects/check-duplicate` | Check if active project exists for device-ref combination |

#### New Response Schemas

```python
class DeviceSearchResult(BaseModel):
    """Search result from device_master."""
    id: int
    line_id: int
    product_name: str
    process: str
    part_id: str
    pitch_size: float | None
    shot_count: int | None
    die_size_x: float | None
    die_size_y: float | None
    # ... additional header fields

class DeviceLayerItem(BaseModel):
    """Layer from layer_master for a device."""
    layer_id: int
    layer_name: str
    step_seq: str
    layer_number: str
    category: str | None = None
    sort_order: int

class DuplicateCheckResponse(BaseModel):
    """Result of duplicate project check."""
    exists: bool
    existing_project_id: int | None = None
    existing_project_status: str | None = None
    existing_project_revision: int | None = None
```

### 4.3 Service Layer Changes

#### `project_service.py` - New Creation Flow

```python
async def create_project_v2(
    db: AsyncSession,
    line_id: int,
    product_name: str,
    process: str,
    part_id: str,
    device_type: str,  # "full" | "short"
    created_by: int,
    backbone_product_id: int | None = None,
    selected_layer_ids: list[int] | None = None,
) -> Project:
    """Create a project using device-ref based flow.

    Steps:
    1. Validate device-ref against device_master
    2. Check for duplicate active projects
    3. Fetch layers from layer_master (all or subset)
    4. Optionally fetch backbone conditions (if backbone selected)
    5. Create project with header_metadata
    6. Create project_layers with backbone matching or empty conditions
    """
```

#### Key Logic Changes

1. **Device validation**: Query `device_master` with (line_id, product_name, process, part_id) to get device_master_id and header info
2. **Duplicate check**: Query `projects` WHERE same device-ref AND `status IN ('draft', 'review')` AND `is_latest = true`
3. **Layer resolution**: Query `layer_master` for device layers; filter by `selected_layer_ids` if Short type
4. **Backbone matching**: Use `layer_id` to match backbone `project_layers.conditions` to target layers
5. **Empty init**: For unmatched layers or "No backbone", set `conditions = {}`

### 4.4 Frontend Changes

#### ProjectCreateModal V2 - Wireframe (ASCII)

```
+--------------------------------------------------+
|        New Project (Device-Ref)                   |
+--------------------------------------------------+
|                                                    |
| Line *         [Searchable Dropdown        v]     |
|                                                    |
| Product Name * [Searchable Dropdown        v]     |
|                                                    |
| Process *      [Searchable Dropdown        v]     |
|                                                    |
| Part ID *      [Searchable Dropdown        v]     |
|                                                    |
| +----------------------------------------------+ |
| | Header Info (auto-populated)                  | |
| | Pitch: 50.0  Shot: 120  Die: 26x33           | |
| +----------------------------------------------+ |
|                                                    |
| [!] Active project exists (Draft, rev 1)          |
|     <- shown only if duplicate detected           |
|                                                    |
| Type:  (o) Full  ( ) Short                        |
|                                                    |
| +--- Short: Layer Selection ------------------+ | |
| | [ ] Select All  [x] Layer_001 (ac100000)    | | |
| |                 [x] Layer_002 (ac200000)     | | |
| |                 [ ] Layer_003 (ac300000)     | | |
| |                 ...                          | | |
| | Selected: 2 / 45                            | | |
| +---------------------------------------------+ | |
|                                                    |
| Backbone:  [Dropdown: Backbone list / No BB   v]  |
|                                                    |
| Layer Preview: 45 layers (Full) / 2 layers (Short) |
|                                                    |
|                        [Cancel]  [Create]          |
+--------------------------------------------------+
```

#### Component Changes

| Component | Change |
|-----------|--------|
| `ProjectCreateModal.tsx` | Complete rewrite: 4 searchable dropdowns, type selector, layer selection panel, backbone dropdown with "No backbone" option, header preview |
| `useDeviceMaster.ts` (NEW) | Hooks for device_master search, layer list, duplicate check |
| `api/deviceMaster.ts` (NEW) | API client functions for device_master endpoints |
| `types/device.ts` (NEW) | TypeScript types for device_master, layer_master |

#### Data Flow

```
ProjectCreateModal
  -> Step 1: Line select -> filter device_master
  -> Step 2: Product/Process/PartID searchable dropdowns (cascading filter)
  -> Step 3: Auto-fetch header_metadata + layer list from device_master/layer_master
  -> Step 4: Duplicate check (debounced, on all 4 fields filled)
  -> Step 5: Type selection (Full/Short)
  -> Step 6: If Short -> Layer selection checkboxes
  -> Step 7: Backbone selection (optional, "No backbone" default for new devices)
  -> Step 8: Submit -> POST /api/projects (v2 schema)
  -> Step 9: Navigate to /projects/{id}/edit
```

### 4.5 Backbone Matching Algorithm

```
Input:
  - target_layers: list[layer_id] from layer_master (full or subset)
  - backbone_product_id: int | None

Algorithm:
  IF backbone_product_id is None:
    FOR each target_layer:
      create project_layer with conditions={}, backbone_conditions={}
    RETURN

  backbone_map = BackboneRepository.get_backbone_layer_map(db, backbone_product_id)
  # backbone_map: {layer_id: conditions_dict}

  matched = 0, project_only = 0, backbone_only = 0

  FOR each target_layer_id in target_layers:
    IF target_layer_id in backbone_map:
      conditions = deepcopy(backbone_map[target_layer_id])
      backbone_conditions = deepcopy(backbone_map[target_layer_id])
      bb_product_id = backbone_product_id
      matched += 1
    ELSE:
      conditions = {}
      backbone_conditions = {}
      bb_product_id = None
      project_only += 1

    create project_layer(conditions, backbone_conditions, bb_product_id)

  backbone_only = len(backbone_map) - matched
  log(f"Backbone matching: matched={matched}, project_only={project_only}, backbone_only={backbone_only}")
```

### 4.6 Affected Files

#### New Files

**Backend:**
- `backend/app/routers/device_master.py` - Device master search + layer list endpoints
- `backend/app/services/device_master_service.py` - Device master query service
- `backend/app/schemas/device_master.py` - Pydantic schemas for device-ref requests/responses
- `backend/alembic/versions/xxx_add_device_ref_to_projects.py` - Migration

**Frontend:**
- `frontend/src/api/deviceMaster.ts` - API client for device_master endpoints
- `frontend/src/hooks/useDeviceMaster.ts` - React Query hooks (useDeviceSearch, useDeviceLayers, useDuplicateCheck)
- `frontend/src/types/device.ts` - TypeScript types for device_master, layer_master
- `frontend/src/components/projects/LayerSelectionPanel.tsx` - Layer checkbox selection for Short type

#### Modified Files

**Backend:**
- `backend/app/models/project.py` - Add device_master_id, process, device_type, header_metadata, line_id, product_name, part_id columns
- `backend/app/services/project_service.py` - Add `create_project_v2()`, keep `create_project()` for backward compat
- `backend/app/schemas/project.py` - Add `ProjectCreateRequestV2`, update `ProjectResponse` with new fields
- `backend/app/routers/projects.py` - Update POST /api/projects to accept V2 schema

**Frontend:**
- `frontend/src/components/projects/ProjectCreateModal.tsx` - Complete rewrite with device-ref fields
- `frontend/src/types/project.ts` - Update ProjectResponse with new fields
- `frontend/src/api/projects.ts` - Update createProject to send V2 payload

### 4.7 Backward Compatibility

- **Existing Projects**: `product_id` retained, `device_master_id` is null. All existing features (editing, validation, export, revision) work unchanged
- **API Versioning**: `POST /api/projects` accepts both old (product_id-based) and new (device-ref-based) payloads during transition period. Detection via presence of `line_id` field
- **Display Name**: Old projects show `product_name` from products table. New projects show `{product_name} | {process} | {part_id}`
- **Backbone System**: Unaffected. Dynamic Backbone (SPEC-BACKBONE-001) continues to source from Approved project_layers

### 4.8 Security

- No new security concerns beyond existing RBAC
- All new endpoints require `require_active_user` or `require_auth` dependency
- Device master search API is read-only, accessible to all authenticated users
- Project creation requires `editor` role or above (existing behavior)

### 4.9 Traceability Tags

| Tag | Scope |
|-----|-------|
| SPEC-PROJECT-002 | Full SPEC |
| SPEC-PROJECT-002-M1 | Schema Migration + Backend API |
| SPEC-PROJECT-002-M2 | Frontend Device Ref Creation Modal |
| SPEC-PROJECT-002-M3 | Short Product Support |
| SPEC-PROJECT-002-M4 | Backbone Matching + Empty Tables |
