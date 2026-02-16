# SPEC-001: Acceptance Criteria

**SPEC ID**: SPEC-001
**Title**: Admin Settings - XML Mapping CRUD and Validation Rule Management
**Sprint**: 2.3

---

## 1. XML Mapping CRUD (REQ-001 ~ REQ-007)

### AC-1.1: List XML Mappings

```gherkin
Given the admin user is authenticated
  And 17 XML mappings exist in the database
When the admin requests GET /api/admin/recipe-mappings
Then the response status is 200
  And the response contains 17 mapping objects
  And each mapping includes id, xpath, column_id, column_name, display_name, category_code, data_type, value_transform, is_active, created_at
```

### AC-1.2: List XML Mappings with Search Filter

```gherkin
Given the admin user is authenticated
  And mappings exist for xpath containing "CoatModule" and "BakeModule"
When the admin requests GET /api/admin/recipe-mappings?search=CoatModule
Then the response contains only mappings where xpath or column_name contains "CoatModule"
```

### AC-1.3: List XML Mappings with Active Filter

```gherkin
Given the admin user is authenticated
  And 15 active and 2 inactive mappings exist
When the admin requests GET /api/admin/recipe-mappings?is_active=true
Then the response contains exactly 15 mappings
  And all returned mappings have is_active=true
```

### AC-1.4: Create XML Mapping - Valid

```gherkin
Given the admin user is authenticated
  And column "SP_DEV_TIME" exists with id=10 in column_definitions
When the admin sends POST /api/admin/recipe-mappings with body:
  | xpath                              | column_id | value_transform |
  | /Recipe/DevelopModule/Time          | 10        | to_int          |
Then the response status is 201
  And the response includes the created mapping with a generated id
  And the mapping includes column_name="SP_DEV_TIME" from the joined column_definitions
```

### AC-1.5: Create XML Mapping - Invalid Column ID

```gherkin
Given the admin user is authenticated
  And column_id 9999 does not exist in column_definitions
When the admin sends POST /api/admin/recipe-mappings with column_id=9999
Then the response status is 422
  And the error message indicates the column does not exist
```

### AC-1.6: Create XML Mapping - Invalid Value Transform

```gherkin
Given the admin user is authenticated
When the admin sends POST /api/admin/recipe-mappings with value_transform="to_string"
Then the response status is 422
  And the error message indicates invalid value_transform
  And the allowed values are listed: null, to_int, to_float, yn_to_bool
```

### AC-1.7: Update XML Mapping

```gherkin
Given the admin user is authenticated
  And mapping id=1 exists with value_transform="to_int"
When the admin sends PUT /api/admin/recipe-mappings/1 with value_transform="to_float"
Then the response status is 200
  And the returned mapping has value_transform="to_float"
  And the updated mapping is persisted in the database
```

### AC-1.8: Update XML Mapping - Not Found

```gherkin
Given the admin user is authenticated
  And mapping id=9999 does not exist
When the admin sends PUT /api/admin/recipe-mappings/9999
Then the response status is 404
```

### AC-1.9: Delete XML Mapping

```gherkin
Given the admin user is authenticated
  And mapping id=1 exists
When the admin sends DELETE /api/admin/recipe-mappings/1
Then the response status is 204
  And the mapping no longer exists in the database
```

### AC-1.10: Delete XML Mapping - Not Found

```gherkin
Given the admin user is authenticated
  And mapping id=9999 does not exist
When the admin sends DELETE /api/admin/recipe-mappings/9999
Then the response status is 404
```

---

## 2. Validation Rule Management (REQ-008 ~ REQ-014)

### AC-2.1: List Columns with Validation Rules

```gherkin
Given the admin user is authenticated
  And 67 columns exist in category "SP" with varying validation rules
When the admin requests GET /api/admin/columns?category_code=SP
Then the response status is 200
  And the response contains one category object with category_code="SP"
  And the category contains 67 column objects
  And each column includes its validation rules array (may be empty)
  And columns are sorted by sort_order
```

### AC-2.2: List All Columns Without Filter

```gherkin
Given the admin user is authenticated
  And columns exist across all 4 categories (SP, SC, OVL, DEV)
When the admin requests GET /api/admin/columns
Then the response contains all 4 category objects
  And categories are sorted by sort_order
  And each category contains its columns with validation rules
```

### AC-2.3: Replace Validation Rules - Valid

```gherkin
Given the admin user is authenticated
  And column "SP_PREBAKE_TEMP_C" exists with id=5
  And column id=5 has 1 existing validation rule
When the admin sends PUT /api/admin/columns/5/validations with body:
  | rule_type | rule_config            | error_message              | is_active |
  | range     | {"min": 0, "max": 300} | Temp must be 0-300         | true      |
  | required  | {}                     | Prebake temp is required   | true      |
Then the response status is 200
  And the response contains column_id=5
  And the response contains 2 validation rules with new ids
  And the previous validation rule no longer exists
```

### AC-2.4: Replace Validation Rules - Invalid Rule Type

```gherkin
Given the admin user is authenticated
  And column id=5 exists
When the admin sends PUT /api/admin/columns/5/validations with rule_type="invalid_type"
Then the response status is 422
  And the error message indicates invalid rule_type
  And no changes are made to existing rules
```

### AC-2.5: Replace Validation Rules - Range Missing Min/Max

```gherkin
Given the admin user is authenticated
  And column id=5 exists
When the admin sends PUT /api/admin/columns/5/validations with:
  | rule_type | rule_config   |
  | range     | {"min": 0}    |
Then the response status is 422
  And the error message indicates range rule requires both min and max
```

### AC-2.6: Replace Validation Rules - Conditional Required Missing Fields

```gherkin
Given the admin user is authenticated
  And column id=5 exists
When the admin sends PUT /api/admin/columns/5/validations with:
  | rule_type              | rule_config                        |
  | conditional_required   | {"condition_column": "SP_USE"}     |
Then the response status is 422
  And the error message indicates conditional_required rule requires condition_column, condition_value, and operator
```

### AC-2.7: Replace Validation Rules - Column Not Found

```gherkin
Given the admin user is authenticated
  And column id=9999 does not exist
When the admin sends PUT /api/admin/columns/9999/validations
Then the response status is 404
```

### AC-2.8: Bulk Upload - Valid Excel

```gherkin
Given the admin user is authenticated
  And an Excel file contains 25 valid validation rule rows for 15 columns
  And all column_name values exist in column_definitions
When the admin sends POST /api/admin/columns/validations/bulk with the Excel file
Then the response status is 200
  And the response contains total_rows=25, columns_updated=15, rules_created=25
  And all 15 columns have their validation rules replaced
```

### AC-2.9: Bulk Upload - Invalid Rows

```gherkin
Given the admin user is authenticated
  And an Excel file contains:
    | row | column_name      | rule_type | issue              |
    | 3   | INVALID_COLUMN   | range     | Column not found   |
    | 7   | SP_PREBAKE_TEMP  | range     | Missing max value  |
    | 12  | SP_SPIN1_SPEED   | bad_type  | Invalid rule_type  |
When the admin sends POST /api/admin/columns/validations/bulk with the Excel file
Then the response status is 422
  And the response contains 3 error objects with row numbers and error details
  And NO validation rules are imported (transactional rollback)
```

### AC-2.10: Bulk Upload - Empty File

```gherkin
Given the admin user is authenticated
  And an Excel file contains only header row with no data rows
When the admin sends POST /api/admin/columns/validations/bulk with the file
Then the response status is 422
  And the error message indicates the file contains no data rows
```

---

## 3. Admin Access Control (REQ-015 ~ REQ-018)

### AC-3.1: Admin Navigation Visible for Admin User

```gherkin
Given a user with role="admin" is selected in the user dropdown
When the user views the header navigation
Then an "Admin" dropdown is visible
  And the dropdown contains "XML Mappings" and "Validation Rules" links
```

### AC-3.2: Admin Navigation Hidden for Non-Admin

```gherkin
Given a user with role="editor" is selected in the user dropdown
When the user views the header navigation
Then no "Admin" dropdown is visible
```

### AC-3.3: Admin Route Guard - Non-Admin Redirect

```gherkin
Given a user with role="editor" is selected
When the user navigates directly to /admin/xml-mappings
Then the user is redirected to /projects
```

### AC-3.4: Admin API - Non-Admin Forbidden

```gherkin
Given user id=2 has role="editor"
When user id=2 calls GET /api/admin/recipe-mappings with X-User-Id=2
Then the response status is 403
  And the response body contains "Admin access required"
```

### AC-3.5: Admin API - Missing User Header

```gherkin
Given no X-User-Id header is provided
When a request is made to any /api/admin/* endpoint
Then the response status is 422 (missing required header)
```

---

## 4. Immediate Reflection (REQ-019 ~ REQ-020)

### AC-4.1: XML Mapping Change Reflected in Recipe Upload

```gherkin
Given an XML mapping exists for xpath="/Recipe/Coat/Spin1/Speed" mapped to column "SP_SPIN1_SPEED"
  And the admin changes the mapping to column "SP_SPIN2_SPEED"
When a user uploads a Recipe XML file containing /Recipe/Coat/Spin1/Speed
Then the Recipe diff result maps that value to "SP_SPIN2_SPEED" (not "SP_SPIN1_SPEED")
```

### AC-4.2: Deactivated Mapping Skipped in Recipe Upload

```gherkin
Given an XML mapping for xpath="/Recipe/Coat/Spin1/Speed" exists and is_active=true
  And the admin sets is_active=false for this mapping
When a user uploads a Recipe XML file containing /Recipe/Coat/Spin1/Speed
Then the Recipe diff result does not include "SP_SPIN1_SPEED" in its items
  And the xpath appears in the unmapped_xpaths list
```

### AC-4.3: Validation Rule Change Reflected in Editor

```gherkin
Given column "SP_PREBAKE_TEMP_C" has no range validation rule
  And the admin adds a range rule with min=0, max=300
When a user loads the condition editor and enters 500 for SP_PREBAKE_TEMP_C
Then the cell shows a validation error "Prebake temp must be between 0 and 300"
```

---

## 5. UI Behavior

### AC-5.1: XML Mapping Page - Add Flow

```gherkin
Given the admin navigates to /admin/xml-mappings
When the admin clicks the "Add New" button
Then a modal dialog opens with empty form fields
  And the XPath field is focused
  And the Column dropdown shows all columns grouped by category
  And the Value Transform dropdown shows: (none), to_int, to_float, yn_to_bool
When the admin fills in valid data and clicks "Save"
Then the modal closes
  And the new mapping appears in the table
  And a success notification is shown
```

### AC-5.2: XML Mapping Page - Edit Flow

```gherkin
Given the admin navigates to /admin/xml-mappings
  And a mapping row exists for "/Recipe/Coat/Spin1/Speed"
When the admin clicks the Edit button on that row
Then a modal dialog opens pre-populated with the mapping data
When the admin changes the value_transform and clicks "Save"
Then the modal closes
  And the table row reflects the updated value
  And a success notification is shown
```

### AC-5.3: XML Mapping Page - Delete Flow

```gherkin
Given the admin navigates to /admin/xml-mappings
  And a mapping row exists
When the admin clicks the Delete button on that row
Then a confirmation dialog appears with the message "Delete this XML mapping?"
When the admin confirms deletion
Then the row is removed from the table
  And a success notification is shown
```

### AC-5.4: Validation Rules Page - Category Filter

```gherkin
Given the admin navigates to /admin/validations
  And columns exist across all 4 categories
When the admin clicks the "SC" tab
Then the table shows only columns belonging to the SC category
  And the column count in the footer reflects the filtered count
```

### AC-5.5: Validation Rules Page - Edit Rules Flow

```gherkin
Given the admin navigates to /admin/validations
  And column "SP_PREBAKE_TEMP_C" has 1 existing range rule
When the admin clicks the Edit button for that column
Then a modal opens showing:
  - Column metadata (name, type, unit, category)
  - 1 existing range rule with min/max fields populated
  - An "Add Rule" button
When the admin clicks "Add Rule" and selects "required" as rule_type
Then a new rule form section appears with an error_message field
When the admin fills the error message and clicks "Save All Rules"
Then the modal closes
  And the Rules column for that row now shows "2"
  And the Req column shows "Y"
```

### AC-5.6: Validation Rules Page - Bulk Upload Flow

```gherkin
Given the admin navigates to /admin/validations
When the admin clicks "Bulk Excel Upload"
Then a modal opens with:
  - A "Download Template" link
  - A file input accepting .xlsx files
When the admin selects a valid .xlsx file
Then a preview shows: rows parsed, columns affected, new rules count
  And a warning states "This will REPLACE all existing rules for affected columns"
When the admin clicks "Import"
Then the import executes
  And the table refreshes to show updated rule counts
  And a success notification shows "25 rules imported for 15 columns"
```

### AC-5.7: Validation Rules Page - Bulk Upload Error Handling

```gherkin
Given the admin uploads an Excel file with 3 invalid rows
When the import is executed
Then the modal shows error details:
  - "Row 3: Column 'INVALID_COL' not found"
  - "Row 7: Range rule requires min and max values"
  - "Row 12: Invalid rule_type 'bad_type'"
  And no rules are imported
  And the modal remains open for correction
```

---

## 6. Quality Gate Criteria

### 6.1 Definition of Done

- [ ] All 20 EARS requirements (REQ-001 through REQ-020) are implemented
- [ ] Backend tests: All admin CRUD endpoints have comprehensive pytest tests
- [ ] Backend tests: Role-based access (403 for non-admin) tested for all endpoints
- [ ] Backend tests: Validation error cases tested (invalid input, missing fields, not found)
- [ ] Backend tests: Bulk upload tested (valid file, invalid rows, transactional rollback)
- [ ] Frontend: XML Mapping management page functional with CRUD operations
- [ ] Frontend: Validation Rule management page functional with category filter and rule editing
- [ ] Frontend: Bulk Excel upload with preview, import, and error display
- [ ] Frontend: Admin navigation visible only for admin users
- [ ] Frontend: Admin route guard redirects non-admin users
- [ ] All new components are responsive (tablet and desktop)
- [ ] No TypeScript errors or Python type hint violations
- [ ] Code follows existing project conventions (async/await, Pydantic v2, React Query)

### 6.2 Verification Methods

| Method | Scope | Tool |
|---|---|---|
| Unit tests | Backend services and validation logic | pytest + pytest-asyncio |
| API tests | All admin endpoints | pytest + httpx AsyncClient |
| Manual testing | UI flows, navigation, modals | Browser (Chrome/Firefox) |
| Type checking | Frontend type safety | TypeScript strict mode |
| Linting | Code style | ruff (backend), ESLint (frontend) |
