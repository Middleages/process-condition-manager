# SPEC-RBAC-001: Acceptance Criteria

---
id: SPEC-RBAC-001
title: Multi-Role RBAC with Developer Role - Acceptance Criteria
tags: [rbac, auth, admin, security, multi-role]
---

## AC-001: Multi-Role User Creation

**Given** the PCM system is running with the new schema
**When** a user record is created with `roles = ["editor", "reviewer"]`
**Then** the system accepts the roles array without error
**And** the user can log in and receive a valid JWT token containing `"roles": ["editor", "reviewer"]`
**And** `GET /api/auth/me` returns `roles` as an array

---

## AC-002: Developer Sees Admin Menu in Header

**Given** a user with `["developer"]` in their roles is logged in
**When** the Header component renders
**Then** the admin navigation link (Settings icon + "관리자") is visible
**And** clicking it navigates to the admin section

**Given** a user with `["editor"]` in their roles is logged in
**When** the Header component renders
**Then** the admin navigation link is NOT visible

---

## AC-003: Developer Cannot Access User Management

**Given** a user with roles `["developer"]` is logged in
**When** the user navigates to `/admin/users`
**Then** the User Management tab is hidden from the tab bar
**And** calling `GET /api/admin/users` returns HTTP 403
**And** calling `POST /api/admin/users` returns HTTP 403

---

## AC-010: Admin Has Read/Write on Operations Menus

**Given** a user with roles `["admin"]` is logged in
**When** the user navigates to Master Data (Line/Product/Layer) page
**Then** all Add, Edit, Delete buttons are enabled and functional
**And** `POST /api/admin/lines` returns HTTP 201
**And** `PUT /api/admin/lines/{id}` returns HTTP 200
**And** `DELETE /api/admin/lines/{id}` returns HTTP 200

---

## AC-011: Developer Has Read-Only on Operations Menus

**Given** a user with roles `["developer"]` is logged in
**When** the user navigates to Master Data (Line/Product/Layer) page
**Then** the data table is visible with all data loaded
**And** Add, Edit, Delete buttons are disabled or hidden
**And** a "읽기 전용" (Read Only) indicator is displayed
**And** `GET /api/admin/lines` returns HTTP 200 with data
**And** `POST /api/admin/lines` returns HTTP 403
**And** `PUT /api/admin/lines/{id}` returns HTTP 403
**And** `DELETE /api/admin/lines/{id}` returns HTTP 403

---

## AC-020: Developer Has Read/Write on System Config Menus

**Given** a user with roles `["developer"]` is logged in
**When** the user navigates to XML Mapping page
**Then** all Add, Edit, Delete buttons are enabled and functional
**And** `GET /api/admin/recipe-mappings` returns HTTP 200
**And** `POST /api/admin/recipe-mappings` returns HTTP 201

**Given** a user with roles `["developer"]` is logged in
**When** the user navigates to Column/Category management in Master Data
**Then** all Add, Edit, Delete buttons for Column and Category are enabled
**And** `POST /api/admin/columns` returns HTTP 201
**And** `POST /api/admin/categories` returns HTTP 201

---

## AC-021: Admin Has Read-Only on System Config Menus

**Given** a user with roles `["admin"]` (without `developer`) is logged in
**When** the user navigates to XML Mapping page
**Then** the data table is visible with all mappings loaded
**And** Add, Edit, Delete buttons are disabled or hidden
**And** a "읽기 전용" indicator is displayed
**And** `GET /api/admin/recipe-mappings` returns HTTP 200 with data
**And** `POST /api/admin/recipe-mappings` returns HTTP 403
**And** `PUT /api/admin/recipe-mappings/{id}` returns HTTP 403
**And** `DELETE /api/admin/recipe-mappings/{id}` returns HTTP 403

---

## AC-025: Combined Admin+Developer Has Full Access

**Given** a user with roles `["admin", "developer"]` is logged in
**When** the user navigates to User Management page
**Then** all CRUD operations are available (admin role grants this)

**When** the user navigates to XML Mapping page
**Then** all CRUD operations are available (developer role grants this)

**When** the user navigates to Master Data (Line/Product/Layer) page
**Then** all CRUD operations are available (admin role grants operations write)

**When** the user navigates to Column/Category management
**Then** all CRUD operations are available (developer role grants system config write)

---

## AC-030: Audit Log Read-Only for Both Roles

**Given** a user with roles `["admin"]` is logged in
**When** the user navigates to Audit Log page
**Then** the audit log data is displayed (read-only)
**And** `GET /api/admin/audit-logs` returns HTTP 200

**Given** a user with roles `["developer"]` is logged in
**When** the user navigates to Audit Log page
**Then** the audit log data is displayed (read-only)
**And** `GET /api/admin/audit-logs` returns HTTP 200

---

## AC-040: Auth Dependencies Return Correct HTTP Codes

**Given** a user with roles `["editor"]` attempts to call any admin endpoint
**When** the request reaches the server
**Then** HTTP 403 is returned with a detail message

**Given** a user with roles `["developer"]` calls `GET /api/admin/lines`
**When** the `require_admin_or_developer` dependency is evaluated
**Then** the request succeeds with HTTP 200

**Given** a user with roles `["developer"]` calls `POST /api/admin/lines`
**When** the `require_ops_write` dependency is evaluated
**Then** HTTP 403 is returned with detail "Admin access required for operations write"

**Given** a user with roles `["admin"]` calls `POST /api/admin/recipe-mappings`
**When** the `require_system_write` dependency is evaluated
**Then** HTTP 403 is returned with detail "Developer access required for system config write"

**Given** a user with roles `["developer"]` calls `POST /api/admin/recipe-mappings`
**When** the `require_system_write` dependency is evaluated
**Then** the request succeeds with HTTP 201

**Given** a user with roles `["admin", "developer"]` calls `POST /api/admin/recipe-mappings`
**When** the `require_system_write` dependency is evaluated
**Then** the request succeeds (developer role satisfies the check)

**Given** a user with roles `["admin", "developer"]` calls `POST /api/admin/lines`
**When** the `require_ops_write` dependency is evaluated
**Then** the request succeeds (admin role satisfies the check)

---

## AC-045: Database Migration Safety

**Given** the current database has users with single `role` column values
**When** the Alembic migration `upgrade head` is executed
**Then** all existing users have their `role` value wrapped in a single-element array in the new `roles` column
**And** the old `role` column is dropped
**And** no user has an empty `roles` array
**And** the migration is reversible with `downgrade -1`

**Specific data verification:**
- User with `role = "admin"` -> `roles = ["admin"]`
- User with `role = "editor"` -> `roles = ["editor"]`
- User with `role = "reviewer"` -> `roles = ["reviewer"]`

---

## AC-050: Backward Compatibility - Existing Roles Unchanged

**Given** a user with roles `["admin"]` is logged in
**When** the user performs any operation that was previously allowed with `role = "admin"`
**Then** the operation succeeds identically as before SPEC-RBAC-001

**Given** a user with roles `["editor"]` is logged in
**When** the user attempts to access `/admin/*` routes
**Then** the user is redirected to `/projects` (unchanged behavior)

**Given** a user with roles `["reviewer"]` is logged in
**When** the user attempts to approve a project
**Then** the approval workflow works identically as before

**Given** a user with roles `["developer"]` is logged in
**When** the user attempts to approve a project
**Then** the operation is denied (developer does not include reviewer access)

---

## AC-060: Multi-Role User Form (Checkboxes)

**Given** an admin is creating a new user
**When** the UserFormModal opens
**Then** four role checkboxes are displayed: 편집자(editor), 검토자(reviewer), 관리자(admin), 개발자(developer)
**And** "편집자(editor)" is checked by default
**And** submitting with multiple checkboxes checked sends `roles: ["editor", "reviewer"]` to the API

**Given** an admin is editing an existing user with roles `["admin", "developer"]`
**When** the UserFormModal opens
**Then** both "관리자(admin)" and "개발자(developer)" checkboxes are checked
**And** the admin can uncheck "developer" and save to update roles to `["admin"]`

**Given** an admin unchecks all role checkboxes
**When** the admin attempts to save
**Then** a validation error is displayed: "역할을 하나 이상 선택해야 합니다"

---

## AC-065: Role Badge Display (Multi-Role)

**Given** a user with roles `["admin", "developer"]` exists
**When** an admin views the User Management page
**Then** the user row shows two separate role badges: "관리자" and "개발자"

**Given** a user with roles `["developer"]` is logged in
**When** the Header renders
**Then** the role area displays "developer" (or multiple badges if multi-role)

---

## AC-070: Operations-Specific Menu Behavior

**Given** a user with roles `["developer"]` is logged in
**When** the user navigates to Enum/Select Options page
**Then** the data is displayed but edit buttons are disabled
**And** `PUT /api/admin/select-options/{column_id}` returns HTTP 403

**Given** a user with roles `["admin"]` is logged in
**When** the user navigates to Enum/Select Options page
**Then** edit buttons are enabled
**And** `PUT /api/admin/select-options/{column_id}` returns HTTP 200

---

## AC-075: System Config Pages - Full Developer Access

**Given** a user with roles `["developer"]` is logged in
**When** the user navigates to Export Systems page
**Then** CRUD buttons are enabled
**And** `POST /api/admin/export-systems` returns HTTP 201
**And** `PUT /api/admin/export-systems/{id}` returns HTTP 200
**And** `DELETE /api/admin/export-systems/{id}` returns HTTP 200

**Given** a user with roles `["developer"]` is logged in
**When** the user navigates to Export Data Sources page
**Then** CRUD buttons are enabled
**And** `POST /api/admin/data-sources` returns HTTP 201

**Given** a user with roles `["developer"]` is logged in
**When** the user navigates to Validation Rules page
**Then** Edit and Upload buttons are enabled
**And** `PUT /api/admin/validation-rules/{column_id}` returns HTTP 200
**And** `POST /api/admin/validation-rules/upload` returns HTTP 201

---

## AC-080: Equipment Management Access

**Given** a user with roles `["admin"]` is logged in
**When** the user manages Equipment in Master Data
**Then** all CRUD operations are available

**Given** a user with roles `["developer"]` is logged in
**When** the user views Equipment in Master Data
**Then** the equipment data is displayed read-only
**And** `GET /api/admin/equipments` returns HTTP 200
**And** `POST /api/admin/equipments` returns HTTP 403

---

## AC-085: Project Owner Check with Multi-Role

**Given** a user with roles `["admin", "editor"]` is logged in
**When** the user accesses a project they do not own
**Then** access is granted (admin role bypasses ownership check)

**Given** a user with roles `["developer", "editor"]` is logged in
**When** the user accesses a project they do not own
**Then** access is denied (developer role does not bypass ownership check)

---

## AC-090: Admin Default Tab Routing

**Given** a user with roles `["admin"]` navigates to `/admin`
**When** the AdminLayout renders
**Then** the user is redirected to `/admin/users` (default for admin)

**Given** a user with roles `["developer"]` navigates to `/admin`
**When** the AdminLayout renders
**Then** the user is redirected to `/admin/master-data` (default for developer, since users tab is hidden)

**Given** a user with roles `["admin", "developer"]` navigates to `/admin`
**When** the AdminLayout renders
**Then** the user is redirected to `/admin/users` (admin role takes priority for default)

---

## AC-095: JWT Token Contains Roles Array

**Given** a user with roles `["editor", "reviewer"]` logs in
**When** the JWT access token is decoded
**Then** the payload contains `"roles": ["editor", "reviewer"]` (array, not string)
**And** the frontend auth store sets `user.roles` as an array

---

## AC-100: Seed Data Includes Multi-Role Users

**Given** the seed data is loaded
**When** querying the users table
**Then** a user with `roles = ["developer"]` exists (developer1)
**And** a user with `roles = ["admin", "developer"]` exists (superuser1)
**And** all existing seed users have single-element role arrays (backward compatible)

---

## Quality Gate Criteria

### Definition of Done

- [ ] Alembic migration tested (upgrade + downgrade) with representative data
- [ ] All auth dependencies updated and unit tested
- [ ] All endpoint migrations verified with correct dependency
- [ ] JWT payload returns `roles` array (not `role` string)
- [ ] Frontend TypeScript compiles with zero errors after `role` -> `roles` change
- [ ] Frontend permission utility has unit tests (Vitest)
- [ ] UserFormModal uses checkboxes for multi-role assignment
- [ ] Admin pages show correct buttons per role combination
- [ ] Developer without admin cannot access User Management (backend + frontend)
- [ ] Admin without developer cannot write to System Config endpoints (backend + frontend)
- [ ] Developer without admin cannot write to Operations endpoints (backend + frontend)
- [ ] User with admin+developer can write to ALL endpoints
- [ ] Existing admin tests pass (with fixture updates for `roles` format)
- [ ] Seed data includes developer and superuser entries
- [ ] Reviewer approval workflow unaffected by changes
- [ ] `require_project_owner` correctly checks `"admin" in user.roles`
- [ ] Manual smoke test: login as developer, admin, admin+developer - verify all 8 tabs

### Verification Methods

| Method | Scope | Tool |
|--------|-------|------|
| Unit Test | Auth dependencies (7 functions) | pytest |
| Unit Test | Permission utility functions | Vitest |
| Unit Test | Pydantic schema validators (roles) | pytest |
| Integration Test | Endpoint access matrix (all 60+ endpoints) | pytest + httpx AsyncClient |
| Migration Test | Upgrade + downgrade round-trip | Alembic + pytest |
| Compile Check | Frontend type safety | TypeScript strict mode |
| Manual Test | Full admin UI walkthrough | Browser (4 role combos) |
| Regression Test | Existing functionality | Existing test suite |
