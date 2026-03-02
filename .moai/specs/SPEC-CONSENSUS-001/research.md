# SPEC-CONSENSUS-001: Research Document

## Codebase Analysis Summary

### 1. Current User Model

**File:** `backend/app/models/user.py`

- Fields: id, username, display_name, roles (ARRAY), is_active, password_hash, email, created_at, updated_at
- No `line_id` field exists - users are NOT associated with any production line
- Multi-role support via PostgreSQL ARRAY(String)
- `has_role()` method for permission checking

### 2. Current Line Model

**File:** `backend/app/models/line.py`

- Fields: id, line_code (unique), line_name, created_at
- Simple master data model
- Referenced by: Products (line_id), Equipments (line_id), DeviceMasters (line_id), Projects (line_id)
- NOT referenced by: Users

### 3. Existing Approval Pattern (Project Workflow)

**State Machine:** `backend/app/services/project_status_service.py`

- States: draft -> review -> approved/rejected -> archived
- Transitions validated via VALID_STATUS_TRANSITIONS dict
- Logs via ProjectStatusLog model
- Role checks: reviewer/admin can approve/reject
- ReviewComment model for feedback with resolution tracking

**Key Pattern:**
```python
async def update_project_status(db, project_id, new_status, current_user, comment=None):
    # 1. Validate transition is allowed
    # 2. Check role permissions
    # 3. Run validation gates (e.g., error_count == 0)
    # 4. Create ProjectStatusLog entry
    # 5. Update project status
```

### 4. Column/Validation Management

**Current flow (NO approval):**
- Developer directly modifies via admin endpoints
- `PUT /api/admin/columns/{column_id}/validations` - replace validation rules
- `POST /api/admin/columns/validations/bulk` - bulk upload from Excel
- Protected by `require_system_write` (developer role only)

**Models:**
- ColumnDefinition: column_name, display_name, category_id, data_type, select_options, unit, sort_order, is_required
- ColumnValidation: column_id, rule_type, rule_config, error_message, is_active
- ColumnCategory: category_code (SP/SC/OVL/DEV), category_name, sort_order

### 5. Auth Dependencies

**File:** `backend/app/dependencies/auth.py`

- `require_active_user` - basic auth check
- `require_reviewer` - reviewer or admin
- `require_admin` - admin only
- `require_admin_or_developer` - admin or developer (read access)
- `require_ops_write` - admin only (operations write)
- `require_system_write` - developer only (system config write)

### 6. Migration Pattern

- Sequential numbering: 001 through 020
- Next migration: 021
- Pattern: create_table + create_index + FK constraints
- Proper upgrade/downgrade functions

### 7. Schema/Router Patterns

- Pydantic v2 with `model_config = {"from_attributes": True}`
- Router prefix pattern: `/api/{domain}` or `/api/admin/{domain}`
- Auth dependency injection via `Depends()`
- Service layer handles business logic
- Repository layer handles complex queries with JOINs

### 8. Reference Implementation: Announcement System

The announcement system (most recent feature) provides a good reference:
- Model: Announcement + AnnouncementRead (read tracking)
- Service: CRUD operations, read status per user
- Router: User API + Admin API split
- Schema: Separate request/response models
- Migration: 020 with proper indexes and FKs

### 9. Key Design Decisions

1. **User.line_id is 1:1** - simple FK on users table, not a junction table
2. **ConfigChangeRequest is global** - not per-line, but requires ALL lines to approve
3. **Voting is per-line** - each line's reviewer/admin users must all approve
4. **Managers describe changes** - natural language requests, not technical specifications
5. **Developer implements** - after consensus, developer does the actual work
6. **Status: pending -> voting -> approved -> in_progress -> completed / rejected**
