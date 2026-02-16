# SPEC-001: Implementation Plan

**SPEC ID**: SPEC-001
**Title**: Admin Settings - XML Mapping CRUD and Validation Rule Management
**Sprint**: 2.3

---

## 1. Implementation Milestones

### Milestone 1: Backend Admin API (Priority: High)

**Goal**: Implement all admin backend endpoints with validation, error handling, and tests.

**Tasks**:

1. **Admin Pydantic Schemas** (`backend/app/schemas/admin.py`)
   - RecipeMappingCreate, RecipeMappingUpdate, RecipeMappingResponse
   - ValidationRuleCreate, ValidationRulesReplace, ColumnValidationsResponse
   - BulkUploadResponse, BulkUploadError
   - Rule config validators (range min/max, conditional_required fields)

2. **Admin Service Layer** (`backend/app/services/admin_service.py`)
   - `list_mappings(db, is_active, search)` - Query with joins to column_definitions and column_categories
   - `create_mapping(db, data)` - Validate column_id exists, create record
   - `update_mapping(db, mapping_id, data)` - Validate and update
   - `delete_mapping(db, mapping_id)` - Hard delete
   - `list_columns_with_validations(db, category_code)` - Reuse existing column query with admin enhancements
   - `replace_validations(db, column_id, rules)` - Delete all + create new in transaction
   - `bulk_upload_validations(db, file)` - Parse Excel, validate, transactional import

3. **Admin Router** (`backend/app/routers/admin.py`)
   - `require_admin` dependency (check X-User-Id header, verify admin role)
   - XML mapping CRUD endpoints (GET, POST, PUT, DELETE)
   - Column validation endpoints (GET, PUT, POST bulk)
   - Register router in main.py

4. **Backend Tests** (`tests/test_admin_mappings.py`, `tests/test_admin_validations.py`)
   - Test all CRUD operations
   - Test validation rules (invalid data, missing fields, wrong types)
   - Test role-based access (403 for non-admin)
   - Test bulk upload (valid file, invalid rows, transactional rollback)
   - Test search/filter parameters

**Dependencies**: None (uses existing models and database)

### Milestone 2: Frontend Admin Pages (Priority: High)

**Goal**: Implement admin UI pages with table display, modal forms, and API integration.

**Tasks**:

1. **Admin API Client** (`frontend/src/api/admin.ts`)
   - Axios functions: listMappings, createMapping, updateMapping, deleteMapping
   - Axios functions: listAdminColumns, replaceValidations, bulkUploadValidations
   - Type definitions matching backend response schemas

2. **React Query Hooks** (`frontend/src/hooks/useAdminMappings.ts`, `useAdminValidations.ts`)
   - useAdminMappings() - list with search/filter, mutation hooks for CRUD
   - useAdminValidations() - list by category, mutation for replace, bulk upload

3. **Admin Layout** (`frontend/src/pages/admin/AdminLayout.tsx`)
   - Tab navigation: XML Mappings | Validation Rules
   - Breadcrumb: Home > Admin > [Current Page]
   - Admin role guard (redirect non-admin to /projects)

4. **XML Mappings Page** (`frontend/src/pages/admin/XmlMappingsPage.tsx`)
   - Data table with columns: XPath, Column Name, Category, Type, Transform, Active, Actions
   - Search input (client-side filter)
   - Active/inactive toggle filter
   - Add button opens MappingFormModal
   - Edit/Delete buttons per row

5. **Mapping Form Modal** (`frontend/src/components/admin/MappingFormModal.tsx`)
   - XPath text input with validation
   - Column selector dropdown (searchable, grouped by category)
   - Value transform dropdown (none, to_int, to_float, yn_to_bool)
   - Active checkbox
   - Create/Update modes

6. **Validation Rules Page** (`frontend/src/pages/admin/ValidationRulesPage.tsx`)
   - Category tabs (SP, SC, OVL, DEV)
   - Column table with summary columns (Required, Range, Cond.Req, Rule Count)
   - Search filter
   - Edit button per row opens ValidationEditModal
   - Bulk upload button opens BulkUploadModal

7. **Validation Edit Modal** (`frontend/src/components/admin/ValidationEditModal.tsx`)
   - Display column metadata (name, type, unit, category)
   - List of existing rules with edit/delete per rule
   - Add rule button with rule_type selector
   - Dynamic form fields per rule_type (RuleFormFields component)
   - Save replaces all rules via PUT

8. **Bulk Upload Modal** (`frontend/src/components/admin/BulkUploadModal.tsx`)
   - Template download link
   - File input (.xlsx)
   - Preview/summary after file selection
   - Warning about replacement behavior
   - Import button triggers API call
   - Error display for row-level validation errors

**Dependencies**: Milestone 1 (backend API must be available)

### Milestone 3: Route Integration and Navigation (Priority: High)

**Goal**: Integrate admin pages into the application routing and navigation.

**Tasks**:

1. **Route Registration** (App.tsx)
   - Add /admin/xml-mappings and /admin/validations routes
   - Wrap with AdminLayout

2. **Header Navigation Update** (components/layout/Header.tsx)
   - Add admin dropdown menu (visible only for admin users)
   - Links to /admin/xml-mappings and /admin/validations

3. **Admin Route Guard**
   - Check user role on admin route access
   - Redirect non-admin users to /projects

**Dependencies**: Milestone 2

### Milestone 4: Integration Verification (Priority: Medium)

**Goal**: Verify that admin changes are reflected in existing features.

**Tasks**:

1. **XML Mapping Reflection Test**
   - Modify a mapping via admin UI
   - Upload Recipe XML and verify the changed mapping is used
   - Deactivate a mapping and verify it is skipped

2. **Validation Rule Reflection Test**
   - Add a range validation rule via admin UI
   - Open condition editor and verify the rule is enforced
   - Modify the rule and verify the change takes effect

3. **End-to-end Admin Flow Test**
   - Login as admin user, navigate to admin pages
   - Perform CRUD operations on mappings
   - Edit validation rules for multiple columns
   - Bulk upload validation rules from Excel template

**Dependencies**: Milestones 1-3

---

## 2. Technical Approach

### 2.1 Backend Architecture

**Service Pattern**: Follow existing PCM backend pattern:
- Router receives request, validates via Pydantic schema
- Router calls service function with database session
- Service executes business logic and returns result
- Router serializes response via Pydantic response model

**Admin Dependency**:
```python
# Reusable admin role check
async def require_admin(
    x_user_id: int = Header(..., alias="X-User-Id"),
    db: AsyncSession = Depends(get_db)
) -> User:
    user = await db.get(User, x_user_id)
    if not user or user.role != "admin":
        raise HTTPException(403, "Admin access required")
    return user
```

**Bulk Upload Strategy**:
1. Read Excel with openpyxl (already used by recipe features)
2. Parse each row into validation rule candidate
3. Group by column_name
4. Validate all rows first (collect errors)
5. If any errors, return 422 with all error details
6. If valid, execute replacement per column in single transaction

### 2.2 Frontend Architecture

**State Management**: React Query for server state (consistent with existing PCM pattern):
- `useQuery` for listing mappings and columns
- `useMutation` with `invalidateQueries` for CRUD operations
- Optimistic updates not needed (admin operations are infrequent)

**Component Pattern**: Modal-based editing (consistent with existing PCM pattern):
- Table page displays data
- Add/Edit actions open modal dialogs
- Delete actions show confirmation dialog
- Save triggers API call and refreshes table

**Role Check**: Use existing user context (Zustand store or header dropdown state) to check admin role for navigation visibility and route guarding.

---

## 3. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| openpyxl not installed in backend | Bulk upload fails | Low | Already in requirements.txt or add as dependency |
| Excel file parsing edge cases (merged cells, extra sheets) | Bulk upload errors | Medium | Strict format validation, read only first sheet, skip empty rows |
| Large number of mappings (100+) impacting UI performance | Slow table rendering | Low | Client-side pagination if needed (unlikely with ~50-100 mappings) |
| Concurrent admin edits to same mapping | Data inconsistency | Low | Optimistic locking or last-write-wins (acceptable for admin settings) |
| Frontend column dropdown with 300+ columns | Poor UX | Medium | Searchable dropdown with category grouping |

---

## 4. Architecture Decisions

### 4.1 Single Admin Router vs. Separate Routers

**Decision**: Single admin router (`routers/admin.py`) with clear path prefixes.

**Rationale**: Admin features are cohesive (both manage column metadata). A single router reduces file proliferation and keeps the `require_admin` dependency shared naturally.

### 4.2 Hard Delete vs. Soft Delete for XML Mappings

**Decision**: Hard delete.

**Rationale**: XML mappings are configuration data without historical significance. The `is_active` flag provides a soft-disable mechanism. Hard delete keeps the table clean and avoids confusion between "deleted" and "inactive" states.

### 4.3 Replace-All vs. Patch for Validation Rules

**Decision**: Replace-all (PUT semantics) for validation rules per column.

**Rationale**: The validation rules modal displays all rules for a column and allows adding/removing/editing. Sending the complete list as a replacement is simpler and avoids complex diff logic. The number of rules per column is small (typically 1-3).

### 4.4 Admin Column Endpoint vs. Reusing Existing

**Decision**: Create new `GET /api/admin/columns` endpoint under admin prefix.

**Rationale**: While functionally similar to `GET /api/columns`, the admin endpoint ensures the `require_admin` dependency is applied and allows future admin-specific enhancements (e.g., showing inactive columns, editing column metadata).
