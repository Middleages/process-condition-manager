# SPEC-001: Admin Settings - XML Mapping CRUD and Validation Rule Management

**SPEC ID**: SPEC-001
**Title**: Admin Settings - XML Mapping CRUD and Validation Rule Management
**Sprint**: 2.3 (Phase 2 - Data Input Automation)
**Status**: Planned
**Priority**: High
**Created**: 2026-02-16

---

## 1. Overview

### 1.1 Purpose

This SPEC defines the admin settings module for PCM (Process Condition Manager), enabling administrators to manage Recipe XML mappings and column validation rules through dedicated API endpoints and UI pages. These settings directly control how Recipe XML data is parsed/mapped to condition columns (Sprint 2.2 dependency) and how cell-level validation rules are applied in the condition editor (Phase 1 dependency).

### 1.2 Background

- PCM manages semiconductor photo process condition tables with ~300 columns x 30-60 layers per product
- Sprint 2.1-2.2 completed: backbone replacement, layer management, Recipe XML upload/diff/apply
- All database tables already exist: `recipe_xml_mappings`, `column_validations`, `column_definitions`, `column_categories`
- 17 XML mappings are seeded; 0 validation rules are seeded
- No admin router or admin pages exist yet
- The existing `/api/columns` endpoint provides read-only column listing with validations

### 1.3 Scope

**In Scope**:
- XML mapping CRUD API and management UI
- Validation rule management API and UI (per-column editing + bulk Excel upload)
- Admin navigation routes and layout
- Admin role-based access control (using existing user role system)

**Out of Scope**:
- Category grouping management (task 2-8, optional)
- Cross-layer validation logic implementation (Phase 4, schema only)
- JWT authentication (Phase 4)
- Conditional required validation logic in the editor (task 2-9, separate implementation)

### 1.4 Dependencies

| Dependency | Status | Impact |
|---|---|---|
| Database tables (recipe_xml_mappings, column_validations, column_definitions, column_categories) | Complete | Tables exist, no migration needed |
| SQLAlchemy models (RecipeXmlMapping, ColumnValidation, ColumnDefinition, ColumnCategory) | Complete | Models defined in `backend/app/models/column.py` and `backend/app/models/export.py` |
| Existing column schemas (`backend/app/schemas/column.py`) | Complete | Read-only response schemas exist; admin write schemas needed |
| Recipe XML upload/diff service (Sprint 2.2) | Complete | XML mappings are consumed by recipe parsing service |
| Phase 1 condition editor validation | Complete | Validation rules are consumed by frontend validation engine |

---

## 2. EARS Requirements

### Feature 1: XML Mapping CRUD

**REQ-001** (Ubiquitous): The admin XML mapping API **shall** return all XML mappings with their associated column metadata (column_name, display_name, category_code, data_type) when listing mappings.

**REQ-002** (Event-Driven): **When** an admin submits a new XML mapping with xpath, column_id, and value_transform, **then** the system **shall** create the mapping record and return the created mapping with its associated column metadata.

**REQ-003** (Event-Driven): **When** an admin submits an update to an existing XML mapping, **then** the system **shall** update the xpath, column_id, value_transform, and/or is_active fields and return the updated mapping.

**REQ-004** (Event-Driven): **When** an admin deletes an XML mapping, **then** the system **shall** remove the mapping record (hard delete) and return a 204 No Content response.

**REQ-005** (Unwanted): The system **shall not** allow creation of an XML mapping with a column_id that does not exist in column_definitions.

**REQ-006** (Unwanted): The system **shall not** allow creation of an XML mapping with a value_transform that is not one of: null, "to_int", "to_float", "yn_to_bool".

**REQ-007** (State-Driven): **While** a mapping has is_active set to false, the Recipe XML upload/diff service **shall** skip that mapping during parsing.

### Feature 2: Validation Rule Management

**REQ-008** (Ubiquitous): The admin columns API **shall** return all columns grouped by category with their validation rules, supporting optional category_code filter.

**REQ-009** (Event-Driven): **When** an admin submits replacement validation rules for a column, **then** the system **shall** delete all existing rules for that column and create the new rules in a single transaction.

**REQ-010** (Event-Driven): **When** an admin uploads a bulk Excel file with validation rules, **then** the system **shall** parse the file, validate all rows, and import all rules transactionally (all-or-nothing).

**REQ-011** (Unwanted): The system **shall not** accept a validation rule with a rule_type that is not one of: "range", "required", "conditional_required", "cross_layer".

**REQ-012** (Unwanted): The system **shall not** accept a range rule where rule_config is missing "min" or "max" keys.

**REQ-013** (Unwanted): The system **shall not** accept a conditional_required rule where rule_config is missing "condition_column", "condition_value", or "operator" keys.

**REQ-014** (Event-Driven): **When** an admin uploads an Excel file with invalid format or invalid data rows, **then** the system **shall** return a 422 error with detailed row-level error messages without importing any rules.

### Feature 3: Admin Navigation and Access Control

**REQ-015** (State-Driven): **While** the current user has admin role, the header navigation **shall** display admin links (XML Mappings, Validation Rules).

**REQ-016** (Unwanted): The system **shall not** display admin navigation links to users with editor or reviewer roles.

**REQ-017** (Event-Driven): **When** a non-admin user attempts to access /admin/* routes directly, **then** the frontend **shall** redirect to /projects.

**REQ-018** (Event-Driven): **When** a non-admin user calls admin API endpoints, **then** the backend **shall** return 403 Forbidden.

### Feature 4: Immediate Reflection

**REQ-019** (Event-Driven): **When** an admin modifies XML mappings, **then** the next Recipe XML upload/diff operation **shall** use the updated mapping configuration immediately (no cache).

**REQ-020** (Event-Driven): **When** an admin modifies validation rules, **then** the next condition editor load **shall** use the updated validation rules immediately (no cache).

---

## 3. API Specifications

### 3.1 Admin XML Mapping Endpoints

All endpoints require admin role. Router prefix: `/api/admin/recipe-mappings`

#### GET /api/admin/recipe-mappings

List all XML mappings with column metadata.

**Query Parameters**:
| Parameter | Type | Required | Description |
|---|---|---|---|
| is_active | boolean | No | Filter by active status |
| search | string | No | Search by xpath or column_name (case-insensitive contains) |

**Response 200** (RecipeMappingListResponse):
```json
[
  {
    "id": 1,
    "xpath": "/Recipe/CoatModule/Spin1/Speed",
    "column_id": 5,
    "column_name": "SP_SPIN1_SPEED",
    "display_name": "Spin1 Speed",
    "category_code": "SP",
    "data_type": "integer",
    "value_transform": "to_int",
    "is_active": true,
    "created_at": "2026-02-10T09:00:00Z"
  }
]
```

#### POST /api/admin/recipe-mappings

Create a new XML mapping.

**Request Body** (RecipeMappingCreate):
```json
{
  "xpath": "/Recipe/CoatModule/Spin1/Speed",
  "column_id": 5,
  "value_transform": "to_int"
}
```

**Validation**:
- xpath: required, max 300 chars, non-empty
- column_id: required, must exist in column_definitions
- value_transform: optional, must be one of null | "to_int" | "to_float" | "yn_to_bool"

**Response 201** (RecipeMappingResponse): Same shape as list item.

**Error 422**: Invalid input data.

#### PUT /api/admin/recipe-mappings/{id}

Update an existing XML mapping.

**Request Body** (RecipeMappingUpdate):
```json
{
  "xpath": "/Recipe/CoatModule/Spin1/Speed",
  "column_id": 5,
  "value_transform": "to_float",
  "is_active": true
}
```

**Response 200** (RecipeMappingResponse): Updated mapping.

**Error 404**: Mapping not found.

#### DELETE /api/admin/recipe-mappings/{id}

Delete an XML mapping (hard delete).

**Response 204**: No content.

**Error 404**: Mapping not found.

---

### 3.2 Admin Validation Rule Endpoints

Router prefix: `/api/admin/columns`

#### GET /api/admin/columns

List all columns with validation rules, grouped by category.

**Query Parameters**:
| Parameter | Type | Required | Description |
|---|---|---|---|
| category_code | string | No | Filter by category (SP, SC, OVL, DEV) |

**Response 200** (AdminColumnListResponse):
```json
[
  {
    "id": 1,
    "category_code": "SP",
    "category_name": "Spin/PR",
    "sort_order": 1,
    "columns": [
      {
        "id": 5,
        "column_name": "SP_PREBAKE_TEMP_C",
        "display_name": "Prebake Temp (C)",
        "data_type": "integer",
        "unit": "C",
        "is_required": true,
        "sort_order": 10,
        "validations": [
          {
            "id": 1,
            "rule_type": "range",
            "rule_config": {"min": 0, "max": 300},
            "error_message": "Prebake temperature must be between 0 and 300",
            "is_active": true
          }
        ]
      }
    ]
  }
]
```

**Note**: This endpoint is functionally similar to the existing `GET /api/columns` but placed under the admin prefix for consistency and future admin-specific enhancements (e.g., include inactive columns).

#### PUT /api/admin/columns/{column_id}/validations

Replace all validation rules for a specific column.

**Request Body** (ValidationRulesReplace):
```json
{
  "validations": [
    {
      "rule_type": "range",
      "rule_config": {"min": 0, "max": 300},
      "error_message": "Value must be between 0 and 300",
      "is_active": true
    },
    {
      "rule_type": "required",
      "rule_config": {},
      "error_message": "This field is required",
      "is_active": true
    }
  ]
}
```

**Validation per rule**:
- rule_type: required, must be one of "range", "required", "conditional_required", "cross_layer"
- rule_config: required, must be valid JSON object
  - range: must contain "min" (number) and "max" (number), min < max
  - required: empty object or omitted
  - conditional_required: must contain "condition_column" (string), "condition_value" (string), "operator" (string, one of "equals", "not_equals", "contains")
  - cross_layer: schema accepted but logic not implemented (Phase 4)
- error_message: required, max 500 chars
- is_active: optional, defaults to true

**Response 200** (ColumnValidationsResponse):
```json
{
  "column_id": 5,
  "column_name": "SP_PREBAKE_TEMP_C",
  "validations": [
    {
      "id": 101,
      "rule_type": "range",
      "rule_config": {"min": 0, "max": 300},
      "error_message": "Value must be between 0 and 300",
      "is_active": true
    }
  ]
}
```

**Error 404**: Column not found.
**Error 422**: Invalid validation rules.

#### POST /api/admin/columns/validations/bulk

Bulk upload validation rules from Excel file.

**Request**: multipart/form-data with file field.

**Excel Format**:
| column_name | rule_type | min | max | condition_column | condition_value | operator | error_message | is_active |
|---|---|---|---|---|---|---|---|---|
| SP_PREBAKE_TEMP_C | range | 0 | 300 | | | | Prebake temp 0-300 | TRUE |
| SP_ADHESION_TYPE | conditional_required | | | SP_ADHESION_USE | Y | equals | Required when Adhesion Use=Y | TRUE |

**Processing Logic**:
1. Parse Excel file (support .xlsx format via openpyxl)
2. Validate all rows: check column_name exists, rule_type valid, rule_config fields present
3. If any row fails validation, return 422 with all row-level errors
4. If all valid, replace validation rules per column (grouped by column_name) in a single transaction
5. Return summary of imported rules

**Response 200** (BulkUploadResponse):
```json
{
  "total_rows": 25,
  "columns_updated": 15,
  "rules_created": 25,
  "warnings": []
}
```

**Error 422** (BulkUploadError):
```json
{
  "detail": "Validation failed",
  "errors": [
    {"row": 3, "column_name": "INVALID_COL", "error": "Column not found in column_definitions"},
    {"row": 7, "column_name": "SP_PREBAKE_TEMP_C", "error": "Range rule requires min and max values"}
  ]
}
```

---

### 3.3 Admin Role Check Dependency

All admin API endpoints use a shared dependency:

```python
async def require_admin(user_id: int = Header(..., alias="X-User-Id"), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user or user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
```

**Note**: Phase 1 uses dropdown user selection (no JWT). The `X-User-Id` header is used for user identification. Full JWT auth is Phase 4.

---

## 4. UI Specifications

### 4.1 Admin Navigation

**Header Integration**:
- Add "Admin" dropdown to the header navigation (visible only for admin users)
- Dropdown items: "XML Mappings", "Validation Rules"
- Routes: `/admin/xml-mappings`, `/admin/validations`

**Admin Layout**:
- Shared layout with sidebar or tabs for admin pages
- Breadcrumb: Home > Admin > [Page Name]

### 4.2 XML Mapping Management Page (/admin/xml-mappings)

```
+--------------------------------------------------------------+
|  Admin > XML Mapping Management                  [+ Add New] |
+--------------------------------------------------------------+
|  Search: [___________________________] [Active Only: toggle]  |
+--------+-----------------+---------+------+----------+-------+
| XPath  | Column Name     | Category| Type | Transform| Action|
+--------+-----------------+---------+------+----------+-------+
| /Recip | SP_PR_TYPE      | SP      | STR  | (none)   |[E][D] |
| /Recip | SP_SPIN1_SPEED  | SP      | INT  | to_int   |[E][D] |
| /Recip | SP_PREBAKE_TEMP | SP      | INT  | to_int   |[E][D] |
| /Recip | SC_ENERGY       | SC      | FLT  | to_float |[E][D] |
| ...    |                 |         |      |          |       |
+--------+-----------------+---------+------+----------+-------+
|  Total: 17 mappings | Active: 17 | Inactive: 0              |
+--------------------------------------------------------------+
```

**Add/Edit Modal**:
```
+----------------------------------------------+
|  Add XML Mapping          (or Edit Mapping)   |
+----------------------------------------------+
|                                               |
|  XPath *:                                     |
|  [/Recipe/CoatModule/Spin1/Speed_________]    |
|                                               |
|  Target Column *:                             |
|  [SP_SPIN1_SPEED - Spin1 Speed (SP)    v]    |
|  (searchable dropdown with category labels)   |
|                                               |
|  Value Transform:                             |
|  [to_int                               v]    |
|  Options: (none), to_int, to_float,           |
|           yn_to_bool                          |
|                                               |
|  Active: [x]                                  |
|                                               |
|              [Cancel]  [Save]                 |
+----------------------------------------------+
```

**Interactions**:
- Table supports client-side search/filter by xpath and column_name
- Active/inactive toggle filter
- [E] button opens edit modal pre-populated with current values
- [D] button shows confirmation dialog before deletion
- Column dropdown shows: "column_name - display_name (category_code)"
- Sort by XPath or Column Name (clickable headers)

### 4.3 Validation Rule Management Page (/admin/validations)

```
+--------------------------------------------------------------+
|  Admin > Validation Rules              [Bulk Excel Upload]   |
+--------------------------------------------------------------+
|  Category: [SP] [SC] [OVL] [DEV]   (tab-style filter)       |
+--------------------------------------------------------------+
|  Search: [___________________________]                        |
+----------------+------+------+-------+----------+------+-----+
| Column Name    | Type | Req  | Range | Cond.Req | Rules| Act |
+----------------+------+------+-------+----------+------+-----+
| SP_PR_TYPE     | sel  |  Y   |  --   |   --     |  1   |[Ed] |
| SP_PREBAKE_T.. | int  |  Y   | 0-300 |   --     |  2   |[Ed] |
| SP_ADHESION_T..| sel  |  --  |  --   | USE=Y    |  1   |[Ed] |
| SP_SPIN1_SPEED | int  |  --  |  --   |   --     |  0   |[Ed] |
| ...            |      |      |       |          |      |     |
+----------------+------+------+-------+----------+------+-----+
|  SP: 67 columns | With rules: 12 | Without rules: 55        |
+--------------------------------------------------------------+
```

**Summary Columns**:
- Req: Shows "Y" if any active "required" rule exists
- Range: Shows "min-max" if any active "range" rule exists
- Cond.Req: Shows summary like "USE=Y" if any active "conditional_required" rule exists
- Rules: Total count of all validation rules for this column

**Edit Validation Rules Modal**:
```
+--------------------------------------------------------------+
|  Validation Rules: SP_PREBAKE_TEMP_C (Prebake Temp)          |
|  Data Type: integer | Unit: C | Category: SP                |
+--------------------------------------------------------------+
|                                                               |
|  Rule 1: range                                   [Delete]    |
|  +----------------------------------------------------------+|
|  | Min: [0______]  Max: [300____]                            ||
|  | Error Message: [Prebake temp must be 0-300___________]    ||
|  | Active: [x]                                               ||
|  +----------------------------------------------------------+|
|                                                               |
|  Rule 2: required                                [Delete]    |
|  +----------------------------------------------------------+|
|  | Error Message: [Prebake temperature is required______]    ||
|  | Active: [x]                                               ||
|  +----------------------------------------------------------+|
|                                                               |
|  [+ Add Rule]                                                |
|                                                               |
|  When "Add Rule" clicked:                                    |
|  +----------------------------------------------------------+|
|  | Rule Type: [conditional_required            v]            ||
|  | Condition Column: [SP_ADHESION_USE          v]            ||
|  | Condition Value: [Y_________________________]             ||
|  | Operator: [equals                           v]            ||
|  | Error Message: [Required when Adhesion Use=Y_____]        ||
|  | Active: [x]                                               ||
|  +----------------------------------------------------------+|
|                                                               |
|              [Cancel]  [Save All Rules]                      |
+--------------------------------------------------------------+
```

**Rule Type Form Fields** (dynamically rendered):
- **range**: Min (number input), Max (number input)
- **required**: No additional fields
- **conditional_required**: Condition Column (dropdown), Condition Value (text), Operator (dropdown: equals, not_equals, contains)
- **cross_layer**: Schema fields displayed but marked as "Phase 4 - Logic not yet implemented"

**Bulk Excel Upload Modal**:
```
+--------------------------------------------------------------+
|  Bulk Upload Validation Rules                                |
+--------------------------------------------------------------+
|                                                               |
|  [Download Template (.xlsx)]                                 |
|                                                               |
|  Upload File:                                                |
|  [Choose File...] validation_rules.xlsx                      |
|                                                               |
|  Preview (after file selection):                             |
|  +----------------------------------------------------------+|
|  | Rows parsed: 25                                           ||
|  | Columns affected: 15                                      ||
|  | New rules: 25                                             ||
|  +----------------------------------------------------------+|
|                                                               |
|  Warning: This will REPLACE all existing rules               |
|  for the affected columns.                                   |
|                                                               |
|              [Cancel]  [Import]                               |
+--------------------------------------------------------------+
```

---

## 5. Data Models

### 5.1 Existing Database Tables (No Migration Required)

**recipe_xml_mappings**:
| Column | Type | Description |
|---|---|---|
| id | SERIAL PK | |
| xpath | VARCHAR(300) | XML XPath expression |
| column_id | FK -> column_definitions | Target condition column |
| value_transform | VARCHAR(50) NULL | Transformation: to_int, to_float, yn_to_bool |
| is_active | BOOLEAN DEFAULT TRUE | Active status |
| created_at | TIMESTAMPTZ | Creation timestamp |

**column_validations**:
| Column | Type | Description |
|---|---|---|
| id | SERIAL PK | |
| column_id | FK -> column_definitions (CASCADE) | Target column |
| rule_type | VARCHAR(30) | range, required, conditional_required, cross_layer |
| rule_config | JSONB | Rule-specific configuration |
| error_message | VARCHAR(500) | User-facing error message |
| is_active | BOOLEAN DEFAULT TRUE | Active status |

### 5.2 Validation Rule Config Schemas

**range**:
```json
{"min": 0, "max": 300}
```

**required**:
```json
{}
```

**conditional_required**:
```json
{
  "condition_column": "SP_ADHESION_USE",
  "condition_value": "Y",
  "operator": "equals"
}
```

**cross_layer** (Phase 4, schema only):
```json
{
  "check_type": "reference_exists",
  "source_column": "OVL_REF_LAYER",
  "target": "layer_names"
}
```

### 5.3 Value Transform Options

| Transform | Input | Output | Description |
|---|---|---|---|
| null | any | same | No transformation (pass-through) |
| "to_int" | "1500" | 1500 | String to integer |
| "to_float" | "35.5" | 35.5 | String to float |
| "yn_to_bool" | "Y" / "N" | true / false | Y/N to boolean |

---

## 6. Technical Architecture

### 6.1 Backend Structure

**New Files**:

```
backend/app/
  routers/
    admin.py              # Admin router with recipe-mapping and column endpoints
  schemas/
    admin.py              # Admin-specific Pydantic schemas
  services/
    admin_service.py      # Admin business logic (mapping CRUD, validation CRUD, bulk upload)
```

**Router Registration** (main.py):
```python
from app.routers import admin
app.include_router(admin.router)
```

### 6.2 Frontend Structure

**New Files**:

```
frontend/src/
  pages/admin/
    XmlMappingsPage.tsx       # XML mapping management page
    ValidationRulesPage.tsx   # Validation rule management page
    AdminLayout.tsx           # Shared admin layout with tabs
  components/admin/
    MappingFormModal.tsx       # Add/Edit XML mapping modal
    ValidationEditModal.tsx    # Edit validation rules per column modal
    BulkUploadModal.tsx        # Bulk Excel upload modal
    RuleFormFields.tsx         # Dynamic form fields per rule_type
  api/
    admin.ts                  # Admin API client functions
  hooks/
    useAdminMappings.ts       # React Query hooks for XML mappings
    useAdminValidations.ts    # React Query hooks for validations
```

**Route Registration** (App.tsx):
```tsx
<Route path="/admin/xml-mappings" element={<AdminLayout><XmlMappingsPage /></AdminLayout>} />
<Route path="/admin/validations" element={<AdminLayout><ValidationRulesPage /></AdminLayout>} />
```

### 6.3 Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Excel parsing (backend) | openpyxl | Already standard for PCM export features (Phase 3), lightweight |
| Admin state management | React Query | Consistent with existing PCM pattern for server state |
| Table component | AG Grid Community or HTML table | XML mappings and validation tables are simpler than condition editor; HTML table with sort/filter is sufficient |
| Form validation | Zod + React Hook Form or inline | Keep consistent with existing frontend patterns |
| Delete strategy | Hard delete for mappings | XML mappings have no historical significance; soft delete adds unnecessary complexity |

---

## 7. Constraints

### 7.1 Technical Constraints

- **No database migration required**: All tables exist with correct schema
- **Phase 1 auth model**: User identification via `X-User-Id` header (dropdown selection), not JWT
- **cross_layer validation**: Accept the schema in rule_config but do not implement the validation logic (Phase 4)
- **Excel format**: Support .xlsx only (openpyxl dependency)
- **Bulk upload transactionality**: All-or-nothing import within a single database transaction

### 7.2 Business Constraints

- Admin pages accessible only to users with `role = 'admin'`
- Changes to XML mappings must be immediately effective for Recipe XML operations
- Changes to validation rules must be immediately effective for condition editor validation
- Bulk Excel upload replaces rules per column, not appends

---

## 8. Test Strategy

### 8.1 Backend Tests (pytest)

**Admin XML Mapping Tests** (`tests/test_admin_mappings.py`):
- List mappings (empty, with data, with search filter, with is_active filter)
- Create mapping (valid, invalid column_id, invalid value_transform, missing xpath)
- Update mapping (valid, not found, partial update)
- Delete mapping (valid, not found)
- Role check (non-admin gets 403)

**Admin Validation Rule Tests** (`tests/test_admin_validations.py`):
- List columns with validations (all, filtered by category_code)
- Replace validations (valid rules, invalid rule_type, invalid rule_config for range, conditional_required)
- Replace validations (column not found)
- Bulk upload (valid Excel, invalid rows, non-existent column, mixed errors)
- Transactional rollback on bulk upload failure
- Role check (non-admin gets 403)

### 8.2 Frontend Tests (Vitest)

**Utility Tests**:
- Validation rule config form serialization/deserialization
- Excel template generation
- Search/filter logic for mapping table

**Component Tests** (optional, if patterns exist):
- MappingFormModal renders correct fields
- ValidationEditModal shows dynamic fields per rule_type
- BulkUploadModal handles file selection and preview

---

## 9. Traceability

| Requirement | API | UI Component | Test |
|---|---|---|---|
| REQ-001 | GET /api/admin/recipe-mappings | XmlMappingsPage | test_list_mappings |
| REQ-002 | POST /api/admin/recipe-mappings | MappingFormModal | test_create_mapping |
| REQ-003 | PUT /api/admin/recipe-mappings/{id} | MappingFormModal | test_update_mapping |
| REQ-004 | DELETE /api/admin/recipe-mappings/{id} | XmlMappingsPage | test_delete_mapping |
| REQ-005 | POST validation | MappingFormModal | test_create_invalid_column |
| REQ-006 | POST validation | MappingFormModal | test_create_invalid_transform |
| REQ-007 | Recipe service (existing) | N/A | test_inactive_mapping_skipped |
| REQ-008 | GET /api/admin/columns | ValidationRulesPage | test_list_columns_with_validations |
| REQ-009 | PUT /api/admin/columns/{id}/validations | ValidationEditModal | test_replace_validations |
| REQ-010 | POST /api/admin/columns/validations/bulk | BulkUploadModal | test_bulk_upload_valid |
| REQ-011 | PUT validation | ValidationEditModal | test_invalid_rule_type |
| REQ-012 | PUT validation | ValidationEditModal | test_range_missing_minmax |
| REQ-013 | PUT validation | ValidationEditModal | test_conditional_missing_fields |
| REQ-014 | POST bulk validation | BulkUploadModal | test_bulk_upload_errors |
| REQ-015 | N/A | Header (admin dropdown) | Manual/E2E |
| REQ-016 | N/A | Header (role check) | Manual/E2E |
| REQ-017 | N/A | Route guard | Manual/E2E |
| REQ-018 | Dependency (require_admin) | N/A | test_non_admin_403 |
| REQ-019 | No cache | N/A | test_mapping_change_reflects |
| REQ-020 | No cache | N/A | test_validation_change_reflects |

---

## 10. Implementation Notes

**Status**: Completed
**Implementation Date**: 2026-02-16

### Summary

Admin settings fully implemented including XML Mapping CRUD operations, Validation Rules management with per-column editing and bulk Excel upload capability, complete admin navigation routing with role-based access control.

### Key Implementation Files

**Backend**:
- `backend/app/routers/admin.py` - Admin API router with 7 endpoints
- `backend/app/services/admin_service.py` - Admin business logic layer
- `backend/app/schemas/admin.py` - Pydantic request/response schemas

**Frontend**:
- `frontend/src/pages/admin/XmlMappingsPage.tsx` - XML mapping management UI
- `frontend/src/pages/admin/ValidationRulesPage.tsx` - Validation rules management UI
- `frontend/src/pages/admin/AdminLayout.tsx` - Shared admin layout with navigation
- `frontend/src/components/admin/MappingFormModal.tsx` - Add/Edit XML mapping modal
- `frontend/src/components/admin/ValidationEditModal.tsx` - Validation rules editor modal
- `frontend/src/components/admin/BulkUploadModal.tsx` - Excel bulk upload modal
- `frontend/src/api/admin.ts` - Admin API client functions
- `frontend/src/hooks/useAdminMappings.ts` - React Query hooks for mappings
- `frontend/src/hooks/useAdminValidations.ts` - React Query hooks for validations

### Test Coverage

**Backend**: 605+ test cases in `backend/tests/test_admin_service.py`
- XML mapping CRUD operations (create, read, update, delete)
- Validation rule management with transactional bulk operations
- Role-based access control enforcement (403 for non-admin)
- Excel file parsing and import with comprehensive error handling

**Frontend**: Component tests for modals and admin pages

### API Endpoints Implemented

1. `GET /api/admin/recipe-mappings` - List all XML mappings with column metadata
2. `POST /api/admin/recipe-mappings` - Create new XML mapping
3. `PUT /api/admin/recipe-mappings/{id}` - Update XML mapping
4. `DELETE /api/admin/recipe-mappings/{id}` - Delete XML mapping
5. `GET /api/admin/columns` - List columns with validation rules (grouped by category)
6. `PUT /api/admin/columns/{column_id}/validations` - Replace all validation rules for column
7. `POST /api/admin/columns/validations/bulk` - Bulk upload validation rules from Excel

### UI Features

- **XML Mappings Page**: Searchable table with sort, add/edit/delete operations, Active status toggle
- **Validation Rules Page**: Category tabs, per-column rule editor supporting 4 rule types (range, required, conditional_required, cross_layer)
- **Bulk Upload**: Excel template download, file preview, transaction-safe import with row-level error reporting
- **Admin Navigation**: Header dropdown visible only to admin users, breadcrumb navigation
- **Access Control**: Frontend route guards and backend 403 enforcement for non-admin users

### Requirements Completion

All 20 EARS requirements (REQ-001 to REQ-020) fully implemented and validated.
