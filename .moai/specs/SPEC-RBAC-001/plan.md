# SPEC-RBAC-001: Implementation Plan

---
id: SPEC-RBAC-001
title: Multi-Role RBAC with Developer Role - Implementation Plan
tags: [rbac, auth, admin, security, multi-role]
---

## Milestone Overview

| Milestone | Description | Priority | Dependencies |
|-----------|-------------|----------|--------------|
| M1 | Backend - DB migration, model update, auth dependencies, endpoint permissions, schemas, services, seed | Primary Goal | None |
| M2 | Frontend - Auth store, types, permissions helper, admin UI, user form, all role checks | Secondary Goal | M1 |

---

## M1: Backend - DB Migration + Multi-Role Auth System

### Priority: Primary Goal

### Scope

Migrate the `role` column from String to PostgreSQL ARRAY(String), update the User model with a `has_role()` helper, rewrite all auth dependencies for array-based role checks, create new granular dependencies, update all admin router endpoints, update schemas, service-layer role checks, JWT payload, and seed data.

### Tasks

**M1-T1: Alembic Migration + User Model Update**
- Create Alembic migration: `role` (String) -> `roles` (ARRAY(String(20)))
  - Add `roles` column (nullable)
  - Populate: `UPDATE users SET roles = ARRAY[role]`
  - Set NOT NULL + server_default `'{editor}'`
  - Drop old `role` column
  - Include downgrade path (reverse: `roles[1]` -> `role`)
- Update `backend/app/models/user.py`:
  - Replace `role: Mapped[str] = mapped_column(String(20), default="editor")`
  - With `roles: Mapped[list[str]] = mapped_column(ARRAY(String(20)), default=["editor"])`
  - Add `has_role(self, role_name: str) -> bool` helper method
  - Import `ARRAY` from `sqlalchemy.dialects.postgresql`
- Files: `alembic/versions/*.py` (new), `models/user.py`

**M1-T2: Constants + VALID_ROLES**
- Add `VALID_ROLES = frozenset({"editor", "reviewer", "admin", "developer"})` to `backend/app/constants.py`
- Files: `constants.py`

**M1-T3: Auth Dependencies Rewrite**
- Update ALL existing dependencies in `backend/app/dependencies/auth.py`:
  - `require_reviewer`: `"reviewer" not in user.roles and "admin" not in user.roles` -> 403
  - `require_admin`: `"admin" not in user.roles` -> 403
  - `require_project_owner`: `"admin" in user.roles or project.created_by == user.id`
- Add 3 NEW dependencies:
  - `require_admin_or_developer`: `"admin" not in user.roles and "developer" not in user.roles` -> 403
  - `require_ops_write`: `"admin" not in user.roles` -> 403 (semantic: Operations write)
  - `require_system_write`: `"developer" not in user.roles` -> 403 (semantic: System Config write)
- Files: `dependencies/auth.py`

**M1-T4: JWT Payload Update**
- Update `backend/app/routers/auth.py`:
  - JWT payload: `"role": user.role` -> `"roles": user.roles`
  - Login response: ensure `user` object serialization uses `roles` field
  - `/auth/me` endpoint: ensure UserResponse returns `roles`
- Files: `routers/auth.py`

**M1-T5: Schema Updates**
- Update `backend/app/schemas/user.py`:
  - `UserResponse.role: str` -> `UserResponse.roles: list[str]`
- Update `backend/app/schemas/admin_user.py`:
  - `AdminUserCreate.role: str` -> `AdminUserCreate.roles: list[str]` with default `["editor"]`
  - `AdminUserUpdate.role: str | None` -> `AdminUserUpdate.roles: list[str] | None`
  - `AdminUserResponse.role: str` -> `AdminUserResponse.roles: list[str]`
  - Update validators: accept 4 roles, require non-empty, deduplicate
- Update `backend/app/schemas/comment.py` if `creator_role: str` is affected:
  - Verify: if this returns a single role string from the change_log or comment, it may need adjustment (or keep as first role for display)
- Files: `schemas/user.py`, `schemas/admin_user.py`, `schemas/comment.py` (verify)

**M1-T6: Admin Router Endpoint Migration - admin_users.py**
- All 5 endpoints remain `require_admin` (no change in dependency name, but `require_admin` itself is updated to array check in M1-T3)
- Verify: no direct `user.role` references in the router file
- Files: `routers/admin_users.py` (verify only)

**M1-T7: Admin Router Endpoint Migration - admin_master.py**
- Split all 28 endpoints by GET vs write:
  - All GET endpoints: `require_admin` -> `require_admin_or_developer`
  - Lines/Products/Layers/Equipment POST/PUT/DELETE: `require_admin` -> `require_ops_write`
  - Columns/Categories POST/PUT/DELETE: `require_admin` -> `require_system_write`
- Update import statement to include new dependencies
- Files: `routers/admin_master.py`

**M1-T8: Admin Router Endpoint Migration - admin.py**
- Split 11 endpoints:
  - Recipe mappings GET: `require_admin_or_developer`, write: `require_system_write`
  - Validation rules GET: `require_admin_or_developer`, write: `require_system_write`
  - Select options GET: `require_admin_or_developer`, PUT: `require_ops_write`
  - Audit logs GET: `require_admin_or_developer`
  - Export histories GET: `require_admin_or_developer`
- Files: `routers/admin.py`

**M1-T9: Admin Router Endpoint Migration - export_admin.py**
- Split 10 endpoints:
  - Export systems GET: `require_admin_or_developer`, write: `require_system_write`
  - Export mappings GET: `require_admin_or_developer`, write: `require_system_write`
- Files: `routers/export_admin.py`

**M1-T10: Admin Router Endpoint Migration - export_data_source.py**
- Split 5 endpoints:
  - Data sources GET + GET columns: `require_admin_or_developer`
  - Data sources POST/PUT/DELETE: `require_system_write`
- Files: `routers/export_data_source.py`

**M1-T11: Service Layer Role Check Updates**
- `admin_user_service.py`:
  - Last-admin guard: query `User.roles.contains(["admin"])` instead of `User.role == "admin"`
  - `create_user`: use `roles=data.roles`
  - `update_user`: use `data.roles`, guard against removing admin from last admin
  - Deactivate guard: check `"admin" in user.roles`
- `project_status_service.py` (line 78):
  - `current_user.role not in ["reviewer", "admin"]` -> `"reviewer" not in current_user.roles and "admin" not in current_user.roles`
- `comment_service.py` (lines 160, 230):
  - `user.role != "admin"` -> `"admin" not in user.roles`
- Files: `services/admin_user_service.py`, `services/project_status_service.py`, `services/comment_service.py`

**M1-T12: Seed Data Update**
- Update `backend/app/seed/users.py`:
  - Change all `"role": "xxx"` to `"roles": ["xxx"]`
  - Add developer user: `{"username": "developer1", "display_name": "개발자", "roles": ["developer"], "email": "developer@pcm.local"}`
  - Add superuser: `{"username": "superuser1", "display_name": "수퍼유저", "roles": ["admin", "developer"], "email": "superuser@pcm.local"}`
- Update `backend/app/seed/runner.py`:
  - Change INSERT to use ARRAY format: `"r": u["roles"]` with PostgreSQL array literal
  - Update column name from `role` to `roles` in INSERT statement
- Files: `seed/users.py`, `seed/runner.py`

### Technical Approach

- Migration uses a 4-step process (add column, populate, set constraints, drop old) for zero-downtime safety
- Auth dependencies chain on `require_active_user` as before; only the role-check logic changes
- `has_role()` model helper centralizes the `in` check for use in service layer
- PostgreSQL `ARRAY.contains()` method used for SQLAlchemy queries

### Risks

- Migration must be tested with representative data before production deployment
- INSERT format for ARRAY in seed runner requires PostgreSQL array literal syntax (`'{admin}'` or `ARRAY['admin']`)
- All `.role` references must be caught; grep verification is mandatory

---

## M2: Frontend - Multi-Role Admin UI

### Priority: Secondary Goal

### Scope

Update frontend to handle `roles` array instead of `role` string. Create centralized permission helper. Update all admin pages for role-aware rendering. Convert user form from single-role dropdown to multi-role checkboxes.

### Tasks

**M2-T1: Type Updates**
- `frontend/src/types/user.ts`:
  - `role: 'editor' | 'reviewer' | 'admin'` -> `roles: ('editor' | 'reviewer' | 'admin' | 'developer')[]`
  - `AuthUser`: update Pick to include `roles`
- `frontend/src/types/adminUser.ts`:
  - `AdminUser.role` -> `AdminUser.roles` (array)
  - `AdminUserCreate.role` -> `AdminUserCreate.roles` (array)
  - `AdminUserUpdate.role?` -> `AdminUserUpdate.roles?` (array)
- Files: `types/user.ts`, `types/adminUser.ts`

**M2-T2: Permission Helper Utility**
- Create `frontend/src/lib/permissions.ts`:
  - `hasRole(roles, role)` - single role check
  - `hasAnyRole(roles, required)` - any of required roles
  - `canAccessAdmin(roles)` - admin or developer
  - `canAccessTab(roles, tabPath)` - /admin/users requires admin
  - `canWrite(roles, category)` - operations: admin, system_config: developer
  - `getMenuCategory(tabPath)` - maps path to category
  - `formatRoles(roles)` - Korean labels
- Files: `lib/permissions.ts` (new)

**M2-T3: Header.tsx - Admin Menu + Role Badge**
- Replace `user?.role === 'admin'` with `canAccessAdmin(user?.roles)`
- Replace single role badge `{user.role}` with role list display:
  - Option A: comma-separated badges
  - Option B: multiple small pills
- Files: `components/layout/Header.tsx`

**M2-T4: AdminLayout.tsx - Role Guard + Tab Filtering**
- Replace `currentUser.role !== 'admin'` with `!canAccessAdmin(currentUser.roles)`
- Filter tabs using `canAccessTab(currentUser.roles, tab.path)`
- Set default redirect: admin -> `/admin/users`, developer (no admin) -> first visible tab (e.g., `/admin/master-data`)
- Add read-only indicator to tab labels where user cannot write
- Files: `pages/admin/AdminLayout.tsx`

**M2-T5: RequireRole.tsx - Array Intersection**
- Replace `allowedRoles.includes(user.role)` with `allowedRoles.some(r => user.roles.includes(r))`
- Or use `hasAnyRole(user.roles, allowedRoles)` from permissions helper
- Files: `components/auth/RequireRole.tsx`

**M2-T6: UserFormModal.tsx - Multi-Role Checkboxes**
- Replace `role` state (string) with `selectedRoles` state (string[])
- Replace `<select>` dropdown with 4 checkboxes:
  - editor (편집자), reviewer (검토자), admin (관리자), developer (개발자)
- Validate at least one role selected before submit
- On edit: initialize `selectedRoles` from `user.roles`
- On create: default `selectedRoles = ['editor']`
- Submit payload: `roles: selectedRoles` instead of `role`
- Files: `components/admin/UserFormModal.tsx`

**M2-T7: UserManagementPage.tsx - Multi-Role Badges**
- Replace single `roleBadge(user.role)` / `roleLabel(user.role)` with multi-role rendering
- Add `developer` badge styling (e.g., `bg-blue-100 text-blue-800`)
- Display each role as a separate badge pill
- Add "개발자" to roleLabel map
- Files: `pages/admin/UserManagementPage.tsx`

**M2-T8: ApprovalButtons.tsx - Array Check**
- Replace `currentUser.role !== 'reviewer' && currentUser.role !== 'admin'` with `!hasAnyRole(currentUser.roles, ['reviewer', 'admin'])`
- Files: `components/editor/ApprovalButtons.tsx`

**M2-T9: Operations Pages - Conditional Write Buttons**
- MasterDataPage (Line/Product/Layer sub-panels): disable Add/Edit/Delete when `!canWrite(roles, 'operations')`
- MasterDataPage (Column/Category sub-panels): disable when `!canWrite(roles, 'system_config')`
- EnumManagementPage: disable edit when `!canWrite(roles, 'operations')`
- Files: `pages/admin/MasterDataPage.tsx` + sub-panels, `pages/admin/EnumManagementPage.tsx`

**M2-T10: System Config Pages - Conditional Write Buttons**
- XmlMappingsPage: disable CRUD when `!canWrite(roles, 'system_config')`
- ValidationRulesPage: disable upload/edit when `!canWrite(roles, 'system_config')`
- ExportSystemsPage: disable CRUD when `!canWrite(roles, 'system_config')`
- ExportDataSourcesPage: disable CRUD when `!canWrite(roles, 'system_config')`
- Files: 4 admin page files

**M2-T11: Read-Only Visual Indicator**
- Add subtle "읽기 전용" badge/banner on pages where current user cannot write
- Reusable component or inline rendering
- Files: Common component or inline in each admin page

**M2-T12: Auth Store Test Updates**
- Update all test fixtures from `role: 'admin'` to `roles: ['admin']`
- Files: `stores/__tests__/useAuthStore.test.ts`

**M2-T13: App.tsx - Admin Default Route**
- Update admin index redirect to be role-aware:
  - Has admin role -> `/admin/users`
  - Has developer (no admin) -> `/admin/master-data`
- Files: `App.tsx` or `AdminLayout.tsx`

### Technical Approach

- Centralized `permissions.ts` prevents scattering role checks across components
- All admin pages consume `useAuthStore` for current user roles and call `canWrite()` from permissions
- `readOnly` prop pattern used for form/modal components to disable inputs
- TypeScript strict mode catches all `role` -> `roles` mismatches at compile time
- Existing `RequireRole` component enhanced to support array intersection

### Risks

- Missing a role check in some component: TypeScript compilation will catch type mismatches for `role` -> `roles`
- UI/UX for multi-role display: multiple badge pills may take more horizontal space; keep compact styling
- Auth store test fixtures need systematic updates

---

## Architecture Design Direction

### Backend Pattern

```
require_active_user
  |-- require_admin (updated: "admin" in user.roles)
  |-- require_reviewer (updated: array check)
  |-- require_admin_or_developer (new - admin section read access)
  |-- require_ops_write (new - Operations write, requires admin)
  |-- require_system_write (new - System Config write, requires developer)
  |-- require_project_owner (updated: "admin" in user.roles)
```

### Frontend Pattern

```
useAuthStore (roles: string[])
  -> permissions.ts (hasRole, hasAnyRole, canAccessAdmin, canWrite, canAccessTab)
    -> Header.tsx (show/hide admin link, role badges)
    -> AdminLayout.tsx (role guard, tab filtering, default route)
    -> RequireRole.tsx (array intersection)
    -> ApprovalButtons.tsx (reviewer check)
    -> Admin Pages (button enable/disable, read-only badges)
    -> UserFormModal.tsx (multi-role checkboxes)
```

### File Impact Summary

| File | Change Type | Complexity |
|------|------------|------------|
| `alembic/versions/*.py` | New migration file | Medium |
| `models/user.py` | Column type + helper method | Low |
| `constants.py` | Add VALID_ROLES | Trivial |
| `dependencies/auth.py` | Rewrite 4 + add 3 functions | Medium |
| `routers/auth.py` | JWT payload + response | Low |
| `schemas/user.py` | role -> roles | Low |
| `schemas/admin_user.py` | role -> roles + validators | Medium |
| `routers/admin_users.py` | Verify only (no change) | None |
| `routers/admin_master.py` | Swap deps (~28 endpoints) | Medium |
| `routers/admin.py` | Swap deps (~11 endpoints) | Medium |
| `routers/export_admin.py` | Swap deps (~10 endpoints) | Medium |
| `routers/export_data_source.py` | Swap deps (~5 endpoints) | Low |
| `services/admin_user_service.py` | Array-based role checks | Medium |
| `services/project_status_service.py` | 1 line role check | Trivial |
| `services/comment_service.py` | 2 lines role check | Trivial |
| `seed/users.py` | Array format + new users | Low |
| `seed/runner.py` | INSERT format update | Low |
| `types/user.ts` | role -> roles union array | Low |
| `types/adminUser.ts` | role -> roles union array | Low |
| `lib/permissions.ts` | New file | Medium |
| `components/layout/Header.tsx` | Admin check + badges | Low |
| `pages/admin/AdminLayout.tsx` | Guard + tab filter + default | Medium |
| `components/auth/RequireRole.tsx` | Array intersection | Low |
| `components/editor/ApprovalButtons.tsx` | Array check | Trivial |
| `components/admin/UserFormModal.tsx` | Dropdown -> checkboxes | Medium |
| `pages/admin/UserManagementPage.tsx` | Multi-role badges | Low |
| `pages/admin/*.tsx` (4+ pages) | Conditional buttons | Medium |
| `stores/__tests__/useAuthStore.test.ts` | Test fixture updates | Low |
