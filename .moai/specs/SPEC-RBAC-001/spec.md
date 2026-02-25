# SPEC-RBAC-001: Multi-Role RBAC with Developer Role

---
id: SPEC-RBAC-001
title: Multi-Role RBAC with Developer Role
status: Completed
priority: High
created: 2026-02-25
lifecycle: spec-anchored
tags: [rbac, auth, admin, security, multi-role]
---

## 1. Environment

### 1.1 Current System State

- PCM system has 3 user roles stored as a single string: `editor`, `reviewer`, `admin`
- User model: `role: Mapped[str] = mapped_column(String(20), default="editor")`
- All admin menu endpoints use a single `require_admin` dependency (admin-only)
- 8 admin tabs exist, all exclusively accessible by admin role
- Auth dependencies check `user.role == "admin"`, `user.role in ("reviewer", "admin")`, etc.
- Frontend checks `user.role === 'admin'`, `user.role !== 'admin'`, etc.
- JWT payload includes `role` as a single string

### 1.2 Affected Components

**Backend (model + auth layer):**
- `backend/app/models/user.py` - User model (`role` column -> `roles` ARRAY column)
- `backend/app/dependencies/auth.py` - Auth dependencies (4 existing functions, 3 new)
- `backend/app/routers/auth.py` - JWT payload generation, login response
- `backend/app/schemas/user.py` - UserResponse schema
- `backend/app/schemas/admin_user.py` - AdminUserCreate/Update/Response schemas
- `backend/app/constants.py` - VALID_ROLES constant

**Backend (role check sites):**
- `backend/app/services/admin_user_service.py` - Role validation, admin guard, last-admin check
- `backend/app/services/project_status_service.py` - Reviewer role check (line 78)
- `backend/app/services/comment_service.py` - Admin role checks (lines 160, 230)
- `backend/app/routers/admin.py` - 11 endpoints (require_admin)
- `backend/app/routers/admin_master.py` - 28 endpoints (require_admin)
- `backend/app/routers/admin_users.py` - 5 endpoints (require_admin)
- `backend/app/routers/export_admin.py` - 10 endpoints (require_admin)
- `backend/app/routers/export_data_source.py` - 5 endpoints (require_admin)
- `backend/app/seed/users.py` - Seed data (single role strings)
- `backend/app/seed/runner.py` - INSERT statement format

**Frontend:**
- `frontend/src/types/user.ts` - User type (`role` -> `roles`)
- `frontend/src/types/adminUser.ts` - AdminUser type (`role` -> `roles`)
- `frontend/src/stores/useAuthStore.ts` - AuthUser type reference
- `frontend/src/components/layout/Header.tsx` - Admin menu visibility + role badge display
- `frontend/src/pages/admin/AdminLayout.tsx` - Admin guard + tab navigation
- `frontend/src/pages/admin/UserManagementPage.tsx` - Role badges/labels
- `frontend/src/components/admin/UserFormModal.tsx` - Role assignment (dropdown -> checkboxes)
- `frontend/src/components/auth/RequireRole.tsx` - Role intersection check
- `frontend/src/components/editor/ApprovalButtons.tsx` - Reviewer role check

**Database:**
- Alembic migration: `role` (String) -> `roles` (ARRAY(String)) with data migration

### 1.3 Technology Stack

- Backend: FastAPI, SQLAlchemy 2.x (async), PostgreSQL ARRAY type, python-jose (JWT), Pydantic
- Frontend: React 18 + TypeScript, Zustand (auth store), React Router
- DB: PostgreSQL 16 (native ARRAY support)

## 2. Assumptions

- A1: PostgreSQL ARRAY(String) is appropriate for role storage because the set of possible roles is small (max 4) and does not require a many-to-many junction table.
- A2: The `@>` (contains) operator on PostgreSQL arrays is performant for role queries since array length is bounded at 4 elements.
- A3: Existing `admin` users receive `["admin"]` during migration, preserving all current access without any behavioral change.
- A4: The new `developer` role only controls admin-section access. It does NOT affect project editing, approval workflow, or any non-admin features.
- A5: A user can hold any combination of roles simultaneously (e.g., `["admin", "developer"]` grants full admin + system config write access).
- A6: The JWT `roles` claim is an array of strings. All clients must be updated to handle this format.
- A7: `require_project_owner` currently checks `user.role == "admin"`; this must be updated to `"admin" in user.roles`.
- A8: Frontend `RequireRole` component currently checks `allowedRoles.includes(user.role)` and must be updated to check for any role intersection.

## 3. Requirements

### 3.1 Multi-Role Model

**[REQ-RBAC-001] Ubiquitous:**
The system **shall** support four user roles: `editor`, `reviewer`, `admin`, and `developer`.

**[REQ-RBAC-002] Ubiquitous:**
The system **shall** allow each user to hold multiple roles simultaneously, stored as a PostgreSQL ARRAY of strings.

**[REQ-RBAC-003] Event-Driven:**
**When** a user with `developer` in their roles logs in, **then** the system **shall** display the admin menu in the header navigation.

**[REQ-RBAC-004] Event-Driven:**
**When** a user with both `admin` and `developer` in their roles accesses any admin menu, **then** the system **shall** grant full read/write access to all admin menus.

**[REQ-RBAC-005] Unwanted Behavior:**
The system **shall not** allow a user whose roles include only `developer` (without `admin`) to access User Management endpoints (GET, POST, PUT, DELETE).

### 3.2 Menu Access Control - Operations Category

**[REQ-RBAC-010] State-Driven:**
**If** the current user has `admin` in their roles, **then** the system **shall** grant read/write access to Operations-category menus: User Management, Master Data (Line/Product/Layer), Equipment, Enum/Select Options.

**[REQ-RBAC-011] State-Driven:**
**If** the current user has `developer` in their roles (without `admin`), **then** the system **shall** grant read-only access to Operations-category menus (excluding User Management): Master Data (Line/Product/Layer), Equipment, Enum/Select Options.

**[REQ-RBAC-012] State-Driven:**
**If** the current user has `developer` in their roles (without `admin`), **then** the system **shall** hide or disable all create/edit/delete buttons on Operations-category pages.

### 3.3 Menu Access Control - System Config Category

**[REQ-RBAC-020] State-Driven:**
**If** the current user has `developer` in their roles, **then** the system **shall** grant read/write access to System Config menus: Column/Category metadata, XML Mapping, Validation Rules, Export Systems, Export Data Sources.

**[REQ-RBAC-021] State-Driven:**
**If** the current user has `admin` in their roles (without `developer`), **then** the system **shall** grant read-only access to System Config menus.

**[REQ-RBAC-022] State-Driven:**
**If** the current user has `admin` in their roles (without `developer`), **then** the system **shall** hide or disable create/edit/delete buttons on System Config pages.

### 3.4 Combined Role Access

**[REQ-RBAC-025] State-Driven:**
**If** the current user has both `admin` and `developer` in their roles, **then** the system **shall** grant full read/write access to ALL admin menus (Operations + System Config + User Management).

### 3.5 Audit Log Access

**[REQ-RBAC-030] State-Driven:**
**If** the current user has `admin` or `developer` in their roles, **then** the system **shall** grant read-only access to Audit Log.

### 3.6 Backend Auth Dependencies

**[REQ-RBAC-040] Ubiquitous:**
The system **shall** provide the following auth dependency functions:
- `require_admin`: Allows access for users with `admin` in their roles (updated from `user.role == "admin"` to `"admin" in user.roles`).
- `require_reviewer`: Allows access for users with `reviewer` or `admin` in their roles (updated to check against array).
- `require_admin_or_developer`: Allows access for users with `admin` or `developer` in their roles (NEW).
- `require_ops_write`: Allows write access only for users with `admin` in their roles (NEW - Operations category write endpoints).
- `require_system_write`: Allows write access only for users with `developer` in their roles (NEW - System Config category write endpoints).
- `require_project_owner`: Updated to check `"admin" in user.roles` instead of `user.role == "admin"`.

**[REQ-RBAC-041] Event-Driven:**
**When** a user without the required role calls a write endpoint, **then** the system **shall** return HTTP 403 with a descriptive error message indicating which permission is missing.

### 3.7 Database Migration

**[REQ-RBAC-045] Event-Driven:**
**When** the Alembic migration runs, **then** the system **shall** safely convert existing `role` (String) values to `roles` (ARRAY(String)) by wrapping each existing single-role value in a single-element array (e.g., `"admin"` -> `["admin"]`).

**[REQ-RBAC-046] Unwanted Behavior:**
The migration **shall not** lose any existing role data or leave any user without at least one role.

### 3.8 Backward Compatibility

**[REQ-RBAC-050] Ubiquitous:**
The system **shall** maintain full backward compatibility for existing `editor`, `reviewer`, and `admin` roles. A user with `["admin"]` **shall** have identical access to what a user with `role = "admin"` had before this change.

**[REQ-RBAC-051] Ubiquitous:**
The `require_reviewer` dependency **shall** continue to allow both `reviewer` and `admin` roles, preserving the current approval workflow behavior.

**[REQ-RBAC-052] Ubiquitous:**
The `require_reviewer` dependency **shall NOT** include `developer` role. Developers have no approval workflow access unless they also hold `reviewer` or `admin`.

### 3.9 User Management for Multi-Role

**[REQ-RBAC-060] Event-Driven:**
**When** an admin creates or edits a user, **then** the system **shall** present role assignment as checkboxes (one per role) allowing multiple selections.

**[REQ-RBAC-061] Unwanted Behavior:**
The system **shall not** allow creating a user with zero roles. At least one role must be assigned.

## 4. Specifications

### 4.1 Menu Access Matrix

| Menu | Category | admin | developer | admin+developer | editor/reviewer |
|------|----------|:-----:|:---------:|:---------------:|:---------------:|
| User Management | Operations | R/W | No Access | R/W | No Access |
| Master Data (Line/Product/Layer) | Operations | R/W | R | R/W | No Access |
| Master Data (Column/Category) | System Config | R | R/W | R/W | No Access |
| Equipment | Operations | R/W | R | R/W | No Access |
| Enum/Select Options | Operations | R/W | R | R/W | No Access |
| XML Mapping | System Config | R | R/W | R/W | No Access |
| Validation Rules | System Config | R | R/W | R/W | No Access |
| Export Systems | System Config | R | R/W | R/W | No Access |
| Export Data Sources | System Config | R | R/W | R/W | No Access |
| Audit Log | Shared | R | R | R | No Access |

### 4.2 DB Schema Change

```python
# BEFORE (current)
role: Mapped[str] = mapped_column(String(20), default="editor")

# AFTER (new)
from sqlalchemy.dialects.postgresql import ARRAY
roles: Mapped[list[str]] = mapped_column(ARRAY(String(20)), default=["editor"])
```

Helper method on User model:
```python
def has_role(self, role_name: str) -> bool:
    """Check if user has a specific role."""
    return role_name in (self.roles or [])
```

### 4.3 Alembic Migration Strategy

```python
# Step 1: Add new 'roles' column (ARRAY, nullable, no default)
op.add_column('users', sa.Column('roles', ARRAY(sa.String(20)), nullable=True))

# Step 2: Populate 'roles' from existing 'role'
op.execute("UPDATE users SET roles = ARRAY[role]")

# Step 3: Make 'roles' NOT NULL with default
op.alter_column('users', 'roles', nullable=False, server_default='{editor}')

# Step 4: Drop old 'role' column
op.drop_column('users', 'role')
```

Downgrade:
```python
# Reverse: take first element of roles array back to role column
op.add_column('users', sa.Column('role', sa.String(20), nullable=True))
op.execute("UPDATE users SET role = roles[1]")
op.alter_column('users', 'role', nullable=False, server_default='editor')
op.drop_column('users', 'roles')
```

### 4.4 Backend Auth Dependency Mapping

| Endpoint Pattern | Current Dependency | New Dependency |
|------------------|-------------------|----------------|
| `GET/POST/PUT/DELETE /api/admin/users/*` | `require_admin` | `require_admin` (unchanged logic, updated to array check) |
| `GET /api/admin/lines` | `require_admin` | `require_admin_or_developer` |
| `POST/PUT/DELETE /api/admin/lines/*` | `require_admin` | `require_ops_write` |
| `GET /api/admin/products` | `require_admin` | `require_admin_or_developer` |
| `POST/PUT/DELETE /api/admin/products/*` | `require_admin` | `require_ops_write` |
| `GET /api/admin/layers` | `require_admin` | `require_admin_or_developer` |
| `POST/PUT/DELETE /api/admin/layers/*` | `require_admin` | `require_ops_write` |
| `GET /api/admin/columns` | `require_admin` | `require_admin_or_developer` |
| `POST/PUT/DELETE /api/admin/columns/*` | `require_admin` | `require_system_write` |
| `GET /api/admin/categories` | `require_admin` | `require_admin_or_developer` |
| `POST/PUT/DELETE /api/admin/categories/*` | `require_admin` | `require_system_write` |
| `GET /api/admin/equipments` | `require_admin` | `require_admin_or_developer` |
| `POST/PUT/DELETE /api/admin/equipments/*` | `require_admin` | `require_ops_write` |
| `GET /api/admin/recipe-mappings` | `require_admin` | `require_admin_or_developer` |
| `POST/PUT/DELETE /api/admin/recipe-mappings/*` | `require_admin` | `require_system_write` |
| `GET /api/admin/select-options` | `require_admin` | `require_admin_or_developer` |
| `PUT /api/admin/select-options/*` | `require_admin` | `require_ops_write` |
| `GET /api/admin/validation-rules/*` | `require_admin` | `require_admin_or_developer` |
| `PUT /api/admin/validation-rules/*` | `require_admin` | `require_system_write` |
| `POST /api/admin/validation-rules/upload` | `require_admin` | `require_system_write` |
| `GET /api/admin/export-systems` | `require_admin` | `require_admin_or_developer` |
| `POST/PUT/DELETE /api/admin/export-systems/*` | `require_admin` | `require_system_write` |
| `GET /api/admin/export-mappings/*` | `require_admin` | `require_admin_or_developer` |
| `POST/PUT/DELETE /api/admin/export-mappings/*` | `require_admin` | `require_system_write` |
| `GET /api/admin/data-sources` | `require_admin` | `require_admin_or_developer` |
| `POST/PUT/DELETE /api/admin/data-sources/*` | `require_admin` | `require_system_write` |
| `GET /api/admin/data-sources/*/columns` | `require_admin` | `require_admin_or_developer` |
| `GET /api/admin/audit-logs` | `require_admin` | `require_admin_or_developer` |
| `GET /api/admin/export-histories` | `require_admin` | `require_admin_or_developer` |

### 4.5 Updated Auth Dependencies (backend/app/dependencies/auth.py)

```python
async def require_reviewer(
    user: User = Depends(require_active_user),
) -> User:
    """Ensure the user has reviewer or admin role."""
    if "reviewer" not in user.roles and "admin" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reviewer or admin access required",
        )
    return user


async def require_admin(
    user: User = Depends(require_active_user),
) -> User:
    """Ensure the user has admin role."""
    if "admin" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


async def require_admin_or_developer(
    user: User = Depends(require_active_user),
) -> User:
    """Ensure the user has admin or developer role (read access to admin section)."""
    if "admin" not in user.roles and "developer" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or developer access required",
        )
    return user


async def require_ops_write(
    user: User = Depends(require_active_user),
) -> User:
    """Ensure the user has admin role (Operations category write permission)."""
    if "admin" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required for operations write",
        )
    return user


async def require_system_write(
    user: User = Depends(require_active_user),
) -> User:
    """Ensure the user has developer role (System Config write permission)."""
    if "developer" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Developer access required for system config write",
        )
    return user


async def require_project_owner(
    project_id: int,
    user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Ensure the user owns the project or has admin role."""
    from app.models.project import Project

    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    if "admin" in user.roles or project.created_by == user.id:
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have access to this project",
    )
```

### 4.6 JWT Payload Change

```python
# BEFORE
{"sub": str(user.id), "username": user.username, "role": user.role}

# AFTER
{"sub": str(user.id), "username": user.username, "roles": user.roles}
```

### 4.7 Schema Changes

```python
# backend/app/schemas/user.py
class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    roles: list[str]  # Changed from role: str
    is_active: bool
    model_config = {"from_attributes": True}

# backend/app/schemas/admin_user.py
class AdminUserCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    display_name: str = Field(..., min_length=1, max_length=100)
    email: str | None = Field(None, max_length=255)
    roles: list[str] = Field(default=["editor"])  # Changed from role: str
    password: str = Field(..., min_length=4, max_length=100)

    @field_validator("roles")
    @classmethod
    def validate_roles(cls, v):
        valid = {"editor", "reviewer", "admin", "developer"}
        if not v:
            raise ValueError("At least one role is required")
        invalid = set(v) - valid
        if invalid:
            raise ValueError(f"Invalid roles: {invalid}. Must be one of: {valid}")
        return list(set(v))  # Deduplicate

class AdminUserUpdate(BaseModel):
    display_name: str | None = Field(None, max_length=100)
    email: str | None = None
    roles: list[str] | None = None
    is_active: bool | None = None

    @field_validator("roles")
    @classmethod
    def validate_roles(cls, v):
        if v is not None:
            valid = {"editor", "reviewer", "admin", "developer"}
            if not v:
                raise ValueError("At least one role is required")
            invalid = set(v) - valid
            if invalid:
                raise ValueError(f"Invalid roles: {invalid}. Must be one of: {valid}")
            return list(set(v))
        return v

class AdminUserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    email: str | None = None
    roles: list[str]  # Changed from role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)
```

### 4.8 Frontend Type Changes

```typescript
// frontend/src/types/user.ts
export interface User {
  id: number
  username: string
  display_name: string
  roles: ('editor' | 'reviewer' | 'admin' | 'developer')[]  // Changed from role
  is_active: boolean
}

export type AuthUser = Pick<User, 'id' | 'username' | 'display_name' | 'roles'>

// frontend/src/types/adminUser.ts
export interface AdminUser {
  ...
  roles: ('editor' | 'reviewer' | 'admin' | 'developer')[]  // Changed from role
}
```

### 4.9 Frontend Permission Helper (lib/permissions.ts)

```typescript
type UserRole = 'editor' | 'reviewer' | 'admin' | 'developer'
type MenuCategory = 'operations' | 'system_config' | 'shared'

export function hasRole(roles: UserRole[] | undefined, role: UserRole): boolean {
  return roles?.includes(role) ?? false
}

export function hasAnyRole(roles: UserRole[] | undefined, required: UserRole[]): boolean {
  return required.some(r => roles?.includes(r) ?? false)
}

export function canAccessAdmin(roles: UserRole[] | undefined): boolean {
  return hasAnyRole(roles, ['admin', 'developer'])
}

export function canAccessTab(roles: UserRole[] | undefined, tabPath: string): boolean {
  if (tabPath === '/admin/users') return hasRole(roles, 'admin')
  return canAccessAdmin(roles)
}

export function canWrite(roles: UserRole[] | undefined, category: MenuCategory): boolean {
  if (category === 'operations') return hasRole(roles, 'admin')
  if (category === 'system_config') return hasRole(roles, 'developer')
  return false  // shared = read-only for all
}

export function getMenuCategory(tabPath: string): MenuCategory {
  const systemConfigPaths = ['/admin/xml-mappings', '/admin/validations',
    '/admin/export-systems', '/admin/data-sources']
  if (systemConfigPaths.includes(tabPath)) return 'system_config'
  if (tabPath === '/admin/audit-logs') return 'shared'
  return 'operations'
}

export function formatRoles(roles: string[]): string {
  const labels: Record<string, string> = {
    editor: '편집자', reviewer: '검토자', admin: '관리자', developer: '개발자',
  }
  return roles.map(r => labels[r] ?? r).join(', ')
}
```

### 4.10 Frontend Admin Access Logic

```typescript
// Header.tsx - Show admin link for admin OR developer
const canShowAdmin = canAccessAdmin(user?.roles)

// Header.tsx - Display roles as badge(s)
{user.roles.map(r => <span key={r} className="...">{r}</span>)}

// AdminLayout.tsx - Allow admin OR developer
if (currentUserId && currentUser && !canAccessAdmin(currentUser.roles)) {
  return <Navigate to="/projects" replace />
}

// AdminLayout.tsx - Filter visible tabs
const visibleTabs = tabs.filter(tab => canAccessTab(currentUser.roles, tab.path))

// RequireRole.tsx - Check role intersection
if (!user || !allowedRoles.some(r => user.roles.includes(r))) {
  return <>{fallback}</>
}

// ApprovalButtons.tsx - Check reviewer access
if (!currentUser || !hasAnyRole(currentUser.roles, ['reviewer', 'admin'])) return null

// UserFormModal.tsx - Checkboxes instead of dropdown
const [selectedRoles, setSelectedRoles] = useState<string[]>(['editor'])
// Render 4 checkboxes: editor, reviewer, admin, developer
```

### 4.11 Seed Data Update

```python
# backend/app/seed/users.py
USERS = [
    {"username": "admin1", "display_name": "관리자", "roles": ["admin"], "email": "admin@pcm.local"},
    {"username": "engineer1", "display_name": "김엔지니어", "roles": ["editor"], "email": "editor@pcm.local"},
    {"username": "engineer2", "display_name": "이엔지니어", "roles": ["editor"], "email": "editor2@pcm.local"},
    {"username": "engineer3", "display_name": "박엔지니어", "roles": ["editor"], "email": "editor3@pcm.local"},
    {"username": "reviewer1", "display_name": "최검토자", "roles": ["reviewer"], "email": "reviewer@pcm.local"},
    {"username": "developer1", "display_name": "개발자", "roles": ["developer"], "email": "developer@pcm.local"},
    {"username": "superuser1", "display_name": "수퍼유저", "roles": ["admin", "developer"], "email": "superuser@pcm.local"},
]
```

### 4.12 Constants Update

```python
# backend/app/constants.py
VALID_ROLES = frozenset({"editor", "reviewer", "admin", "developer"})
```

### 4.13 Service Layer Role Check Updates

```python
# admin_user_service.py - Last admin guard
# Check: count of users where roles array contains 'admin'
stmt = select(func.count()).where(User.roles.contains(["admin"]), User.is_active.is_(True))

# admin_user_service.py - Create user
user = User(username=data.username, ..., roles=data.roles)

# admin_user_service.py - Update user roles
if data.roles is not None:
    # Prevent removing admin from the last admin user
    if "admin" in user.roles and "admin" not in data.roles:
        # ... last admin check
    user.roles = data.roles

# project_status_service.py - Reviewer check
if "reviewer" not in current_user.roles and "admin" not in current_user.roles:

# comment_service.py - Admin check
if comment.created_by != user_id and "admin" not in user.roles:
```

## 5. Constraints

- C1: PostgreSQL ARRAY(String(20)) is used instead of a junction table. Max 4 possible roles, no many-to-many explosion.
- C2: The `developer` role is admin-section only. It does NOT grant project editing or approval workflow capabilities.
- C3: An Alembic migration IS required (`role` String -> `roles` ARRAY), unlike the previous single-role SPEC version.
- C4: `require_ops_write` is functionally similar to `require_admin` but exists as a separate function for semantic clarity and the Operations write context.
- C5: Frontend read-only mode should disable buttons/forms but still allow viewing data.
- C6: Every user must have at least one role in the `roles` array. Empty arrays are forbidden.
- C7: The `roles` array stores deduplicated values (no duplicate roles for same user).

## 6. Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Migration fails on production data | Low | Critical | Test migration on staging with production data copy; include downgrade path |
| Existing tests break due to `role` -> `roles` rename | High | Medium | Systematic find-and-replace across test files; run full test suite |
| JWT format change breaks active sessions | Medium | Medium | During deployment: invalidate all refresh tokens so users re-login and get new JWT format |
| Frontend type mismatch (`role` vs `roles`) | Medium | Low | TypeScript strict mode catches all mismatches at compile time |
| `require_project_owner` role check missed | Low | High | Code search for all `user.role` references; verified in Section 1.2 |
| Service layer role checks missed | Low | High | Grep for `.role` across all service files; verified 3 locations |
| Seed runner INSERT format incompatible with ARRAY | Medium | Low | Update INSERT to use PostgreSQL array literal syntax |

## 7. Traceability

| Requirement | Plan Reference | Acceptance Reference |
|-------------|---------------|---------------------|
| REQ-RBAC-001~002 | M1-T1: DB migration + model | AC-001 |
| REQ-RBAC-003~005 | M2-T3, M2-T4: Frontend UI | AC-002, AC-003 |
| REQ-RBAC-010~012 | M1-T4: Endpoint migration | AC-010, AC-011 |
| REQ-RBAC-020~022 | M1-T5~T7: Endpoint migration | AC-020, AC-021 |
| REQ-RBAC-025 | M1-T2, M2-T2: Combined role | AC-025 |
| REQ-RBAC-030 | M1-T5: Audit log endpoint | AC-030 |
| REQ-RBAC-040~041 | M1-T2: Auth dependencies | AC-040 |
| REQ-RBAC-045~046 | M1-T1: Migration | AC-045 |
| REQ-RBAC-050~052 | M1-T2: Backward compat | AC-050 |
| REQ-RBAC-060~061 | M2-T6: User form | AC-060 |

## 8. Implementation Notes

**Completed**: 2026-02-26
**Branch**: feature/SPEC-RBAC-001
**Commit**: 40e3b85

### Implementation Summary

- 63 files changed (56 modified + 7 new), +3,047 / -563 lines
- Backend: 20 files (Alembic migration, User model, 7 auth deps, 5 admin routers, 3 service files, schemas, seed)
- Frontend: 18 files (types, permissions.ts, Header, AdminLayout, UserFormModal, 10+ admin/editor components)
- Tests: 38 new backend RBAC tests + 41 new frontend permissions tests

### Gap Fixes (Beyond Original SPEC)

10 additional files identified during implementation that the SPEC did not cover:
1. `routers/users.py` - User.role filter query fix (CRITICAL)
2. `repositories/comment_repository.py` - SELECT projection fix
3. `schemas/comment.py` - creator_role→creator_roles
4. `routers/auth.py` UserInfo schema - role→roles
5. `types/project.ts` - CommentResponse.creator_roles
6. `CommentDialog.tsx` - currentUserRoles prop
7. `GridContextMenu.tsx` - currentUserRoles prop
8. `ConditionGrid.tsx` - currentUserRoles prop
9. `ConditionEditorPage.tsx` - roles prop passing
10. `CommentThread.tsx` - creator_roles badge display
