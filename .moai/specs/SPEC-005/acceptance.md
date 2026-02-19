# SPEC-005: Acceptance Criteria

## Metadata

| Field       | Value                                              |
|-------------|----------------------------------------------------|
| SPEC ID     | SPEC-005                                           |
| Title       | Export System - Computational Output Tables (Type A/B/C) |
| Created     | 2026-02-16                                         |
| Status      | Planned                                            |

---

## 1. Test Scenarios

### 1.1 Type A Export (Horizontal - 1 Row per Layer)

#### TC-010: Basic Type A Export

```gherkin
Given an approved project "PROD-2025A" with 15 layers and conditions data
  And the MES-TRACK export system (TYPE_A) is configured with column mappings
When the user requests a Type A export for MES-TRACK
Then the system generates an Excel file
  And the Excel contains 15 data rows (one per layer)
  And each row has LAYER_ID and PRODUCT_ID as the first two columns
  And subsequent columns use target_column_name from export_column_mappings
  And column values are extracted from project_layers.conditions using the mapped column_key
```

#### TC-011: Type A Column Name Conversion

```gherkin
Given column_definitions has column_key "SP_PR_TYPE"
  And export_column_mappings maps it to target_column_name "RESIST_CODE" for MES-TRACK
When a Type A export is generated
Then the Excel header shows "RESIST_CODE" (not "SP_PR_TYPE")
  And the cell value matches conditions["SP_PR_TYPE"] for each layer
```

#### TC-012: Type A Column Ordering

```gherkin
Given MES-TRACK has 10 column mappings with sort_order values 1 through 10
When a Type A export is generated
Then columns appear in sort_order sequence after the fixed columns (LAYER_ID, PRODUCT_ID)
```

#### TC-013: Type A Missing Value Handling

```gherkin
Given a mapped column "SP_SPIN1_SPEED_rpm" has is_required=true
  And layer "AA_PHOTO" has null value for this column in conditions
When a Type A export is generated
Then the corresponding cell in the Excel is empty
  And the export completes successfully (no error thrown)
```

---

### 1.2 Type B Export (Equipment-Split Multi-Row)

#### TC-020: Basic Type B Export with Equipment Split

```gherkin
Given an approved project with layer "AA_PHOTO"
  And "AA_PHOTO" has 3 equipment assignments:
    | equipment_id   | sort_order |
    | NSR-S322F-01   | 1          |
    | NSR-S322F-02   | 2          |
    | NSR-S631E-01   | 3          |
When a Type B export for EQP-SCANNER is generated
Then "AA_PHOTO" appears in 3 rows in the Excel
  And each row has a different EQUIP_ID
  And rows are ordered by sort_order (NSR-S322F-01 first, NSR-S631E-01 last)
```

#### TC-021: Type B Equipment Parameter Override

```gherkin
Given layer "AA_PHOTO" has base condition SC_EXPOSE_ENERGY_mJ = 35.0
  And equipment "NSR-S322F-01" has equipment_params {"SC_EXPOSE_ENERGY_mJ": "35.5"}
  And equipment "NSR-S322F-02" has equipment_params {"SC_EXPOSE_ENERGY_mJ": "33.8"}
When a Type B export is generated
Then the row for NSR-S322F-01 shows ENERGY = 35.5 (overridden)
  And the row for NSR-S322F-02 shows ENERGY = 33.8 (overridden)
  And non-overridden columns use the base condition values
```

#### TC-022: Type B Layer Without Equipment Assignments

```gherkin
Given layer "GATE_PHOTO" has no equipment assignments in the equipment_assignments table
When a Type B export is generated
Then "GATE_PHOTO" appears as a single row with empty EQUIP_ID
  And all condition columns use base values from project_layers.conditions
```

#### TC-023: Type B Fixed Column Structure

```gherkin
Given the EQP-SCANNER system is configured for Type B
When a Type B export is generated
Then the first three columns are LAYER_ID, PRODUCT_ID, EQUIP_ID (in this order)
  And subsequent columns follow the mapped column sort_order
```

#### TC-024: Type B Multiple Layers with Equipment

```gherkin
Given the project has 5 layers
  And 3 layers have 3 equipment assignments each
  And 2 layers have no equipment assignments
When a Type B export is generated
Then the total row count is (3 * 3) + (2 * 1) = 11 data rows
  And rows within the same layer are grouped together
```

---

### 1.3 Type C Export (Key-Value Vertical Transpose)

#### TC-030: Basic Type C Export

```gherkin
Given an approved project with layer "AA_PHOTO"
  And SPC-OVL system has 6 column mappings for OVL category
When a Type C export is generated
Then "AA_PHOTO" produces 6 rows (one per mapped parameter)
  And each row has columns: LAYER_ID, PRODUCT_ID, PARAM_KEY, PARAM_VALUE, UNIT
```

#### TC-031: Type C PARAM_KEY Uses Target Column Name

```gherkin
Given export_column_mappings for SPC-OVL maps:
  | column_key     | target_column_name |
  | OVL_SPEC_X_nm  | SPEC_X             |
  | OVL_SPEC_Y_nm  | SPEC_Y             |
When a Type C export is generated
Then PARAM_KEY values are "SPEC_X" and "SPEC_Y" (target names, not source keys)
```

#### TC-032: Type C Unit Mapping

```gherkin
Given SPC-OVL additional_config contains unit_mappings:
  | column_key     | unit |
  | OVL_SPEC_X_nm  | nm   |
  | OVL_SPEC_Y_nm  | nm   |
  | OVL_REF_LAYER  |      |
When a Type C export is generated
Then rows for SPEC_X and SPEC_Y have UNIT = "nm"
  And the row for REF_LAYER has UNIT = "" (empty)
```

#### TC-033: Type C No Unit Mapping

```gherkin
Given a column "OVL_TOOL" is mapped for SPC-OVL
  And unit_mappings does not contain an entry for "OVL_TOOL"
When a Type C export is generated
Then the UNIT cell for OVL_TOOL is empty
```

---

### 1.4 Equipment Assignments Table

#### TC-040: Equipment Assignment Schema

```gherkin
Given the Alembic migration 005 has been applied
When querying the equipment_assignments table schema
Then the table has columns: id (PK), project_layer_id (FK), equipment_id (VARCHAR), equipment_params (JSONB), sort_order (INTEGER), created_at (TIMESTAMPTZ), updated_at (TIMESTAMPTZ)
  And project_layer_id has an index
  And project_layer_id references project_layers.id with ON DELETE CASCADE
```

#### TC-041: Equipment Assignment Cascade Delete

```gherkin
Given a project_layer with id=10 has 3 equipment assignments
When the project_layer with id=10 is deleted
Then all 3 equipment assignments are also deleted (CASCADE)
```

#### TC-042: Equipment Assignment Seed Data

```gherkin
Given the seed script has been executed
When querying equipment_assignments
Then at least 3 scanner-category layers have equipment assignments
  And each assigned layer has 3-5 equipment entries
  And at least some entries have non-empty equipment_params with override values
```

---

### 1.5 Export API

#### TC-050: List Export Systems

```gherkin
Given 3 active export systems exist in the database
When GET /api/export/systems is called
Then the response status is 200
  And the response contains 3 systems
  And each system includes: id, system_name, format_type, description, column_count, is_active
  And column_count matches the actual number of column mappings for each system
```

#### TC-051: Export Approved Project

```gherkin
Given project id=1 has status "approved"
  And MES-TRACK system has id=1
When POST /api/projects/1/export is called with body {"system_ids": [1]}
Then the response status is 200
  And the response content-type is "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  And the Content-Disposition header contains the filename
  And the response body is a valid xlsx file
```

#### TC-052: Export Non-Approved Project Rejected

```gherkin
Given project id=2 has status "draft"
When POST /api/projects/2/export is called with body {"system_ids": [1]}
Then the response status is 400
  And the response body contains "Export is only available for approved projects"
```

#### TC-053: Export Preview

```gherkin
Given project id=1 has status "approved" with 15 layers
When GET /api/projects/1/export/preview/1 is called (system_id=1, TYPE_A MES-TRACK)
Then the response status is 200
  And the response contains: system_name, format_type, headers (list), rows (list), total_rows
  And rows contains at most 5 entries
  And total_rows equals 15 (actual total)
  And headers include LAYER_ID, PRODUCT_ID, and mapped column names
```

#### TC-054: Multi-System Export Returns ZIP

```gherkin
Given project id=1 has status "approved"
When POST /api/projects/1/export is called with body {"system_ids": [1, 2, 3]}
Then the response status is 200
  And the response content-type is "application/zip"
  And the ZIP file contains 3 Excel files: MES-TRACK.xlsx, EQP-SCANNER.xlsx, SPC-OVL.xlsx
  And each Excel file is valid and contains correct data
```

#### TC-056: Export with Non-Existent System ID

```gherkin
Given project id=1 has status "approved"
When POST /api/projects/1/export is called with body {"system_ids": [999]}
Then the response status is 404
  And the response body contains the invalid system ID
```

#### TC-057: Export with Inactive System ID

```gherkin
Given project id=1 has status "approved"
  And export system id=4 exists but has is_active=false
When POST /api/projects/1/export is called with body {"system_ids": [4]}
Then the response status is 400
  And the response body contains "Inactive export system cannot be used for export"
```

#### TC-055: Single System Export Returns Excel (Not ZIP)

```gherkin
Given project id=1 has status "approved"
When POST /api/projects/1/export is called with body {"system_ids": [1]}
Then the response content-type is "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  And the response is a single Excel file (not a ZIP)
```

---

### 1.6 Export UI

#### TC-060: Export Button Visibility - Approved Project

```gherkin
Given the user navigates to a project detail page
  And the project status is "approved"
When the page renders
Then an "Export" button or section is visible
```

#### TC-061: Export Button Hidden - Non-Approved Project

```gherkin
Given the user navigates to a project detail page
  And the project status is "draft"
When the page renders
Then no "Export" button or section is visible
```

#### TC-062: Export System Checkbox List

```gherkin
Given the user opens the export panel on an approved project
When the export systems are loaded
Then a checkbox list displays all active export systems
  And each item shows: system name, format type badge (e.g., "Type A"), and column count
```

#### TC-063: Disabled System for Incomplete Config

```gherkin
Given an export system "EMPTY-SYSTEM" exists with is_active=true but 0 column mappings
When the export panel displays the system list
Then "EMPTY-SYSTEM" appears as disabled (grayed out, checkbox not clickable)
  And a tooltip or label indicates "No column mappings configured"
```

#### TC-064: Preview on System Click

```gherkin
Given the export panel is open with systems listed
When the user clicks on "MES-TRACK" in the list
Then the system fetches preview data from GET /api/projects/{id}/export/preview/1
  And a preview table renders showing up to 5 rows with correct headers
```

#### TC-065: Bulk Download

```gherkin
Given the user has selected MES-TRACK and SPC-OVL checkboxes
When the user clicks the bulk download button
Then the browser initiates a download of a ZIP file
  And a loading indicator is shown during the download request
```

#### TC-066: Loading State During Download

```gherkin
Given the user clicks the download button
When the export API request is in progress
Then the download button shows a loading spinner
  And the button is disabled to prevent duplicate requests
When the download completes
Then the loading spinner disappears
  And the button is re-enabled
```

#### TC-067: Individual System Download

```gherkin
Given the export panel shows the system list
When the user clicks a download icon next to "MES-TRACK"
Then a single Excel file for MES-TRACK is downloaded
  And no ZIP file is generated
```

---

### 1.7 Seed Data

#### TC-070: Export Seed Data Completeness

```gherkin
Given the seed script has been executed
When querying the database
Then export_systems contains at least 3 entries:
  | system_name  | format_type |
  | MES-TRACK    | TYPE_A      |
  | EQP-SCANNER  | TYPE_B      |
  | SPC-OVL      | TYPE_C      |
And export_column_mappings contains mappings for all 3 systems
And SPC-OVL has additional_config with unit_mappings
And EQP-SCANNER has additional_config with equip_vary_columns
```

---

### 1.8 Model Enhancement

#### TC-075: ExportColumnMapping Has Column Definition Relationship

```gherkin
Given the ExportColumnMapping model is loaded
When querying column mappings with eager loading
Then each mapping includes the related column_definition
  And column_definition.column_key is accessible without additional queries
```

### 1.9 Unwanted Behavior

#### TC-080: Reject Export for Non-Approved Project

```gherkin
Given project statuses: draft, review, rejected, archived
When export is attempted for any of these statuses
Then the API returns 400 for each
  And no Excel file is generated
```

#### TC-081: No Unmapped Columns in Output

```gherkin
Given a project has 300 condition columns
  And MES-TRACK maps only 15 of them
When a Type A export is generated for MES-TRACK
Then the Excel has exactly 17 columns (2 fixed + 15 mapped)
  And no other condition columns appear
```

#### TC-082: No Raw JSONB Keys in Headers

```gherkin
Given conditions JSONB has key "SP_PR_TYPE"
  And export_column_mappings maps it to "RESIST_CODE"
When a Type A export is generated
Then the Excel header shows "RESIST_CODE"
  And "SP_PR_TYPE" does not appear anywhere in the headers
```

#### TC-083: Filename Sanitization

```gherkin
Given a product name is "PROD 2025/A (test)"
When a single system export is generated for MES-TRACK
Then the filename is "PROD_2025_A__test__MES-TRACK.xlsx" (special characters replaced with underscores)
```

---

## 2. Quality Gate Criteria

### 2.1 Test Coverage

| Area                    | Minimum Coverage | Target Coverage |
|-------------------------|------------------|-----------------|
| ExportService (all types) | 85%            | 90%+            |
| Export API endpoints     | 85%             | 90%+            |
| Frontend export utilities | 80%            | 85%+            |

### 2.2 Performance Criteria

| Metric                              | Threshold           |
|--------------------------------------|---------------------|
| Type A export (60 layers, 15 cols)   | < 3 seconds         |
| Type B export (60 layers, 5 equip each) | < 5 seconds     |
| Type C export (60 layers, 10 params) | < 3 seconds         |
| Preview data generation              | < 1 second          |
| Multi-system ZIP generation (3)      | < 10 seconds        |

### 2.3 Security Criteria

- Export API validates project ownership/access (Phase 4 auth; Phase 3 allows any user)
- No SQL injection via system_ids parameter (Pydantic validation)
- File responses use proper content-type headers to prevent XSS
- No sensitive data leakage in error responses

---

## 3. Verification Methods

### 3.1 Backend Testing

- **Unit Tests** (pytest): Test each export type independently with fixture data
- **Integration Tests** (pytest): Test API endpoints with database transactions
- **Excel Validation**: Open generated Excel with openpyxl in tests, verify headers, row counts, and cell values
- **Seed Data Tests**: Verify seed data insertion and querying

### 3.2 Frontend Testing

- **Component Tests** (Vitest): Test ExportPanel rendering based on project status
- **Hook Tests** (Vitest): Test useExportSystems and useExportPreview hooks
- **API Client Tests** (Vitest): Test export API functions with mocked responses

### 3.3 Manual Verification

- Open generated Excel files in Microsoft Excel or LibreOffice Calc
- Verify visual format matches PRD examples (Section 7.2)
- Test download flow in Chrome and Firefox browsers
- Verify ZIP extraction produces valid individual Excel files

---

## 4. Definition of Done

- [ ] Alembic migration for `equipment_assignments` runs successfully
- [ ] All 3 export types (A/B/C) generate valid Excel files
- [ ] Export output format matches PRD Section 7.2 specifications
- [ ] GET `/api/export/systems` returns correct system list with column counts
- [ ] POST `/api/projects/{id}/export` generates single Excel or ZIP correctly
- [ ] GET `/api/projects/{id}/export/preview/{system_id}` returns JSON preview data
- [ ] Non-approved project export returns HTTP 400
- [ ] Seed data for 3 systems, column mappings, and equipment assignments is included
- [ ] Frontend export panel renders conditionally for approved projects only
- [ ] Preview table displays first 5 rows with correct headers
- [ ] File download works in Chrome and Firefox
- [ ] Backend test coverage >= 85% for export service and API
- [ ] All Gherkin acceptance criteria (TC-010 through TC-082) pass
- [ ] No ruff linting errors in new Python files
- [ ] No ESLint errors in new TypeScript files
- [ ] Code follows project conventions (async/await, Pydantic schemas, TypeScript strict mode)

---

## 5. Traceability

| Test Case   | Requirement   | Milestone |
|-------------|---------------|-----------|
| TC-010~013  | REQ-010~013   | M2        |
| TC-020~024  | REQ-020~024   | M3        |
| TC-030~033  | REQ-030~033   | M4        |
| TC-040~042  | REQ-040~042   | M1        |
| TC-050~057  | REQ-050~057   | M5        |
| TC-060~067  | REQ-060~067   | M6        |
| TC-070      | REQ-070~073   | M1        |
| TC-075      | REQ-075       | M1        |
| TC-080~083  | REQ-080~083   | M5        |
