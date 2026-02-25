# PCM Entry Points Catalog

Comprehensive reference of all API endpoints and frontend routes with request/response signatures.

## Backend API Endpoints (18 Routers)

### Authentication Router

**File:** `backend/app/routers/auth.py`

#### POST /api/auth/login

**Purpose:** User login with credentials
**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "user": {
    "id": "uuid",
    "username": "string",
    "display_name": "string",
    "role": "user|admin",
    "is_active": true
  }
}
```

**Error Responses:**
- 401 Unauthorized: Invalid credentials
- 422 Unprocessable Entity: Missing required fields

**Dependencies:** AuthService, User model
**Used By:** LoginPage
**Side Effects:** None

#### POST /api/auth/logout

**Purpose:** Invalidate current token
**Headers:** `Authorization: Bearer {access_token}`
**Response (204 No Content):** Empty body

**Dependencies:** get_current_user dependency
**Side Effects:** Token blacklist (optional)

#### POST /api/auth/refresh

**Purpose:** Refresh expired access token
**Request Body:**
```json
{
  "refresh_token": "string"
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

**Error Responses:**
- 401 Unauthorized: Invalid or expired refresh token

#### GET /api/auth/me

**Purpose:** Get current authenticated user profile
**Headers:** `Authorization: Bearer {access_token}`
**Response (200 OK):**
```json
{
  "id": "uuid",
  "username": "string",
  "display_name": "string",
  "role": "user|admin",
  "is_active": true
}
```

**Dependencies:** get_current_user dependency
**Used By:** Header, navigation, role-based UI

---

### Project Router

**File:** `backend/app/routers/project.py`

#### GET /api/projects

**Purpose:** List projects with filtering and pagination
**Query Parameters:**
- `status` (optional): 'draft' | 'review' | 'approved' | 'archived'
- `user_id` (optional): Filter by user
- `product_id` (optional): Filter by product
- `skip` (optional): Pagination offset, default 0
- `limit` (optional): Page size, default 20

**Response (200 OK):**
```json
{
  "total": 42,
  "items": [
    {
      "id": "uuid",
      "product_id": "uuid",
      "product_name": "string",
      "status": "draft|review|approved|archived",
      "revision": 1,
      "created_at": "2024-01-15T10:30:00Z",
      "created_by": "username",
      "updated_at": "2024-01-15T14:45:00Z"
    }
  ],
  "page": 1,
  "pages": 3
}
```

**Dependencies:** ProjectService, get_current_user
**Filters:** User sees own projects + admin projects
**Caching:** 1 minute
**Sorting:** Default created_at DESC

#### POST /api/projects

**Purpose:** Create new project with backbone copy
**Headers:** `Authorization: Bearer {access_token}`
**Request Body:**
```json
{
  "product_id": "uuid",
  "main_backbone_id": "uuid",
  "description": "string (optional)"
}
```

**Response (201 Created):**
```json
{
  "id": "uuid",
  "product_id": "uuid",
  "status": "draft",
  "revision": 1,
  "main_backbone_id": "uuid",
  "created_at": "2024-01-15T10:30:00Z",
  "created_by": "username"
}
```

**Error Responses:**
- 403 Forbidden: User not authorized
- 404 Not Found: Product or backbone not found
- 409 Conflict: Product already has approved project

**Dependencies:** ProjectService, BackboneRepository
**Side Effects:** Creates ProjectLayers with copied conditions, logs change
**User Role:** user, admin

#### GET /api/projects/{project_id}

**Purpose:** Fetch single project with all related data
**Path Parameters:**
- `project_id` (required): UUID

**Response (200 OK):**
```json
{
  "id": "uuid",
  "product_id": "uuid",
  "product_name": "string",
  "status": "draft|review|approved|archived",
  "revision": 1,
  "parent_project_id": "uuid (optional)",
  "main_backbone_id": "uuid",
  "layers": [
    {
      "id": "uuid",
      "layer_id": "uuid",
      "layer_name": "string",
      "layer_number": 1,
      "backbone_product_id": "uuid",
      "conditions": { ... },
      "backbone_conditions": { ... }
    }
  ],
  "created_at": "2024-01-15T10:30:00Z",
  "created_by": "username"
}
```

**Error Responses:**
- 404 Not Found: Project not found
- 403 Forbidden: User not authorized to view

**Dependencies:** ProjectService
**Used By:** ConditionEditorPage, DashboardPage

#### PUT /api/projects/{project_id}

**Purpose:** Update project fields
**Path Parameters:**
- `project_id` (required): UUID

**Request Body:**
```json
{
  "description": "string (optional)"
}
```

**Response (200 OK):** Updated project object

**Error Responses:**
- 403 Forbidden: Cannot edit approved/archived projects
- 404 Not Found: Project not found
- 409 Conflict: Cannot change backbone after approval

**Dependencies:** ProjectService, ChangeLogService
**Side Effects:** Logs change type "manual"
**User Role:** Owner or admin

#### DELETE /api/projects/{project_id}

**Purpose:** Archive project (soft delete)
**Path Parameters:**
- `project_id` (required): UUID

**Response (204 No Content):** Empty body

**Error Responses:**
- 403 Forbidden: Cannot delete approved projects (must archive)
- 404 Not Found: Project not found

**Dependencies:** ProjectService
**Side Effects:** Sets status to "archived", logs change
**User Role:** Owner or admin

#### PUT /api/projects/{project_id}/status

**Purpose:** Transition project through lifecycle
**Path Parameters:**
- `project_id` (required): UUID

**Request Body:**
```json
{
  "new_status": "draft|review|approved|archived"
}
```

**Response (200 OK):**
```json
{
  "id": "uuid",
  "status": "new_status",
  "updated_at": "2024-01-15T15:00:00Z"
}
```

**Allowed Transitions:**
- draft → review (anyone)
- review → draft (anyone)
- review → approved (admin only)
- approved → archived (admin only)

**Error Responses:**
- 403 Forbidden: Invalid transition or user not authorized
- 409 Conflict: Cannot revert approved project

**Dependencies:** ProjectService, ChangeLogService
**Side Effects:** Logs status change, freezes conditions on approval
**User Role:** user for review, admin for approval

---

### Condition Router

**File:** `backend/app/routers/project_conditions.py`

#### GET /api/project-conditions/{project_id}/{layer_id}

**Purpose:** Fetch JSONB conditions for single layer
**Path Parameters:**
- `project_id` (required): UUID
- `layer_id` (required): UUID

**Response (200 OK):**
```json
{
  "project_id": "uuid",
  "layer_id": "uuid",
  "conditions": {
    "SP_PARAMETER_1": "value",
    "SC_PARAMETER_1": 123,
    "OVL_PARAMETER_1": true,
    "DEV_PARAMETER_1": "2024-01-15"
  },
  "backbone_conditions": { ... },
  "validation_errors": []
}
```

**Query Parameters:**
- `include_validation` (optional): Include validation rules, default true

**Error Responses:**
- 404 Not Found: Project or layer not found
- 403 Forbidden: User not authorized

**Dependencies:** ConditionService, ValidationService
**Caching:** 30 seconds (invalidated on edit)
**Used By:** ConditionEditorPage, GridCellEditor

#### PUT /api/project-conditions/{project_id}/{layer_id}

**Purpose:** Save JSONB condition changes with validation
**Path Parameters:**
- `project_id` (required): UUID
- `layer_id` (required): UUID

**Request Body:**
```json
{
  "conditions": {
    "SP_PARAMETER_1": "new_value",
    "SC_PARAMETER_1": 456
  },
  "change_type": "manual|recipe|import"
}
```

**Response (200 OK):**
```json
{
  "project_id": "uuid",
  "layer_id": "uuid",
  "conditions": { ... },
  "validation_errors": []
}
```

**Error Responses:**
- 400 Bad Request: Validation failed
- 403 Forbidden: Project is approved/archived
- 404 Not Found: Project or layer not found
- 409 Conflict: Concurrent edit detected

**Dependencies:** ConditionService, ValidationService, ChangeLogService
**Validation Applied:**
- Range validation (min/max)
- Required field checks
- Pattern validation (regex)
- Cross-layer consistency

**Side Effects:**
- Updates ProjectLayers.conditions (JSONB merge)
- Logs each change to ChangeLogs
- Invalidates condition cache

**User Role:** user, admin (approver only on approved)

#### GET /api/project-conditions/{project_id}/grid-data

**Purpose:** Fetch conditions flattened for AG Grid display
**Path Parameters:**
- `project_id` (required): UUID

**Response (200 OK):**
```json
{
  "columns": [
    {
      "field": "layer_name",
      "headerName": "Layer",
      "width": 100,
      "editable": false
    },
    {
      "field": "SP_PARAMETER_1",
      "headerName": "SP Parameter 1",
      "width": 120,
      "editable": true,
      "cellDataType": "text"
    }
  ],
  "rows": [
    {
      "layer_id": "uuid",
      "layer_name": "Photoresist",
      "SP_PARAMETER_1": "value",
      "SC_PARAMETER_1": 123
    }
  ],
  "validationRules": { ... }
}
```

**Response:** 300+ columns flattened from nested JSONB
**Caching:** 1 minute
**Used By:** ConditionGrid AG Grid configuration

---

### Layer Router

**File:** `backend/app/routers/project_layers.py`

#### POST /api/project-layers/{project_id}

**Purpose:** Add existing layer to project
**Path Parameters:**
- `project_id` (required): UUID

**Request Body:**
```json
{
  "layer_id": "uuid",
  "backbone_product_id": "uuid (optional)"
}
```

**Response (201 Created):**
```json
{
  "id": "uuid",
  "project_id": "uuid",
  "layer_id": "uuid",
  "layer_name": "string",
  "conditions": {},
  "backbone_conditions": {}
}
```

**Error Responses:**
- 403 Forbidden: Project is approved/archived
- 409 Conflict: Layer already exists in project

**Dependencies:** LayerService, BackboneRepository
**Side Effects:** Creates ProjectLayer record, copies backbone if specified

#### DELETE /api/project-layers/{project_id}/{layer_id}

**Purpose:** Remove layer from project
**Path Parameters:**
- `project_id` (required): UUID
- `layer_id` (required): UUID

**Response (204 No Content):** Empty body

**Error Responses:**
- 403 Forbidden: Project is approved/archived

**Dependencies:** LayerService
**Side Effects:** Deletes ProjectLayer record, logs change

#### PUT /api/project-layers/{project_id}/{layer_id}

**Purpose:** Replace backbone reference for layer
**Path Parameters:**
- `project_id` (required): UUID
- `layer_id` (required): UUID

**Request Body:**
```json
{
  "backbone_product_id": "uuid"
}
```

**Response (200 OK):** Updated layer with new backbone conditions

**Error Responses:**
- 403 Forbidden: Project is approved/archived

**Dependencies:** BackboneRepository
**Side Effects:** Copies backbone conditions, logs change

---

### Column Router

**File:** `backend/app/routers/columns.py`

#### GET /api/columns

**Purpose:** List all column definitions with categories
**Query Parameters:**
- `category` (optional): 'SP' | 'SC' | 'OVL' | 'DEV'
- `include_validations` (optional): Include validation rules, default false

**Response (200 OK):**
```json
{
  "columns": [
    {
      "id": "uuid",
      "column_name": "SP_PARAMETER_1",
      "display_name": "SP Parameter 1",
      "category": "SP",
      "data_type": "text|number|select|date",
      "select_options": ["Option1", "Option2"],
      "sort_order": 1
    }
  ],
  "categories": ["SP", "SC", "OVL", "DEV"]
}
```

**Caching:** 1 hour (rarely changes)
**Used By:** ConditionGrid column configuration, ColumnSelector

#### GET /api/columns/{category}

**Purpose:** List columns for specific category
**Path Parameters:**
- `category` (required): 'SP' | 'SC' | 'OVL' | 'DEV'

**Response (200 OK):**
```json
{
  "category": "SP",
  "columns": [ ... ]
}
```

#### GET /api/columns/{column_id}/validations

**Purpose:** Fetch validation rules for column
**Path Parameters:**
- `column_id` (required): UUID

**Response (200 OK):**
```json
{
  "column_id": "uuid",
  "column_name": "SP_PARAMETER_1",
  "validations": [
    {
      "id": "uuid",
      "rule_type": "range|required|conditional_required|pattern|cross_layer",
      "rule_config": {
        "min": 0,
        "max": 100
      }
    }
  ]
}
```

**Dependencies:** ValidationRepository
**Used By:** GridCellEditor, validation client-side

---

### Master Data Routers

**Files:** `products.py`, `lines.py`, `layers.py`

#### GET /api/products

**Purpose:** List products (used as backbone templates)
**Query Parameters:**
- `line_id` (optional): Filter by manufacturing line
- `skip` (optional): Pagination offset
- `limit` (optional): Page size

**Response (200 OK):**
```json
{
  "items": [
    {
      "id": "uuid",
      "product_name": "string",
      "description": "string",
      "line_id": "uuid",
      "layer_count": 12,
      "is_approved": true
    }
  ],
  "total": 15
}
```

#### GET /api/lines

**Purpose:** List manufacturing lines
**Response (200 OK):**
```json
{
  "items": [
    {
      "id": "uuid",
      "line_name": "Production Line A",
      "equipment_count": 8
    }
  ]
}
```

#### GET /api/layers

**Purpose:** List all manufacturing layers
**Response (200 OK):**
```json
{
  "items": [
    {
      "id": "uuid",
      "layer_name": "Photoresist",
      "step_seq": 1,
      "layer_number": 1
    }
  ]
}
```

---

### Comment Router

**File:** `backend/app/routers/comments.py`

#### POST /api/comments

**Purpose:** Create comment at project/layer/cell level
**Request Body:**
```json
{
  "project_id": "uuid",
  "layer_id": "uuid (optional)",
  "cell_identifier": "string (optional, e.g. SP_PARAMETER_1)",
  "content": "string"
}
```

**Response (201 Created):**
```json
{
  "id": "uuid",
  "project_id": "uuid",
  "layer_id": "uuid (null if project level)",
  "cell_identifier": "string (null if layer level)",
  "content": "string",
  "created_by": "username",
  "created_at": "2024-01-15T10:30:00Z"
}
```

**Dependencies:** CommentService, get_current_user
**Side Effects:** Logs comment creation

#### GET /api/comments/{project_id}

**Purpose:** List all comments for project
**Path Parameters:**
- `project_id` (required): UUID

**Query Parameters:**
- `level` (optional): 'project' | 'layer' | 'cell'
- `layer_id` (optional): Filter by layer

**Response (200 OK):**
```json
{
  "comments": [
    {
      "id": "uuid",
      "level": "project|layer|cell",
      "content": "string",
      "created_by": "username",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

#### PUT /api/comments/{comment_id}

**Purpose:** Update comment content
**Path Parameters:**
- `comment_id` (required): UUID

**Request Body:**
```json
{
  "content": "string"
}
```

**Response (200 OK):** Updated comment

#### DELETE /api/comments/{comment_id}

**Purpose:** Delete comment
**Response (204 No Content):** Empty body

---

### Recipe Import Router

**File:** `backend/app/routers/recipe.py`

#### POST /api/recipe/import

**Purpose:** Upload and parse recipe XML for diff
**Request Body:** Multipart form with recipe file
**Response (200 OK):**
```json
{
  "recipe_id": "uuid",
  "equipment_id": "uuid",
  "parsed_conditions": { ... }
}
```

#### GET /api/recipe/diff

**Purpose:** Preview differences between recipe and project
**Query Parameters:**
- `recipe_id` (required): Recipe UUID
- `project_id` (required): Project UUID
- `layer_id` (required): Layer UUID

**Response (200 OK):**
```json
{
  "differences": [
    {
      "parameter": "SP_PARAMETER_1",
      "old_value": "old",
      "new_value": "new",
      "conflict": false
    }
  ]
}
```

#### POST /api/recipe/apply

**Purpose:** Apply selected recipe changes to project
**Request Body:**
```json
{
  "recipe_id": "uuid",
  "project_id": "uuid",
  "layer_id": "uuid",
  "selected_changes": ["SP_PARAMETER_1", "SC_PARAMETER_2"]
}
```

**Response (200 OK):**
```json
{
  "applied_count": 2,
  "failed_count": 0
}
```

---

### Export Router

**File:** `backend/app/routers/export.py`

#### GET /api/export/preview

**Purpose:** Preview export format before generating file
**Query Parameters:**
- `project_id` (required): UUID
- `format_type` (required): 'TYPE_A' | 'TYPE_B' | 'TYPE_C'
- `system_id` (required): Export system UUID

**Response (200 OK):**
```json
{
  "preview": {
    "headers": ["Layer", "SP_PARAMETER_1", "SC_PARAMETER_1"],
    "rows": [
      ["Photoresist", "value1", 123],
      ["Development", "value2", 456]
    ],
    "format_description": "Horizontal layout"
  }
}
```

#### POST /api/export/excel

**Purpose:** Generate and download Excel export
**Request Body:**
```json
{
  "project_id": "uuid",
  "format_type": "TYPE_A|TYPE_B|TYPE_C",
  "system_id": "uuid"
}
```

**Response (200 OK):**
```json
{
  "job_id": "uuid",
  "file_url": "/api/export/download/uuid",
  "status": "completed|processing"
}
```

**File Output:** Excel file with conditions formatted per type

#### POST /api/export/zip

**Purpose:** Batch export multiple projects as ZIP
**Request Body:**
```json
{
  "project_ids": ["uuid1", "uuid2", "uuid3"],
  "format_type": "TYPE_A|TYPE_B|TYPE_C"
}
```

**Response (200 OK):**
```json
{
  "job_id": "uuid",
  "file_url": "/api/export/download/uuid"
}
```

#### GET /api/export/history

**Purpose:** Fetch export history for project
**Query Parameters:**
- `project_id` (required): UUID

**Response (200 OK):**
```json
{
  "exports": [
    {
      "id": "uuid",
      "format_type": "TYPE_A",
      "file_name": "project_1_A.xlsx",
      "created_at": "2024-01-15T10:30:00Z",
      "created_by": "username"
    }
  ]
}
```

#### GET /api/export/download/{job_id}

**Purpose:** Download generated export file
**Response:** Binary file (Excel or ZIP)

---

### Admin Router (Users)

**File:** `backend/app/routers/admin/users.py`

#### GET /api/admin/users

**Purpose:** List all users (admin only)
**Protected By:** require_admin
**Response (200 OK):**
```json
{
  "users": [
    {
      "id": "uuid",
      "username": "string",
      "display_name": "string",
      "role": "user|admin",
      "is_active": true,
      "project_count": 5
    }
  ]
}
```

#### POST /api/admin/users

**Purpose:** Create new user
**Protected By:** require_admin
**Request Body:**
```json
{
  "username": "string",
  "display_name": "string",
  "password": "string",
  "role": "user|admin"
}
```

**Response (201 Created):** Created user object

#### PUT /api/admin/users/{user_id}

**Purpose:** Update user role or status
**Protected By:** require_admin
**Request Body:**
```json
{
  "role": "user|admin",
  "is_active": true|false
}
```

**Response (200 OK):** Updated user object

#### DELETE /api/admin/users/{user_id}

**Purpose:** Deactivate user (soft delete)
**Protected By:** require_admin
**Response (204 No Content):** Empty body

---

### Dashboard Router

**File:** `backend/app/routers/dashboard.py`

#### GET /api/dashboard/stats

**Purpose:** Get overview statistics
**Response (200 OK):**
```json
{
  "project_counts": {
    "draft": 5,
    "review": 2,
    "approved": 12,
    "archived": 1
  },
  "recent_activity": [
    {
      "type": "project_created|status_changed|conditions_updated",
      "project_id": "uuid",
      "timestamp": "2024-01-15T10:30:00Z",
      "user": "username"
    }
  ],
  "user_counts": {
    "active": 8,
    "inactive": 2
  }
}
```

#### GET /api/dashboard/timeline

**Purpose:** Get recent activity timeline
**Query Parameters:**
- `limit` (optional): Number of events, default 20

**Response (200 OK):**
```json
{
  "events": [
    {
      "id": "uuid",
      "type": "project_created",
      "description": "Created project for Product A",
      "timestamp": "2024-01-15T10:30:00Z",
      "user": "username"
    }
  ]
}
```

---

## Frontend Routes (13 React Router)

**File:** `frontend/src/App.tsx`

### Public Routes

#### /login - LoginPage

**Purpose:** User authentication
**Protected:** No (redirects to /login if not authenticated)
**Components:** LoginForm, LoginLayout
**State Management:** useAuthStore.login()
**On Success:** Redirect to /

#### /* - NotFoundPage

**Purpose:** 404 error handling
**Shown:** When route doesn't match any defined route
**Components:** ErrorLayout, NotFoundMessage

---

### Protected Routes (Requires Authentication)

#### / - DashboardPage

**Purpose:** Overview and analytics
**Protected By:** useAuth hook (redirects to /login if not authenticated)
**Components:** Layout, StatsPanel, TimelinePanel, QuickLinks
**Hooks:** useDashboard, useAuth
**Data:** Dashboard stats from GET /api/dashboard/stats

#### /projects - ProjectListPage

**Purpose:** Browse and manage projects
**Protected By:** useAuth hook
**Components:** Layout, ProjectTable, FilterPanel, CreateProjectButton
**Hooks:** useProjects, useProjectStore, useFilters
**Data:**
- Project list from GET /api/projects
- Filter options
- Pagination controls

**Features:**
- Filter by status (draft, review, approved, archived)
- Filter by product, user, date range
- Sort by any column
- Pagination with configurable page size
- Create new project
- Quick actions (edit, delete, approve)

#### /projects/:projectId/edit - ConditionEditorPage

**Purpose:** Edit project layer conditions in grid
**Protected By:** useAuth hook (redirects if user not owner)
**Components:**
- Layout
- ConditionGrid (AG Grid with 300+ columns)
- LayerPanel (layer selector)
- CommentPanel
- RecipeImportPanel
- ExportPanel

**Hooks:** useProject, useConditions, useGridCellEdit, useValidation
**Data:**
- Project details from GET /api/projects/{projectId}
- Conditions from GET /api/project-conditions/{projectId}/{layerId}
- Grid data from GET /api/project-conditions/{projectId}/grid-data
- Column definitions from GET /api/columns

**Features:**
- AG Grid with 300+ columns grouped by category (SP, SC, OVL, DEV)
- Real-time cell editing with validation
- Change tracking (visual indicators for modified cells)
- Layer navigation sidebar
- Comments panel (project/layer/cell level)
- Recipe import with diff preview
- Export preview and generation

**Read-Only When:** Project status is "approved" or "archived"

---

### Admin Routes (Requires Admin Role)

#### /admin/users - UserManagementPage

**Purpose:** Manage users and roles
**Protected By:** useAuth hook + require_admin
**Components:** Layout, UserTable, CreateUserForm, RoleSelector
**Data:** Users from GET /api/admin/users

#### /admin/master-data - MasterDataPage

**Purpose:** Manage products, lines, layers
**Protected By:** require_admin
**Components:** Layout, ProductTable, LineTable, LayerTable
**Data:** Products, lines, layers from master data APIs

#### /admin/enum-options - EnumManagementPage

**Purpose:** Manage select options for columns
**Protected By:** require_admin
**Components:** Layout, ColumnSelector, OptionEditor

#### /admin/xml-mappings - XmlMappingsPage

**Purpose:** Configure recipe XML parsing
**Protected By:** require_admin
**Components:** Layout, EquipmentSelector, XMLMappingEditor

#### /admin/validations - ValidationRulesPage

**Purpose:** Configure validation rules
**Protected By:** require_admin
**Components:** Layout, ColumnSelector, ValidationRuleEditor

#### /admin/data-sources - ExportDataSourcesPage

**Purpose:** Configure external data sources
**Protected By:** require_admin
**Components:** Layout, DataSourceTable, DataSourceForm

#### /admin/export-systems - ExportSystemsPage

**Purpose:** Configure export systems and formats
**Protected By:** require_admin
**Components:** Layout, ExportSystemTable, ExportSystemForm, ColumnMappingEditor

#### /admin/audit-logs - AuditLogPage

**Purpose:** View system audit trail
**Protected By:** require_admin
**Components:** Layout, LogTable, FilterPanel
**Data:** Audit logs from GET /api/audit-logs

---

## Entry Point Statistics

**Backend:**
- Total Endpoints: 45+ across 18 routers
- Authenticated: 40+ (require Authorization header)
- Public: 5 (login, register, health check)
- Protected Admin: 15+ (require admin role)

**Frontend:**
- Total Routes: 13
- Public: 2 (login, 404)
- Protected: 1 (dashboard)
- Admin: 8 (various admin pages)
- Redirects: All public routes redirect to /login if not authenticated

**Data Models Exposed:**
- User: 3 endpoints
- Project: 7 endpoints
- Condition: 3 endpoints
- Comment: 4 endpoints
- Export: 5 endpoints
- Master Data: 3 endpoints
- Admin: 8+ endpoints
- Dashboard: 2 endpoints

**Total Request/Response Pairs:** 45+ backend, 13 frontend routes

## API Response Status Codes Used

- 200 OK - Successful GET/PUT
- 201 Created - Successful POST
- 204 No Content - Successful DELETE
- 400 Bad Request - Validation errors
- 401 Unauthorized - Missing or invalid token
- 403 Forbidden - User not authorized (role or ownership)
- 404 Not Found - Resource not found
- 409 Conflict - State conflict (e.g., cannot edit approved project)
- 422 Unprocessable Entity - Request body validation failed
- 500 Internal Server Error - Server error
- 503 Service Unavailable - Database or external service down
