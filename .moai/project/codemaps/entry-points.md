# PCM Entry Points Catalog

Generated: 2026-02-27
Version: 3.0.0 (SPEC-DEVICE-001 + SPEC-PROJECT-002 + SPEC-RBAC-001 + SPEC-EQP-002)

---

## Application Entry Points

### Backend Entry Point

**File**: `backend/app/main.py`

Responsibilities:
- Creates `FastAPI` application instance
- Configures CORS middleware (allow-list from `CORS_ORIGINS` env var)
- Registers global unhandled exception handler (returns generic 500)
- Defines `GET /api/health` health check endpoint (tests DB connectivity)
- Registers all 21 routers via `app.include_router()`

**Startup sequence**:
1. FastAPI application created with title from settings
2. CORS middleware attached
3. Exception handler registered
4. All routers registered with `/api` prefix
5. SQLAlchemy async engine initialized on first request

### Frontend Entry Point

**File**: `frontend/src/main.tsx`

Responsibilities:
- Creates React root via `ReactDOM.createRoot`
- Wraps application in `QueryClientProvider` (TanStack Query)
- Renders `<App />` component

**File**: `frontend/src/App.tsx`

Responsibilities:
- Defines all frontend routes using React Router `createBrowserRouter`
- Implements `AppInitializer` component for session restoration on mount
- Wraps router in `ErrorBoundary` and `ToastContainer`
- Registers `ProtectedRoute` wrapper around all authenticated routes

### Seed Data Entry Point

**File**: `backend/app/seed/__main__.py`

Invocation: `python -m app.seed` (inside Docker container)

Responsibilities:
- Seeds initial master data: lines, products, layers, column categories, column definitions, users, equipment, export systems, XML mappings
- Uses `runner.py` to orchestrate seed module execution order
- Idempotent: checks for existing records before inserting

---

## API Endpoint Catalog

Total endpoints: ~115 across 21 router files

### auth.py — Authentication (prefix: /api/auth)

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| POST | /api/auth/login | No | Username + password login, returns access token + sets refresh cookie |
| POST | /api/auth/logout | Yes | Clears refresh cookie |
| POST | /api/auth/refresh | No (cookie) | Exchanges refresh cookie for new access token |
| GET | /api/auth/me | Yes | Current authenticated user profile |

### users.py (prefix: /api/users)

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | /api/users | Yes | List all active users (for reviewer dropdowns) |

### lines.py (prefix: /api/lines)

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | /api/lines | Yes | List all lines |

### columns.py (prefix: /api/columns)

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | /api/columns | Yes | All column definitions with categories and validation rules |

### products.py (prefix: /api/products)

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | /api/products | Yes | List products (optionally filtered by line_id) |
| GET | /api/products/{id} | Yes | Product detail |
| GET | /api/products/{id}/layers | Yes | Product's layer list |
| GET | /api/backbones | Yes | Dynamic backbone list (Approved projects per line) |
| GET | /api/backbone-layers | Yes | Backbone project's layers (for V1 project creation) |

### equipments.py (prefix: /api/equipments)

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | /api/equipments | Yes | Equipment list by line_id (autocomplete source for EQP columns) |

### projects.py (prefix: /api/projects)

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | /api/projects | Yes | Project list (filters: status, line_id) |
| POST | /api/projects | Yes | Create project V1 (product + backbone) or V2 (device_master) |
| GET | /api/projects/{id} | Yes | Project detail with layers |
| DELETE | /api/projects/{id} | Yes (owner) | Delete draft project |

### project_conditions.py (prefix: /api/projects/{id})

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| PUT | /api/projects/{id}/conditions | Yes (owner) | Bulk save condition changes, records change_logs |
| POST | /api/projects/{id}/validate | Yes | Run validation, returns errors by layer |
| GET | /api/projects/{id}/change-logs | Yes | Change log list with filters (column, source_type, layer) |
| GET | /api/projects/{id}/cell-history | Yes | Full edit history for a specific column_key in a layer |
| GET | /api/projects/{id}/versions | Yes | All versions (Draft + Archived) of this project lineage |
| GET | /api/projects/{id}/diff | Yes | JSONB diff between two project_layer versions |
| GET | /api/projects/{id}/export/simple | Yes | Full condition table Excel download (all statuses) |

### project_layers.py (prefix: /api/projects/{id})

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| POST | /api/projects/{id}/layers/{layerId}/backbone-replace | Yes (owner) | Replace a layer's conditions with backbone source |
| POST | /api/projects/{id}/layers/{layerId}/recipe-upload | Yes (owner) | Upload Recipe XML for a layer |
| GET | /api/projects/{id}/layers/{layerId}/recipe-diff | Yes | Get diff between Recipe XML and current conditions |
| POST | /api/projects/{id}/layers/{layerId}/recipe-apply | Yes (owner) | Apply selected Recipe XML diff entries |
| POST | /api/projects/{id}/layers | Yes (owner) | Add new layer to project |

### project_lifecycle.py (prefix: /api/projects/{id})

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| POST | /api/projects/{id}/submit-review | Yes (owner) | Submit project for review (Draft → Review); requires 0 validation errors |
| POST | /api/projects/{id}/approve | Yes (reviewer) | Approve project (Review → Approved) |
| POST | /api/projects/{id}/reject | Yes (reviewer) | Reject project (Review → Draft) |
| POST | /api/projects/{id}/revise | Yes | Create new revision (Approved → new Draft v+1; original → Archived) |
| GET | /api/projects/{id}/change-summary | Yes | Summary of changes vs backbone for review |

### dashboard.py (prefix: /api/dashboard)

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | /api/dashboard | Yes | Overview: status counts, my projects, review queue, activity timeline |

### comments.py (prefix: /api/projects/{id}/comments)

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | /api/projects/{id}/comments | Yes | List all review comments for project |
| POST | /api/projects/{id}/comments | Yes | Create review comment |
| PUT | /api/projects/{id}/comments/{commentId} | Yes (author) | Update comment |
| DELETE | /api/projects/{id}/comments/{commentId} | Yes (author) | Delete comment |

### admin.py (prefix: /api/admin)

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | /api/admin/validations | Yes (admin) | List column validation rules |
| POST | /api/admin/validations | Yes (admin) | Create validation rule |
| PUT | /api/admin/validations/{id} | Yes (admin) | Update validation rule |
| DELETE | /api/admin/validations/{id} | Yes (admin) | Delete validation rule |
| GET | /api/admin/cross-layer-rules | Yes (admin) | List cross-layer validation rules |
| POST | /api/admin/cross-layer-rules | Yes (admin) | Create cross-layer rule |
| PUT | /api/admin/cross-layer-rules/{id} | Yes (admin) | Update cross-layer rule |
| DELETE | /api/admin/cross-layer-rules/{id} | Yes (admin) | Delete cross-layer rule |
| GET | /api/admin/select-options | Yes (admin/developer) | Get select column options |
| PUT | /api/admin/select-options/{columnKey} | Yes (admin/developer) | Update select options for a column |
| GET | /api/admin/audit-logs | Yes (admin/developer) | Audit log with filters + pagination |

### admin_users.py (prefix: /api/admin/users)

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | /api/admin/users | Yes (admin) | List all users |
| POST | /api/admin/users | Yes (admin) | Create user |
| PUT | /api/admin/users/{id} | Yes (admin) | Update user (name, email, roles) |
| PATCH | /api/admin/users/{id}/deactivate | Yes (admin) | Deactivate user account |
| POST | /api/admin/users/{id}/reset-password | Yes (admin) | Reset user password |

### admin_master.py (prefix: /api/admin, 26 endpoints)

Manages: Line, Product, Layer, ColumnDefinition, ColumnCategory, Equipment

Pattern per entity: GET list, POST create, PUT update, DELETE (FK-safe), POST reorder

| Resource | Base Path |
|----------|-----------|
| Lines | /api/admin/lines |
| Products | /api/admin/products |
| Layers | /api/admin/layers |
| Column Definitions | /api/admin/column-definitions |
| Column Categories | /api/admin/column-categories |
| Equipment | /api/admin/equipments |

### admin_device.py (prefix: /api/admin/device-masters, 13 endpoints)

| Group | Paths |
|-------|-------|
| Sync Source Config | GET/POST/PUT /api/admin/device-masters/sync-source |
| Device Meta Sources | GET/POST/PUT/DELETE /api/admin/device-masters/meta-sources |
| Sync Trigger | POST /api/admin/device-masters/sync |
| Device List | GET /api/admin/device-masters |
| Layer Master | GET /api/admin/device-masters/{id}/layers |

### device_masters.py (prefix: /api/device-masters, 5 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/device-masters | List device masters (filterable by line_id) |
| GET | /api/device-masters/{id} | Device master detail |
| GET | /api/device-masters/{id}/layers | Layer masters for a device |
| GET | /api/device-masters/{id}/projects | Projects using this device master |
| GET | /api/device-masters/search | Search device masters |

### export.py (project_router prefix: /api/projects/{id}/export)

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | /api/projects/{id}/export/systems | Yes | Available export systems for project's line |
| GET | /api/projects/{id}/export/preview/{systemId} | Yes (Approved) | Preview export data (no file download) |
| GET | /api/projects/{id}/export/download/{systemId} | Yes (Approved) | Download single export Excel file |
| POST | /api/export/bulk | Yes (Approved) | Bulk download multiple systems as ZIP |

### export_admin.py (prefix: /api/admin)

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | /api/admin/export-systems | List + create export systems |
| GET/PUT/DELETE | /api/admin/export-systems/{id} | System detail + CRUD |
| GET/POST | /api/admin/export-systems/{id}/mappings | Column mappings for system |
| PUT/DELETE | /api/admin/export-mappings/{id} | Update/delete mapping |

### export_data_source.py (prefix: /api/admin/export-data-sources, 5 endpoints)

CRUD for ExportDataSource records: GET list, POST create, GET detail, PUT update, DELETE.

---

## Frontend Route Tree

```
/login                           (public, LoginPage)
/                                (protected, DashboardPage)
  └─► requires: authenticated
/projects                        (protected, ProjectListPage)
  └─► requires: authenticated
  └─► query params: ?status=X&line_id=Y (URL state sync)
/projects/:projectId/edit        (protected, ConditionEditorPage)
  └─► requires: authenticated
/admin                           (protected, AdminLayout)
  └─► requires: authenticated + (admin OR developer role)
  /admin/master-data             (MasterDataPage)
    └─► requires: admin role (write); developer can view
  /admin/device-masters          (DeviceMasterPage)
    └─► requires: developer role
  /admin/users                   (UserManagementPage)
    └─► requires: admin role
  /admin/enum-options            (EnumManagementPage)
    └─► requires: admin OR developer role
  /admin/xml-mappings            (XmlMappingsPage)
    └─► requires: developer role
  /admin/validations             (ValidationRulesPage)
    └─► requires: admin role
  /admin/data-sources            (ExportDataSourcesPage)
    └─► requires: developer role
  /admin/export-systems          (ExportSystemsPage)
    └─► requires: developer role
  /admin/audit-logs              (AuditLogPage)
    └─► requires: admin OR developer role
  /admin (index)                 (Navigate to /admin/master-data)
*                                (NotFoundPage, public)
```

Admin tab visibility is role-filtered in `AdminLayout.tsx`:
- `admin` role sees: Users, Master Data, Validations, Audit Logs, Enum Options
- `developer` role sees: Device Masters, XML Mappings, Export Systems, Data Sources, Audit Logs, Enum Options
- Both roles: Enum Options, Audit Logs

---

## CLI Entry Points

### Docker Compose Operations

```bash
# Start all services
docker-compose up -d

# Start with logs
docker-compose up

# Backend only (hot reload)
docker-compose up backend

# Stop all
docker-compose down

# Stop and delete volumes (CAUTION: deletes DB data)
docker-compose down -v
```

### Database Migrations (Alembic)

```bash
# Apply all pending migrations
docker-compose exec backend alembic upgrade head

# Generate new migration from model changes
docker-compose exec backend alembic revision --autogenerate -m "description"

# Check current migration version
docker-compose exec backend alembic current

# Downgrade one step
docker-compose exec backend alembic downgrade -1
```

Migration history (19 total):
- 001_initial_schema
- 002–009: Phase 1–2 features
- 010–015: Phase 3–4 features (export, RBAC, dashboard)
- 016_create_equipments_table
- 017_user_role_to_roles_array
- 018_create_device_layer_master_tables
- 019_add_device_ref_to_projects

### Seed Data

```bash
# Run seed data initialization
docker-compose exec backend python -m app.seed

# Seed creates: lines, products, layers, users (admin/editor/reviewer/developer),
# column categories + definitions (~60 EQP columns + SP/SC/OVL/DEV),
# equipment (10 per line), export systems, XML mappings
```

### Backend Testing

```bash
# Run all 515 tests
docker-compose exec backend pytest

# Run with coverage report
docker-compose exec backend pytest --cov=app --cov-report=term-missing

# Run specific test file
docker-compose exec backend pytest tests/test_condition_service.py -v

# Run tests matching pattern
docker-compose exec backend pytest -k "backbone" -v
```

### Frontend Development

```bash
# Development server
cd frontend && npm run dev

# Production build
cd frontend && npm run build

# Run frontend tests
cd frontend && npm test

# Type check
cd frontend && npm run type-check
```

### Swagger / API Documentation

When backend is running:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- OpenAPI JSON: `http://localhost:8000/openapi.json`
- Health check: `http://localhost:8000/api/health`
