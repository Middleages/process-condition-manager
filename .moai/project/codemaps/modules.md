# PCM Module Catalog

Comprehensive reference of all PCM modules with responsibilities, key file paths, and interdependencies.

## Backend Modules

### Core Infrastructure Modules

#### Authentication & Security

**Module:** `app.dependencies.auth`
**Location:** `backend/app/dependencies/auth.py`
**Responsibility:** JWT authentication and authorization enforcement
**Key Functions:**
- `get_current_user()` - Extract and validate JWT, return User model (high fan-in: 10+ routers)
- `require_admin()` - Enforce admin role requirement (high fan-in: 8+ routers)
- `create_access_token()` - Generate JWT with expiration
- `verify_token()` - Validate token signature and expiration

**Dependencies:** `app.models.User`, `app.database`, python-jose library
**Used By:** All 18 routers for user identification and authorization
**Notes:** Tokens include user_id and username in payload, configurable expiration time

#### Database Connection

**Module:** `app.database`
**Location:** `backend/app/database.py`
**Responsibility:** Async database session management and connection pooling
**Key Classes:**
- `get_db()` - Async generator yielding SQLAlchemy AsyncSession (high fan-in: 18+ routers)
- `engine` - AsyncEngine configured for PostgreSQL asyncpg driver
- `SessionLocal` - AsyncSessionMaker for session creation

**Dependencies:** SQLAlchemy 2.0 async, asyncpg driver
**Used By:** All repository and service layers
**Configuration:** DATABASE_URL from environment (postgresql+asyncpg://user:pass@host/db)
**Notes:** Connection pooling with configurable pool size, prepared statements enabled

#### Configuration Management

**Module:** `app.config`
**Location:** `backend/app/config.py`
**Responsibility:** Centralized application configuration using Pydantic Settings
**Key Settings:**
- `database_url` - PostgreSQL connection string
- `jwt_secret_key` - JWT signing secret
- `jwt_algorithm` - Algorithm (HS256)
- `access_token_expire_minutes` - Token TTL (default 30 min)
- `debug` - Debug mode toggle

**Pattern:** Pydantic BaseSettings with environment variable override
**Used By:** All modules requiring configuration
**Notes:** Environment-specific configuration via .env files

### Model Layer

**Module:** `app.models`
**Location:** `backend/app/models/` (10 SQLAlchemy models)

#### User Model

**File:** `backend/app/models/user.py`
**Entities:** Users table
**Fields:** id (pk), username (unique), display_name, role (enum: user/admin), is_active
**Relationships:** One-to-many with Projects (user_id), Comments (user_id), ChangeLogs (user_id)
**High Fan-In:** 14+ imports across routers and services
**Notes:** Password hashing via Pydantic validator, no password stored in model

#### Project Model

**File:** `backend/app/models/project.py`
**Entities:** Projects table
**Fields:** id (pk), product_id (fk), main_backbone_id (fk to Products), status (enum: draft/review/approved/archived), revision (int), parent_project_id (fk for versioning)
**Relationships:** One-to-many with ProjectLayers, Comments, ChangeLogs
**High Fan-In:** 8+ imports in services and routers
**Notes:** Revision tracking via parent_project_id for version history

#### Product Model

**File:** `backend/app/models/product.py`
**Entities:** Products table (used as backbone template)
**Fields:** id (pk), product_name, description, line_id (fk)
**Relationships:** One-to-many with ProductLayers, Projects (backbone reference)
**Notes:** Master data, linked to manufacturing line

#### Layer Model

**File:** `backend/app/models/layer.py`
**Entities:** Layers table
**Fields:** id (pk), layer_name, step_seq (sequence), layer_number, sort_order
**Relationships:** One-to-many with ProductLayers, ProjectLayers
**Notes:** Represents manufacturing process layers (e.g., photoresist, development)

#### ProductLayer Model

**File:** `backend/app/models/product_layer.py`
**Entities:** ProductLayers table (master condition template)
**Fields:** id (pk), product_id (fk), layer_id (fk), conditions (JSONB ~300 params)
**Relationships:** Referenced by ProjectLayers.backbone_conditions
**Notes:** JSONB conditions structure enables flexible parameter storage

#### ProjectLayer Model

**File:** `backend/app/models/project_layer.py`
**Entities:** ProjectLayers table
**Fields:** id (pk), project_id (fk), layer_id (fk), backbone_product_id (fk), conditions (JSONB), backbone_conditions (JSONB)
**Relationships:** Many-to-one with Projects, Layers, Products
**Notes:** Stores both project-modified conditions and original backbone for diffing

#### ColumnDefinition Model

**File:** `backend/app/models/column_definition.py`
**Entities:** ColumnDefinitions table
**Fields:** id (pk), column_name, display_name, category_id (SP/SC/OVL/DEV), data_type (string/number/select), select_options (JSONB for enums)
**Relationships:** One-to-many with ColumnValidations
**Notes:** Defines parameter metadata and display information

#### ColumnValidation Model

**File:** `backend/app/models/column_validation.py`
**Entities:** ColumnValidations table
**Fields:** id (pk), column_id (fk), rule_type (range/required/conditional_required/cross_layer/pattern), rule_config (JSONB)
**Notes:** JSONB rule_config contains type-specific validation parameters

#### ChangeLog Model

**File:** `backend/app/models/changelog.py`
**Entities:** ChangeLogs table (audit trail)
**Fields:** id (pk), project_id (fk), field_name, old_value, new_value, change_type (manual/backbone/recipe/status), created_at, created_by
**Notes:** Immutable audit log for compliance and debugging

#### Comment Model

**File:** `backend/app/models/comment.py`
**Entities:** Comments table
**Fields:** id (pk), project_id (fk), layer_id (fk, nullable), cell_identifier (nullable), content, created_by (fk to Users)
**Notes:** Supports 3-level comments (project/layer/cell) via optional foreign keys

### Data Transfer Objects (Schemas)

**Module:** `app.schemas`
**Location:** `backend/app/schemas/` (10+ Pydantic models)
**Responsibility:** Request/response validation and serialization
**Key Schemas:**
- `UserSchema` - User representation (id, username, display_name, role)
- `ProjectSchema` - Project representation with status and revision
- `ProjectLayerSchema` - Layer conditions with validation rules
- `ColumnDefinitionSchema` - Parameter definition with metadata
- `ChangeLogSchema` - Change record with type and timestamp
- `CommentSchema` - Comment with multi-level support
- `ExportSchema` - Export job status and file reference

**Pattern:** Pydantic models with validation, used in all API endpoints
**Used By:** All routers for request validation and response serialization

### Repository Layer

**Module:** `app.repositories`
**Location:** `backend/app/repositories/` (4 repositories)
**Responsibility:** Data access abstraction with query building and result mapping

#### ProjectRepository

**File:** `backend/app/repositories/project_repository.py`
**Methods:**
- `create(project_data)` - Insert new project
- `get(project_id)` - Fetch by id with relationships
- `get_by_status(status)` - Filter by lifecycle status
- `update(project_id, data)` - Update fields
- `get_with_layers(project_id)` - Eager load layers and conditions

**Used By:** ProjectService
**Notes:** Handles complex queries like fetching project with all layer conditions for UI grid

#### BackboneRepository

**File:** `backend/app/repositories/backbone_repository.py`
**Methods:**
- `get_backbone(product_id)` - Fetch ProductLayers as template
- `copy_backbone(source_product_id, target_project_id)` - Clone conditions to new project
- `get_backbone_diff(project_id)` - Compare project conditions to original backbone

**Used By:** ProjectService, ProjectLayerService (high fan-in: 4+ services)
**Key Logic:** JSONB comparison for diff detection
**Notes:** Critical for maintaining project versioning

#### ConditionRepository

**File:** `backend/app/repositories/condition_repository.py`
**Methods:**
- `get_conditions(project_id, layer_id)` - Fetch JSONB conditions object
- `update_conditions(project_id, layer_id, data)` - Merge JSONB changes
- `validate_conditions(conditions, column_defs)` - Apply validation rules

**Used By:** ConditionService
**Notes:** JSONB merge operations preserve existing keys while updating specified ones

#### ValidationRepository

**File:** `backend/app/repositories/validation_repository.py`
**Methods:**
- `get_rules(column_id)` - Fetch validation rules
- `validate_value(column_id, value)` - Check against all rules for column
- `validate_cross_layer(project_id, rules)` - Check layer interdependencies

**Used By:** ValidationService
**Notes:** Supports range, regex, conditional, and cross-layer validation types

### Service Layer

**Module:** `app.services`
**Location:** `backend/app/services/` (23 service classes)
**Responsibility:** Business logic and domain model operations

#### ProjectService

**File:** `backend/app/services/project_service.py`
**Methods:**
- `create_project(product_id)` - Create with backbone copy
- `update_status(project_id, new_status)` - Handle lifecycle transitions
- `fork_project(project_id)` - Create revision (sets parent_project_id)
- `get_project_with_grid_data()` - Format for AG Grid (300+ columns)

**Dependencies:** ProjectRepository, BackboneRepository, ChangeLogService
**Used By:** ProjectRouter (high fan-in: 3+ routers)
**Notes:** Core business logic, handles backbone copying and revision management

#### ConditionService

**File:** `backend/app/services/condition_service.py`
**Methods:**
- `save_conditions(project_id, layer_id, values)` - Persist JSONB changes
- `get_grid_conditions()` - Format conditions for AG Grid display
- `apply_recipe_diff(project_id, recipe_xml)` - Import and merge recipe

**Dependencies:** ConditionRepository, ValidationService
**Used By:** ConditionRouter
**Notes:** Handles JSONB merge, validation, and recipe integration

#### ValidationService

**File:** `backend/app/services/validation_service.py`
**Methods:**
- `validate_condition(column_id, value)` - Single field validation
- `validate_layer(layer_id, conditions)` - All fields in layer
- `validate_cross_layer(project_id)` - Cross-layer consistency

**Dependencies:** ValidationRepository, ColumnDefinitionRepository
**Used By:** ConditionService
**Notes:** Applies all validation types (range, required, conditional, pattern)

#### CommentService

**File:** `backend/app/services/comment_service.py`
**Methods:**
- `create_comment(project_id, layer_id, cell_id, content)` - Add at any level
- `get_comments(project_id)` - Fetch with level filtering
- `resolve_comment(comment_id)` - Mark as addressed

**Used By:** CommentRouter
**Notes:** Supports 3-level commenting (project/layer/cell)

#### ChangeLogService

**File:** `backend/app/services/changelog_service.py`
**Methods:**
- `log_change(project_id, field_name, old_value, new_value, change_type)` - Immutable audit
- `get_history(project_id)` - Fetch change trail
- `get_since(project_id, timestamp)` - Changes after timestamp

**Used By:** ProjectService, ConditionService (automatic logging on all changes)
**Notes:** Immutable append-only log, never updated or deleted

#### ExportService

**File:** `backend/app/services/export_service.py`
**Methods:**
- `preview_export(project_id, format_type)` - Show preview before export
- `export_excel(project_id, system_id)` - Generate TYPE_A/B/C Excel
- `export_zip(project_ids)` - Batch zip multiple projects
- `get_export_history(project_id)` - Fetch export records

**Dependencies:** ExportRepository, ExportColumnMappingRepository
**Used By:** ExportRouter
**Notes:** Supports 3 export formats with configurable mappings per system

#### EquipmentService

**File:** `backend/app/services/equipment_service.py`
**Methods:**
- `assign_equipment(layer_id, equipment_id)` - Link equipment to layer
- `get_equipment(layer_id)` - Fetch assigned equipment
- `get_recipe_template(equipment_id)` - Get recipe XML schema

**Used By:** EquipmentRouter
**Notes:** Equipment master data and recipe mapping

### Router Layer (API Endpoints)

**Module:** `app.routers`
**Location:** `backend/app/routers/` (18 routers)
**Responsibility:** HTTP endpoint definition and request/response mapping

#### Authentication Router

**File:** `backend/app/routers/auth.py`
**Endpoints:**
- `POST /api/auth/login` - Login with username/password
- `POST /api/auth/logout` - Invalidate token
- `POST /api/auth/refresh` - Refresh expired token
- `GET /api/auth/me` - Get current user profile

**Pattern:** FastAPI APIRouter with FastAPI dependency injection
**Status Codes:** 200 success, 401 unauthorized, 422 validation error
**Notes:** JWT tokens returned in response body for SPA consumption

#### Project Router

**File:** `backend/app/routers/project.py`
**Endpoints:**
- `GET /api/projects` - List projects with filters
- `POST /api/projects` - Create new project
- `GET /api/projects/{id}` - Fetch single project
- `PUT /api/projects/{id}` - Update project fields
- `DELETE /api/projects/{id}` - Archive project
- `PUT /api/projects/{id}/status` - Transition lifecycle

**Dependencies:** ProjectService, ChangeLogService
**Protected By:** `require_admin` for create/delete/status-change
**Notes:** Returns grid-formatted data for AG Grid frontend

#### Condition Router

**File:** `backend/app/routers/project_conditions.py`
**Endpoints:**
- `GET /api/project-conditions/{project_id}/{layer_id}` - Fetch JSONB conditions
- `PUT /api/project-conditions/{project_id}/{layer_id}` - Save JSONB changes
- `GET /api/project-conditions/{project_id}/grid-data` - Format for grid

**Dependencies:** ConditionService, ValidationService
**Validation:** Schema validation via ColumnDefinitions
**Notes:** Grid endpoint returns flattened view of nested JSONB

#### Layer Router

**File:** `backend/app/routers/project_layers.py`
**Endpoints:**
- `POST /api/project-layers/{project_id}` - Add layer to project
- `DELETE /api/project-layers/{project_id}/{layer_id}` - Remove layer
- `PUT /api/project-layers/{project_id}/{layer_id}` - Replace backbone reference

**Dependencies:** LayerService, ProjectLayerRepository
**Notes:** Backbone can be switched to different product

#### Column Router

**File:** `backend/app/routers/columns.py`
**Endpoints:**
- `GET /api/columns` - List all column definitions with categories
- `GET /api/columns/{category}` - Filter by category (SP, SC, OVL, DEV)
- `GET /api/columns/{id}/validations` - Fetch validation rules

**Used By:** Frontend for grid column configuration
**Cached:** Yes, definitions rarely change
**Notes:** Drives AG Grid column configuration on frontend

#### Master Data Routers

**Files:** `backend/app/routers/products.py`, `layers.py`, `lines.py`
**Responsibility:** CRUD for Products, Layers, Lines (manufacturing infrastructure)
**Protected By:** `require_admin` for mutations
**Notes:** Reference data used throughout the system

#### Comment Router

**File:** `backend/app/routers/comments.py`
**Endpoints:**
- `POST /api/comments` - Create comment (project/layer/cell level)
- `GET /api/comments/{project_id}` - List comments with level
- `PUT /api/comments/{id}` - Update comment
- `DELETE /api/comments/{id}` - Delete comment

**Dependencies:** CommentService
**Notes:** Comment data includes optional layer_id and cell_identifier

#### Recipe Import Router

**File:** `backend/app/routers/recipe.py`
**Endpoints:**
- `POST /api/recipe/import` - Upload and parse recipe XML
- `GET /api/recipe/diff` - Show differences to current conditions
- `POST /api/recipe/apply` - Apply selected changes

**Dependencies:** RecipeService, ConditionService, ComparisonUtility
**Validation:** XML schema validation
**Notes:** Diff algorithm in app.utils.comparison

#### Export Router

**File:** `backend/app/routers/export.py`
**Endpoints:**
- `GET /api/export/preview` - Preview before export
- `POST /api/export/excel` - Generate Excel (TYPE_A/B/C)
- `POST /api/export/zip` - Batch zip multiple projects
- `GET /api/export/history` - Fetch export records
- `GET /api/export/download/{job_id}` - Download file

**Dependencies:** ExportService, ExportHistoryRepository
**File Output:** Temporary files in /tmp/exports
**Notes:** Async background jobs for large exports

#### User Management Router (Admin)

**File:** `backend/app/routers/admin/users.py`
**Endpoints:**
- `GET /api/admin/users` - List users (admin only)
- `POST /api/admin/users` - Create user
- `PUT /api/admin/users/{id}` - Update role/status
- `DELETE /api/admin/users/{id}` - Deactivate user

**Protected By:** `require_admin`
**Notes:** RBAC enforcement at endpoint level

#### Dashboard Router

**File:** `backend/app/routers/dashboard.py`
**Endpoints:**
- `GET /api/dashboard/stats` - Count by status, user activity
- `GET /api/dashboard/timeline` - Recent activity feed

**Cached:** Yes, aggregated data
**Notes:** Read-heavy, optimized queries

### Utility Modules

#### Comparison Utility

**File:** `backend/app/utils/comparison.py`
**Functions:**
- `compare_dicts(dict1, dict2)` - Deep diff algorithm (high fan-in: 4+ uses)
- `generate_diff_report(original, current, updated)` - Structured diff for recipe import
- `merge_dicts(base, updates)` - JSONB merge logic

**Used By:** BackboneRepository, ConditionService, RecipeService
**Notes:** Used for backbone diffing and recipe comparison

#### Excel Export Utility

**File:** `backend/app/utils/excel_export.py`
**Functions:**
- `format_conditions_for_export(conditions, format_type)` - Layout transformation
- `write_excel_file(data, output_path)` - File generation using openpyxl

**Used By:** ExportService
**Notes:** Supports TYPE_A (horizontal), TYPE_B (equipment grouped), TYPE_C (transposed)

#### XML Processing Utility

**File:** `backend/app/utils/xml_processing.py`
**Functions:**
- `parse_recipe_xml(xml_string)` - XML to dict conversion using lxml
- `validate_recipe_schema(xml_element)` - Schema validation

**Used By:** RecipeService
**Notes:** Handles equipment-specific recipe format

### Seed Data

**File:** `backend/app/seed/init_db.py`
**Responsibility:** Initial database population for development
**Data Seeded:**
- Default users (admin, user)
- Sample products and layers
- Column definitions and validations
- Sample projects with conditions

**Usage:** Called by docker-compose or manual CLI
**Notes:** Idempotent, safe to run multiple times

### Testing

**Module:** `backend/tests`
**Location:** `backend/tests/` (25 test files, 380/380 passing)
**Coverage:** 85%+ across all layers
**Fixtures:** Shared pytest fixtures for database, auth, API client
**Pattern:** AsyncClient from Starlette for ASGI testing
**Database:** SQLite in-memory for isolation
**Notes:** Tests use dependency injection to override real database with test database

---

## Frontend Modules

### Core Application Structure

**Module:** `src/`
**Location:** `frontend/src/`
**Architecture:** React 18 with TypeScript, component-based with hooks, Zustand stores for state

#### Entry Point

**File:** `frontend/src/main.tsx`
**Responsibility:** React app initialization and mount
**Imports:** App component, global styles
**Notes:** Vite entry point, handles client-side rendering

#### Router Configuration

**File:** `frontend/src/App.tsx`
**Responsibility:** React Router setup with 13 protected and public routes
**Routes:**
- `GET /login` - LoginPage (public)
- `GET /` - DashboardPage (protected)
- `GET /projects` - ProjectListPage (protected)
- `GET /projects/:projectId/edit` - ConditionEditorPage (protected)
- `GET /admin/users` - UserManagementPage (admin)
- `GET /admin/master-data` - MasterDataPage (admin)
- `GET /admin/enum-options` - EnumManagementPage (admin)
- `GET /admin/xml-mappings` - XmlMappingsPage (admin)
- `GET /admin/validations` - ValidationRulesPage (admin)
- `GET /admin/data-sources` - ExportDataSourcesPage (admin)
- `GET /admin/export-systems` - ExportSystemsPage (admin)
- `GET /admin/audit-logs` - AuditLogPage (admin)
- `GET /*` - NotFoundPage (fallback)

**Protected By:** useAuth hook checking isAuthenticated and role
**Notes:** Routes use lazy loading for code splitting

### State Management

**Module:** `src/stores`
**Location:** `frontend/src/stores/` (3 Zustand stores)

#### Authentication Store

**File:** `frontend/src/stores/useAuthStore.ts`
**State:**
- `user` - Current User object (id, username, display_name, role)
- `token` - JWT access token
- `refreshToken` - JWT refresh token
- `isAuthenticated` - Boolean flag
- `isAdmin` - Computed from user.role

**Actions:**
- `login(username, password)` - Call /api/auth/login
- `logout()` - Clear tokens and call /api/auth/logout
- `refreshAccessToken()` - Call /api/auth/refresh
- `setUser(user)` - Update user profile

**High Fan-In:** 20+ components
**Persistence:** Tokens stored in localStorage, auto-logout on expiration
**Notes:** Observable state, components re-render on token changes

#### Toast Store

**File:** `frontend/src/stores/useToastStore.ts`
**State:**
- `toasts` - Array of {id, message, type, duration}
- `type` - 'success', 'error', 'warning', 'info'

**Actions:**
- `addToast(message, type, duration)` - Add notification
- `removeToast(id)` - Remove specific toast
- `clearAll()` - Clear all notifications

**High Fan-In:** 15+ components
**Notes:** Auto-dismiss after duration, dismissible by user

#### Project Store

**File:** `frontend/src/stores/useProjectStore.ts`
**State:**
- `projects` - Array of Project objects
- `selectedProject` - Currently editing project
- `filters` - Status, user, date filters
- `sortBy` - Column name and direction

**Actions:**
- `setProjects(projects)` - Update list
- `selectProject(project)` - Set editing target
- `setFilters(filters)` - Update filter criteria

**Used By:** ProjectListPage, ConditionEditorPage
**Notes:** Derived from server state, not primary source of truth

### API Client

**Module:** `src/api`
**Location:** `frontend/src/api/` (19 API modules)
**Responsibility:** Axios client configuration and API endpoint bindings

#### HTTP Client Configuration

**File:** `frontend/src/api/client.ts`
**Configuration:**
- Base URL: `${window.location.origin}/api`
- Request interceptor: Attach JWT token from useAuthStore
- Response interceptor: Handle 401, 403, 5xx errors
- Timeout: 30 seconds

**High Fan-In:** 19+ API modules
**Error Handling:** Global error handler triggers toast notifications
**CORS:** Configured by Nginx reverse proxy
**Notes:** Axios instance shared across all API modules

#### API Modules

**Project API** (`frontend/src/api/projects.ts`)
- `getProjects(filters)` - List with pagination
- `createProject(productId)` - Create new
- `getProject(id)` - Single fetch
- `updateProject(id, data)` - Update fields
- `deleteProject(id)` - Archive
- `getProjectGridData(id)` - Grid-formatted conditions

**Condition API** (`frontend/src/api/conditions.ts`)
- `getConditions(projectId, layerId)` - Fetch JSONB
- `updateConditions(projectId, layerId, data)` - Save changes
- `validateCondition(columnId, value)` - Real-time validation

**Recipe API** (`frontend/src/api/recipe.ts`)
- `importRecipe(projectId, recipeXml)` - Upload XML
- `getRecipeDiff(projectId)` - Preview changes
- `applyRecipeDiff(projectId, selectedChanges)` - Apply selective

**Export API** (`frontend/src/api/export.ts`)
- `previewExport(projectId, formatType)` - Show preview
- `exportExcel(projectId, systemId)` - Generate file
- `exportZip(projectIds)` - Batch zip
- `downloadExport(jobId)` - Download file
- `getExportHistory(projectId)` - Fetch records

**Comment API** (`frontend/src/api/comments.ts`)
- `createComment(projectId, layerId, cellId, content)` - Add at level
- `getComments(projectId)` - List with level
- `updateComment(id, content)` - Edit comment
- `deleteComment(id)` - Remove comment

**User API** (`frontend/src/api/users.ts`)
- `login(username, password)` - Login
- `logout()` - Logout
- `refreshToken()` - Token refresh
- `getCurrentUser()` - User profile

**Column API** (`frontend/src/api/columns.ts`)
- `getColumns()` - All definitions
- `getColumnsByCategory(category)` - Filter (SP, SC, OVL, DEV)
- `getValidations(columnId)` - Validation rules

**Additional APIs:** admin, dashboard, equipment, master data (products, lines, layers), validation
**Pattern:** Axios client instance with request/response transformation
**Error Handling:** Centralized in client.ts interceptors

### Hooks

**Module:** `src/hooks`
**Location:** `frontend/src/hooks/` (30+ custom hooks)
**Responsibility:** Encapsulate component logic and state management

#### Authentication Hooks

**`useAuth` Hook** (`frontend/src/hooks/useAuth.ts`)
- **State Access:** user, token, isAuthenticated, isAdmin from useAuthStore
- **Pattern:** Custom hook wrapping Zustand store
- **Used By:** Protected components for access control
- **High Fan-In:** 20+ components

**`useLoginForm` Hook** (`frontend/src/hooks/useLoginForm.ts`)
- **Responsibility:** Login form state and validation
- **State:** username, password, error, loading
- **Functions:** handleChange, handleSubmit, validateForm

#### Data Fetching Hooks

**`useProjects` Hook** (`frontend/src/hooks/useProjects.ts`)
- **Functionality:** Fetch projects list with React Query caching
- **Parameters:** filters (status, user), sortBy
- **Returns:** {data, isLoading, error, refetch}
- **High Fan-In:** 5+ pages
- **Caching:** 5 minute stale time

**`useProject` Hook** (`frontend/src/hooks/useProject.ts`)
- **Functionality:** Fetch single project with eager-loaded layers
- **Parameter:** projectId
- **Returns:** {project, isLoading, error}

**`useConditions` Hook** (`frontend/src/hooks/useConditions.ts`)
- **Functionality:** Fetch and manage JSONB conditions for layer
- **Parameters:** projectId, layerId
- **Functions:** getConditions, updateConditions, validateCondition
- **Pattern:** Mutation support via useProjectConditionsMutation

**`useExportData` Hook** (`frontend/src/hooks/useExportData.ts`)
- **Functionality:** Preview and generate exports
- **Functions:** previewExport, generateExcel, generateZip, downloadFile

#### Form Hooks

**`useForm` Hook** (`frontend/src/hooks/useForm.ts`)
- **Responsibility:** Generic form state management
- **State:** formData, errors, touched, isDirty
- **Functions:** handleChange, handleBlur, handleSubmit, resetForm

**`useProjectForm` Hook** (`frontend/src/hooks/useProjectForm.ts`)
- **Responsibility:** Project editing form with multi-step validation
- **State:** projectData, validationErrors, step
- **Validation:** Column definitions applied to each condition

**`useGridCellEdit` Hook** (`frontend/src/hooks/useGridCellEdit.ts`)
- **Responsibility:** AG Grid cell edit handling and validation
- **Functions:** onCellValueChanged, validateCell, markForSave
- **Integration:** Zustand store for tracking dirty cells

#### Lifecycle Hooks

**`useAsync` Hook** (`frontend/src/hooks/useAsync.ts`)
- **Responsibility:** Async operation state management
- **State:** loading, error, data, status
- **Pattern:** useEffect wrapper with cleanup

**`useLocalStorage` Hook** (`frontend/src/hooks/useLocalStorage.ts`)
- **Responsibility:** Persist state to localStorage with sync
- **Usage:** Token persistence, UI preferences

#### Utility Hooks

**`useDebounce` Hook** (`frontend/src/hooks/useDebounce.ts`)
- **Responsibility:** Debounce value changes
- **Usage:** Condition search, field validation

**`useResize` Hook** (`frontend/src/hooks/useResize.ts`)
- **Responsibility:** Window resize listener
- **Usage:** Responsive grid sizing

### Components

**Module:** `src/components`
**Location:** `frontend/src/components/` (50+ components)
**Architecture:** Presentational + container component pattern

#### Page Components (12 protected routes)

**LoginPage** (`frontend/src/pages/LoginPage.tsx`)
- **Purpose:** User authentication
- **Form:** username, password input
- **Hooks:** useLoginForm, useAuth
- **Redirect:** /projects on success

**DashboardPage** (`frontend/src/pages/DashboardPage.tsx`)
- **Purpose:** Overview and recent activity
- **Content:** Stats (count by status), timeline, quick links
- **Hooks:** useDashboard, useAuth
- **Protected:** Requires login

**ProjectListPage** (`frontend/src/pages/ProjectListPage.tsx`)
- **Purpose:** Browse and manage projects
- **Features:** Filtering (status, user), sorting, pagination
- **Grid:** React Table or custom table showing projects
- **Hooks:** useProjects, useProjectStore, useFilters
- **Actions:** Create, edit, delete, status change

**ConditionEditorPage** (`frontend/src/pages/ConditionEditorPage.tsx`)
- **Purpose:** Edit project layer conditions
- **UI:** AG Grid with 300+ columns, formula bar, validation feedback
- **Hooks:** useProject, useConditions, useGridCellEdit, useValidation
- **Features:** Real-time validation, change tracking, save/cancel
- **Sidebar:** Layers panel, comments panel, recipe import

#### Layout Components

**Layout** (`frontend/src/components/Layout.tsx`)
- **Purpose:** Main page wrapper
- **Content:** Header (logo, user menu), Sidebar (nav), main content, Footer
- **Responsive:** Mobile menu toggle

**Header** (`frontend/src/components/Header.tsx`)
- **Content:** PCM branding, current user display, logout button
- **Hooks:** useAuth, useToast

**Sidebar** (`frontend/src/components/Sidebar.tsx`)
- **Content:** Navigation links, role-based menu visibility
- **Links:** Dashboard, Projects, Admin sections (user role dependent)

#### Data Grid Components

**ConditionGrid** (`frontend/src/components/ConditionGrid.tsx`)
- **Purpose:** AG Grid wrapper with PCM customizations
- **Columns:** 300+ from ColumnDefinitions, grouped by category
- **Features:** Cell editing, inline validation, formula bar
- **Hooks:** useConditions, useGridCellEdit, useValidation
- **Integration:** AG Grid Community with JSONB cell data

**GridCellEditor** (`frontend/src/components/GridCellEditor.tsx`)
- **Purpose:** Custom cell editing component
- **Types:** Text input, number, select, date
- **Validation:** Real-time feedback from backend
- **Features:** Dropdown for enum columns, range indicators

#### Form Components

**ProjectForm** (`frontend/src/components/ProjectForm.tsx`)
- **Purpose:** Create/edit project
- **Fields:** product selection, backbone selection, description
- **Hooks:** useProjectForm, useAuth
- **Validation:** Product must be approved, backbone must exist

**ConditionForm** (`frontend/src/components/ConditionForm.tsx`)
- **Purpose:** Edit conditions with validation
- **Pattern:** Uncontrolled form with ref validation
- **Validation:** Column-level rules applied as user types

#### Feature Components

**RecipeImportPanel** (`frontend/src/components/RecipeImportPanel.tsx`)
- **Purpose:** Upload and preview recipe XML diff
- **Features:** File upload, diff preview (old vs new), selective apply
- **Hooks:** useRecipe, useExport

**CommentPanel** (`frontend/src/components/CommentPanel.tsx`)
- **Purpose:** Display and add comments
- **Levels:** Project, layer, cell level comments
- **Features:** Add, edit, resolve comments
- **Hooks:** useComments

**ExportPanel** (`frontend/src/components/ExportPanel.tsx`)
- **Purpose:** Configure and generate exports
- **Options:** Format type (A/B/C), system selection, batch
- **Features:** Preview, generate, download, history
- **Hooks:** useExportData

#### Shared Components

**Button, Input, Select, Dialog, Modal, Toast, Spinner, Badge, Tag**
**Library:** Tailwind CSS 4 styled
**Accessibility:** ARIA labels, keyboard navigation
**Notes:** Reusable across all pages

### Types

**Module:** `src/types`
**Location:** `frontend/src/types/` (10+ type files)
**Responsibility:** TypeScript type definitions for domain models

#### Core Domain Types

**User Type** (`frontend/src/types/user.ts`)
- `User` interface with id, username, display_name, role (enum), is_active
- `Role` enum: 'user', 'admin'

**Project Types** (`frontend/src/types/project.ts`)
- `Project` interface: id, product_id, status, revision, parent_project_id
- `ProjectStatus` enum: 'draft', 'review', 'approved', 'archived'
- `ProjectWithLayers` extends Project with layers array

**Layer Types** (`frontend/src/types/layer.ts`)
- `Layer` interface: id, layer_name, step_seq, layer_number
- `ProjectLayer` extends with conditions (JSONB), backbone_conditions

**Condition Types** (`frontend/src/types/condition.ts`)
- `Condition` as Record<string, any> (flexible JSONB)
- `GridData` for flattened grid view

**Column Types** (`frontend/src/types/column.ts`)
- `ColumnDefinition` interface: column_name, display_name, category, data_type
- `ColumnCategory` enum: 'SP', 'SC', 'OVL', 'DEV'

**Validation Types** (`frontend/src/types/validation.ts`)
- `ValidationRule` interface: rule_type, rule_config
- `ValidationError` interface: field, message, type

**Export Types** (`frontend/src/types/export.ts`)
- `ExportJob` interface: id, format_type, system_id, status, file_url
- `ExportFormat` enum: 'TYPE_A', 'TYPE_B', 'TYPE_C'

**Comment Types** (`frontend/src/types/comment.ts`)
- `Comment` interface: id, project_id, layer_id (optional), content
- `CommentLevel` enum: 'project', 'layer', 'cell'

### Library Utilities

**Module:** `src/lib`
**Location:** `frontend/src/lib/` (utility functions)

#### API Helper Functions

**`frontend/src/lib/api.ts`**
- `handleApiError(error)` - Global error handling
- `formatApiResponse(response)` - Response normalization

#### Data Formatting

**`frontend/src/lib/format.ts`**
- `formatDate(date)` - Consistent date formatting
- `formatNumber(value, precision)` - Number formatting
- `formatJSON(obj)` - JSON pretty-printing

#### Validation Utilities

**`frontend/src/lib/validation.ts`**
- `validateRange(value, min, max)` - Range check
- `validateRequired(value)` - Non-empty check
- `validatePattern(value, pattern)` - Regex check
- `validateEmail(email)` - Email format check

#### Grid Utilities

**`frontend/src/lib/grid.ts`**
- `flattenConditions(nested)` - JSONB to grid row
- `unflattenConditions(row)` - Grid row to JSONB
- `applyValidationStyles(cellData, validationRules)` - Grid styling

### Build Configuration

**File:** `frontend/package.json`
**Build Tool:** Vite with React plugin
**Dev Server:** Vite HMR on port 5173
**Test Runner:** Vitest with React Testing Library
**Linting:** ESLint with TypeScript support
**Formatting:** Prettier
**Type Checking:** TypeScript 5.7

---

## Module Dependencies

### Backend Dependency Graph

```
FastAPI App
├── Routers (18)
│   ├── auth.py → AuthService → get_current_user
│   ├── project.py → ProjectService → ProjectRepository
│   ├── condition.py → ConditionService → ConditionRepository
│   ├── export.py → ExportService → ExportRepository
│   └── ... (15 more routers)
│
├── Services (23)
│   ├── ProjectService → ProjectRepository, BackboneRepository
│   ├── ConditionService → ConditionRepository, ValidationService
│   ├── ExportService → ExportRepository, ExportColumnMappingRepository
│   └── ... (20 more services)
│
├── Repositories (4)
│   ├── ProjectRepository → Project model
│   ├── BackboneRepository → ProductLayer model
│   ├── ConditionRepository → ProjectLayer model
│   └── ValidationRepository → ColumnValidation model
│
├── Models (10)
│   └── SQLAlchemy ORM classes
│
├── Schemas (10+)
│   └── Pydantic DTOs
│
├── Dependencies
│   └── auth.py → User model
│
└── Utils
    ├── comparison.py → Dict diffing
    ├── excel_export.py → Excel generation
    └── xml_processing.py → Recipe parsing
```

### Frontend Dependency Graph

```
App.tsx (React Router)
├── Pages (12)
│   ├── LoginPage → useAuth, useLoginForm
│   ├── DashboardPage → useDashboard
│   ├── ProjectListPage → useProjects, useProjectStore
│   ├── ConditionEditorPage → useProject, useConditions, useGridCellEdit
│   └── Admin pages → require_admin check
│
├── Stores (3 Zustand)
│   ├── useAuthStore → localStorage
│   ├── useToastStore → notifications
│   └── useProjectStore → derived state
│
├── Hooks (30+)
│   ├── useAuth → useAuthStore
│   ├── useProjects → api/projects.ts
│   ├── useConditions → api/conditions.ts
│   └── ... (27 more hooks)
│
├── Components (50+)
│   ├── Layout → Header, Sidebar
│   ├── ConditionGrid → AG Grid wrapper
│   ├── Forms → useForm hooks
│   └── Features → Recipe, Comments, Export
│
├── API Client (19 modules)
│   └── client.ts → axios instance
│
├── Types (10+)
│   └── TypeScript interfaces
│
└── Lib (utilities)
    ├── api.ts → Error handling
    ├── format.ts → Data formatting
    ├── validation.ts → Rules
    └── grid.ts → AG Grid helpers
```

### Cross-Module Communication

**High Fan-In Modules (require careful design):**
- Backend: get_db, get_current_user, require_admin, compare_dicts
- Frontend: useAuthStore, useToastStore, client.ts, useProjects

**These modules should be marked with @MX:ANCHOR tags due to their broad influence.**

---

## Summary

PCM's modular architecture enables:
- **Clear separation of concerns** - Each layer has specific responsibility
- **Easy testing** - Dependency injection and repository pattern
- **Scalability** - Add services/routers without modifying existing code
- **Maintainability** - Domain-driven models match business logic
- **Reusability** - Components and hooks used across multiple pages
