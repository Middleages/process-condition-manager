# SPEC-PROJECT-002: Acceptance Criteria

## Traceability Tag: SPEC-PROJECT-002

---

## M1: Schema Migration + Backend API

### AC-1.1: Migration - New Columns Added

**Given** the Alembic migration `add_device_ref_to_projects` is applied
**When** the `projects` table schema is inspected
**Then** the following columns exist: `device_master_id` (INTEGER, NULLABLE), `process` (VARCHAR(100), NULLABLE), `device_type` (VARCHAR(20), NOT NULL, DEFAULT 'full'), `header_metadata` (JSONB, NULLABLE), `line_id` (INTEGER, NULLABLE), `product_name` (VARCHAR(100), NULLABLE), `part_id` (VARCHAR(100), NULLABLE)
**And** the `product_id` column is NULLABLE
**And** the `main_backbone_id` column is NULLABLE

### AC-1.2: Migration - Partial Unique Index Created

**Given** the migration is applied
**When** the index `ix_projects_device_ref_active` is inspected
**Then** it is a UNIQUE index on `(line_id, product_name, process, part_id, revision)` WHERE `is_latest = true`

### AC-1.3: Migration - Existing Data Backfilled

**Given** existing projects have `product_id` referencing products with `line_id`, `product_name`, `part_id`
**When** the migration is applied
**Then** `projects.line_id` is populated from `products.line_id` via the FK relationship
**And** `projects.product_name` is populated from `products.product_name`
**And** `projects.part_id` is populated from `products.part_id`
**And** `projects.device_type` defaults to 'full' for all existing projects

### AC-1.4: Migration - Backward Compatibility

**Given** existing projects have non-null `product_id` and `main_backbone_id` values
**When** the migration is applied
**Then** all existing `product_id` values remain unchanged
**And** all existing `main_backbone_id` values remain unchanged
**And** existing features (editing, validation, export, revision) continue to work

### AC-1.5: Device-Ref Project Creation - Full Type

**Given** a valid device_master record exists with line_id=1, product_name='PRODUCT_A', process='PHOTO_01', part_id='PA-001'
**And** layer_master has 45 layers for this device
**And** no active project exists for this device-ref
**When** `POST /api/projects` is called with `{line_id: 1, product_name: 'PRODUCT_A', process: 'PHOTO_01', part_id: 'PA-001', device_type: 'full', backbone_product_id: null}`
**Then** HTTP 201 is returned
**And** the project has `device_master_id` populated
**And** the project has `device_type = 'full'`
**And** the project has `header_metadata` populated from device_master
**And** 45 project_layers are created with `conditions = {}`
**And** all project_layers have `backbone_product_id = null`

### AC-1.6: Device-Ref Project Creation - With Backbone

**Given** a valid device-ref and a backbone product with Approved project having 40 layers
**And** 38 layers match between device and backbone (by layer_id)
**When** a Full type project is created with the backbone selected
**Then** 38 matched layers have conditions copied from backbone
**And** 7 project-only layers have `conditions = {}`
**And** 2 backbone-only layers are silently skipped

### AC-1.7: Duplicate Detection - Active Project Exists

**Given** an active Draft project exists for device-ref (line=1, product='X', process='P1', part='A')
**When** `POST /api/projects` is called with the same device-ref
**Then** HTTP 409 is returned
**And** the error message includes information about the existing project

### AC-1.8: Duplicate Detection - Approved Project Allows New Revision

**Given** an Approved project (revision=1) exists for a device-ref
**When** a revision is created for the same device-ref (revision=2)
**Then** the new project is created successfully with `revision = 2`

### AC-1.9: Unique Constraint - DB Level Enforcement

**Given** an active project exists for device-ref (line=1, product='X', process='P1', part='A', revision=1, is_latest=true)
**When** a direct SQL INSERT attempts the same combination with is_latest=true
**Then** a unique constraint violation is raised by PostgreSQL

### AC-1.10: Device Search API

**Given** device_master contains records for Line 1 with product_names ['PRODUCT_A', 'PRODUCT_B', 'PRODUCT_AB']
**When** `GET /api/device-master/search?line_id=1&product_name=PRODUCT_A` is called
**Then** results include 'PRODUCT_A' and 'PRODUCT_AB' (partial match)
**And** 'PRODUCT_B' is excluded

### AC-1.11: Device Layers API

**Given** device_master record ID=5 has 45 layers in layer_master
**When** `GET /api/device-master/5/layers` is called
**Then** 45 layer items are returned with layer_id, layer_name, step_seq, layer_number
**And** layers are sorted by sort_order

### AC-1.12: Duplicate Check API

**Given** an active Draft project exists for device-ref (line=1, product='X', process='P1', part='A')
**When** `GET /api/projects/check-duplicate?line_id=1&product_name=X&process=P1&part_id=A` is called
**Then** response is `{exists: true, existing_project_id: N, existing_project_status: 'draft', existing_project_revision: 1}`

### AC-1.13: Header Metadata Auto-Population

**Given** device_master has pitch_size=50.0, shot_count=120, die_size_x=26.0, die_size_y=33.0 for the matched device
**When** a project is created for this device
**Then** `project.header_metadata = {"pitch_size": 50.0, "shot_count": 120, "die_size_x": 26.0, "die_size_y": 33.0}`

### AC-1.14: Legacy V1 Creation Still Works

**Given** a client sends the old V1 format `{product_id: 1, backbone_product_id: 2, created_by: 1}`
**When** `POST /api/projects` is called
**Then** the project is created using the legacy flow
**And** `device_master_id` is null for this project

---

## M2: Frontend - Device Ref Creation Modal

### AC-2.1: Line Selection Filters Device Master

**Given** Line 1 has 50 devices and Line 2 has 30 devices in device_master
**When** the user selects Line 1 in the modal
**Then** the Product Name dropdown shows only product names from Line 1's devices
**And** Process and Part ID dropdowns are empty (awaiting product selection)

### AC-2.2: Cascading Dropdown Filtering

**Given** Line 1 has products A, B, C. Product A has processes P1, P2. Product A + P1 has part_ids X, Y
**When** the user selects Line 1 -> Product A -> Process P1
**Then** Part ID dropdown shows only X and Y

### AC-2.3: Searchable Dropdowns

**Given** Line 1 has 50 distinct product names in device_master
**When** the user types "PROD" in the Product Name field
**Then** only product names containing "PROD" are shown (case-insensitive partial match)

### AC-2.4: Header Info Auto-Display

**Given** the user completes all 4 device-ref fields matching a device_master record with pitch_size=50, shot_count=120
**When** the header preview section renders
**Then** it shows "Pitch: 50.0 | Shot: 120 | Die: 26 x 33" (or similar formatted display)

### AC-2.5: Duplicate Warning Display

**Given** an active Draft project exists for the selected device-ref
**When** all 4 device-ref fields are completed
**Then** a warning message appears: "Active project exists (Draft, revision 1)"
**And** the Create button is disabled

### AC-2.6: No Duplicate - Create Enabled

**Given** no active project exists for the selected device-ref
**When** all 4 device-ref fields are completed and a type is selected
**Then** the Create button is enabled

### AC-2.7: Layer Count Preview

**Given** the matched device has 45 layers in layer_master and Full type is selected
**When** the layer preview section renders
**Then** it shows "45 layers" with optional expandable layer list

### AC-2.8: Type Selector Default

**Given** the device-ref fields are completed
**When** the type selector appears
**Then** "Full" is selected by default

### AC-2.9: Successful Creation Navigates to Editor

**Given** all fields are valid and no duplicate exists
**When** the user clicks "Create"
**Then** the project is created via API
**And** the modal closes
**And** the user is navigated to `/projects/{newProjectId}/edit`

### AC-2.10: Empty State - No Device Match

**Given** the user enters device-ref fields that do not match any device_master record
**When** the system attempts to resolve
**Then** no header info or layer preview is shown
**And** the Create button is disabled
**And** a message indicates "No matching device found"

---

## M3: Short Product Support

### AC-3.1: Short Type Shows Layer Selection

**Given** "Short" type is selected and the device has 45 layers
**When** the layer selection panel renders
**Then** all 45 layers are displayed with checkboxes
**And** each row shows: checkbox, layer_name, step_seq, layer_number
**And** no layers are selected by default

### AC-3.2: Layer Selection Counter

**Given** the user has checked 5 out of 45 layers
**When** the counter is inspected
**Then** it shows "Selected: 5 / 45"

### AC-3.3: Minimum Layer Validation

**Given** "Short" type is selected with 0 layers checked
**When** the user attempts to click "Create"
**Then** the Create button is disabled
**And** a validation message shows "At least 1 layer must be selected"

### AC-3.4: Select All / Deselect All

**Given** the layer selection panel is shown
**When** the user clicks "Select All"
**Then** all layers are checked
**And** the counter shows "Selected: 45 / 45"
**When** the user clicks "Deselect All"
**Then** all layers are unchecked

### AC-3.5: Short Type Project Creation

**Given** "Short" type is selected with 10 layers checked
**When** the project is created
**Then** only 10 project_layers are created (not 45)
**And** each created project_layer corresponds to one of the 10 selected layer_ids

### AC-3.6: Short Type With Backbone

**Given** "Short" type with 10 selected layers and a backbone product
**And** the backbone has conditions for 8 of the 10 selected layers
**When** the project is created
**Then** 8 layers have backbone conditions copied
**And** 2 layers have empty conditions

### AC-3.7: Backend Validation of Selected Layers

**Given** selected_layer_ids includes layer_id=999 which does not exist in layer_master for this device
**When** the create API is called
**Then** HTTP 400 is returned with "Invalid layer_id: 999 not found in device layers"

---

## M4: Backbone Matching + Empty Tables

### AC-4.1: No Backbone - Empty Conditions

**Given** the user selects "No backbone (empty condition table)"
**When** a Full type project with 45 layers is created
**Then** all 45 project_layers have `conditions = {}`
**And** all project_layers have `backbone_conditions = {}`
**And** all project_layers have `backbone_product_id = null`
**And** `project.main_backbone_id = null`

### AC-4.2: Empty Conditions - Editor Loads

**Given** a project with all empty conditions
**When** the user opens the condition editor
**Then** the AG Grid displays empty rows without errors
**And** all cells are editable
**And** the user can type values into any cell

### AC-4.3: Empty Conditions - Validation Works

**Given** a project with empty conditions
**When** validation is triggered
**Then** required field violations are reported (expected behavior)
**And** no system errors occur

### AC-4.4: Empty Conditions - Save Works

**Given** a project started with empty conditions
**And** the user has edited some cells
**When** the user clicks "Save"
**Then** the changed cells are saved successfully
**And** change_log entries are recorded with `old_value = null`

### AC-4.5: Empty Conditions - Export Handles Gracefully

**Given** an Approved project with some layers having empty conditions
**When** an export is triggered
**Then** the export completes without errors
**And** empty condition layers produce empty cells in the output

### AC-4.6: Backbone Layer-ID Matching - Full Match

**Given** backbone has layers with layer_id [1, 2, 3, 4, 5]
**And** project has layers with layer_id [1, 2, 3, 4, 5]
**When** backbone conditions are copied
**Then** all 5 layers have conditions copied from backbone
**And** matched count = 5, project_only = 0, backbone_only = 0

### AC-4.7: Backbone Layer-ID Matching - Partial Match

**Given** backbone has layers with layer_id [1, 2, 3, 5, 7, 99]
**And** project has layers with layer_id [1, 2, 3, 4, 5, 6, 7]
**When** backbone conditions are copied
**Then** layers 1, 2, 3, 5, 7 have conditions copied (matched = 5)
**And** layers 4, 6 have empty conditions (project_only = 2)
**And** layer 99 from backbone is skipped (backbone_only = 1)

### AC-4.8: Backbone Layer-ID Matching - No Match

**Given** backbone has layers with layer_id [100, 200, 300]
**And** project has layers with layer_id [1, 2, 3]
**When** backbone conditions are copied
**Then** all 3 project layers have empty conditions
**And** matched = 0, project_only = 3, backbone_only = 3

### AC-4.9: "No Backbone" Option in Dropdown

**Given** the backbone selection dropdown is displayed
**When** the user opens the dropdown
**Then** the first option is "No backbone (empty condition table)"
**And** below it are the available backbone products (from Dynamic Backbone)

### AC-4.10: Backbone Matching Log

**Given** a project is created with backbone matching
**When** creation completes
**Then** a log entry records the matching summary: "Backbone matching: matched=N, project_only=M, backbone_only=K"

---

## Quality Gate Criteria

### Test Coverage

- M1 new files: 85% minimum coverage
  - `device_master_service.py` (NEW): 90%+
  - `project_service.py` (`create_project_v2`): 90%+
  - `device_master.py` router (NEW): 85%+
  - Alembic migration: up/down verified
- M2 frontend: TypeScript strict mode pass, no build errors
- M3: Layer selection validation tests
- M4: Backbone matching edge cases (full match, partial, no match, no backbone)

### Performance Criteria

- Device search API: P95 < 200ms (1000 device_master records)
- Duplicate check API: P95 < 50ms (with partial index)
- Project creation (V2): P95 < 500ms including backbone matching
- Layer list API: P95 < 100ms (60 layers per device)

### Backward Compatibility

- All existing projects continue to function after migration
- V1 project creation API still works for existing clients
- Existing condition editor, validation, export, revision features unaffected
- ProjectListPage displays both old and new projects correctly

### Definition of Done

- [ ] M1: Alembic migration applied with backfill (up and down tested)
- [ ] M1: Device-ref project creation API functional (Full type)
- [ ] M1: Duplicate detection works (application + DB constraint)
- [ ] M1: Header metadata auto-populated from device_master
- [ ] M1: V1 legacy creation path still works
- [ ] M1: All backend tests pass with 85%+ coverage on new code
- [ ] M2: ProjectCreateModal rewritten with 4 searchable dropdowns
- [ ] M2: Cascading filter works (Line -> Product -> Process -> Part ID)
- [ ] M2: Duplicate warning shown inline
- [ ] M2: Header info and layer count preview displayed
- [ ] M2: TypeScript build passes with no errors
- [ ] M3: Short type layer selection panel functional
- [ ] M3: Selected layers sent to API and only those layers created
- [ ] M3: Minimum 1 layer validation enforced
- [ ] M4: "No backbone" option creates empty conditions
- [ ] M4: Layer-ID based backbone matching works for full, partial, and no-match scenarios
- [ ] M4: Empty conditions handled by editor, validation, save, and export
- [ ] M4: Backbone matching summary logged
