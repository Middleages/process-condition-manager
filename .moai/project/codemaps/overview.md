# PCM Architecture Overview

Generated: 2026-02-27
Version: 3.0.0 (SPEC-DEVICE-001 + SPEC-PROJECT-002 + SPEC-RBAC-001 + SPEC-EQP-002)

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser (React 18)                          │
│   DashboardPage  ProjectListPage  ConditionEditorPage  AdminPages    │
│   ─────────────────────────────────────────────────────────────────  │
│   Pages (15)   Hooks (24)   Components (70+)   Stores (3)   API (19) │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  HTTP / REST (Axios + TanStack Query)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Nginx Reverse Proxy :80                        │
│          /api/*  ──►  backend:8000                                   │
│          /*      ──►  frontend:5173                                  │
└──────────┬──────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    FastAPI Backend :8000                              │
│  ┌─────────────┐  ┌──────────────────────────────────────────────┐  │
│  │  Middleware  │  │  Routers (21 files, ~115 endpoints)           │  │
│  │  CORS       │  │  auth | projects | project_conditions         │  │
│  │  Exception  │  │  project_layers | project_lifecycle           │  │
│  │  Handler    │  │  admin | admin_users | admin_master           │  │
│  └─────────────┘  │  admin_device | device_masters                │  │
│                   │  export | export_admin | export_data_source    │  │
│                   │  dashboard | comments | columns                │  │
│                   │  lines | products | equipments | users         │  │
│                   └──────────────────┬───────────────────────────┘  │
│                                      │                               │
│                   ┌──────────────────▼───────────────────────────┐  │
│                   │  Services (28 files)                           │  │
│                   │  project_service | project_status_service      │  │
│                   │  project_analytics_service | condition_service  │  │
│                   │  validation_service | cross_layer_validation   │  │
│                   │  backbone_service | recipe_service             │  │
│                   │  device_master_query | device_master_sync      │  │
│                   │  device_enrichment | sync_source_config        │  │
│                   │  device_meta_source | export_service           │  │
│                   │  export_builders | export_admin_service        │  │
│                   │  export_history | export_validation            │  │
│                   │  export_data_source | admin_service            │  │
│                   │  admin_master_service | admin_user_service     │  │
│                   │  auth_service | comment_service                │  │
│                   │  change_log_service | dashboard_service        │  │
│                   │  diff_service                                   │  │
│                   └──────────────────┬───────────────────────────┘  │
│                                      │                               │
│                   ┌──────────────────▼───────────────────────────┐  │
│                   │  Repositories (4 files)                        │  │
│                   │  backbone | comment | change_log | dashboard   │  │
│                   └──────────────────┬───────────────────────────┘  │
│                                      │                               │
│                   ┌──────────────────▼───────────────────────────┐  │
│                   │  SQLAlchemy 2.x Async ORM (12 model files)    │  │
│                   └──────────────────┬───────────────────────────┘  │
└──────────────────────────────────────┼──────────────────────────────┘
                                       │  asyncpg
                                       ▼
                        ┌──────────────────────────┐
                        │  PostgreSQL 16 :5432       │
                        │  JSONB conditions storage  │
                        │  19 Alembic migrations     │
                        └──────────────────────────┘
```

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Frontend Framework | React | 18 | UI rendering |
| Frontend Language | TypeScript | 5.x (strict) | Type-safe frontend code |
| Frontend Build | Vite | 5.x | Dev server + bundler |
| Frontend Routing | React Router | v7 | Client-side routing |
| Frontend State | Zustand | 4.x | Global state management |
| Frontend Server State | TanStack React Query | 5.x | Server state + caching |
| Frontend Grid | AG Grid Community | 31+ | Condition table editing |
| Frontend HTTP | Axios | 1.x | API client with interceptors |
| Frontend Styling | Tailwind CSS | v4 | Utility-first CSS |
| Frontend Icons | Lucide React | latest | Icon components |
| Frontend Testing | Vitest | latest | Unit + component tests |
| Backend Framework | FastAPI | 0.100+ | REST API server |
| Backend Language | Python | 3.13 | Backend logic |
| Backend ORM | SQLAlchemy | 2.x (async) | Database access layer |
| Backend Validation | Pydantic | v2 | Request/response schemas |
| Backend Auth | python-jose | 3.x | JWT token generation/validation |
| Backend Passwords | passlib (bcrypt) | 1.7 | Password hashing |
| Backend Excel | openpyxl | 3.x | Excel export generation |
| Backend XML | lxml | 4.x | Recipe XML parsing (XPath) |
| Backend Migrations | Alembic | 1.x | Database schema migrations |
| Backend Testing | pytest + pytest-asyncio | latest | 515 tests across 33 files |
| Database | PostgreSQL | 16 | Primary data store (JSONB) |
| Proxy | Nginx | latest | Reverse proxy + routing |
| Containerization | Docker Compose | v3.8 | Multi-service orchestration |

---

## Key Architectural Patterns

### Backend: 5-Layer Architecture

```
Router → Service → Repository → Model → PostgreSQL
```

- **Routers**: HTTP endpoint handlers, authentication guards, request/response schema mapping
- **Services**: Business logic orchestration, domain rule enforcement, external service calls
- **Repositories**: Optimized data access patterns, N+1 query prevention, complex join aggregations
- **Models**: SQLAlchemy 2.x async ORM definitions with typed columns and relationships
- **Schemas**: Pydantic v2 models providing API contract validation (18 schema files)

### Frontend: Feature-Sliced Architecture

```
Pages → Hooks → Components → Stores → API → Backend
```

- **Pages**: Route-level components that orchestrate hooks and compose layouts
- **Hooks**: Domain-specific data fetching (TanStack Query) and mutation logic (24 hook files)
- **Components**: Reusable UI elements organized by domain subdirectory (70+ across 8 subdirs)
- **Stores**: Zustand stores for editor state, auth state, and toast notifications
- **API**: Axios-based typed API client modules per domain (19 modules)

### Data Storage Strategy

- **Condition data**: Stored as JSONB in `project_layers.conditions` — enables flexible ~300-column schema without DDL changes per column addition
- **Backbone conditions**: Stored in `project_layers.backbone_conditions` for diff/comparison baseline (auto-updated on backbone replace)
- **Change history**: EAV-style `change_logs` table — every cell edit tracked with source_type (manual/backbone/recipe), before/after values
- **Configuration data**: Relational tables for master data (columns, validations, export systems, device masters)
- **Export mappings**: `export_column_mappings` with source_type field distinguishing internal (JSONB) vs external (JOIN) data sources

### Authentication: JWT + HTTP-only Cookie Dual-Token Strategy

- Access token: 15-minute lifetime, stored in Zustand memory store (cleared on page refresh)
- Refresh token: 7-day lifetime, stored in HTTP-only cookie (survives page refresh)
- Axios response interceptor auto-refreshes on 401 before retrying original request
- RBAC enforced at router level via FastAPI dependency injection

---

## Core Domain Concepts

| Concept | Description |
|---------|-------------|
| Process Condition Table | Grid of rows (layers) x columns (~300 parameters) representing fab lithography process conditions |
| Layer (ProjectLayer) | One row in the condition table with step_seq, layer name, and a conditions JSONB object |
| Column Definition | Metadata for each parameter column: category (SP/SC/OVL/DEV/EQP), data type, validation rules |
| Backbone (Dynamic) | An Approved project whose conditions serve as the reference baseline for new projects (SPEC-BACKBONE-001) |
| Project V1 | Project created via product + backbone selection (legacy creation flow) |
| Project V2 | Project created via DeviceMaster + LayerMaster reference (SPEC-DEVICE-001 / SPEC-PROJECT-002) |
| Device Master | Hardware device catalog (SPEC-DEVICE-001) — source of truth for V2 project layer templates |
| Layer Master | Layer/step template entries tied to a DeviceMaster record |
| Recipe XML | Equipment-exported XML; XPath-mapped conditions are diffed against current values, user selects which to apply |
| Revision | A new Draft version created from an Approved project; original transitions to Archived |
| Export Type A | Horizontal format: each layer is a column, conditions as rows |
| Export Type B | Equipment-split format: one sheet per equipment referenced in EQP columns |
| Export Type C | Key-value transpose format: column names as keys, condition values as values |
| Cross-Layer Validation | Rules that check consistency across multiple layers (reference_exists, compare_layers, equipment_compatibility) |

---

## Data Entity Table

| Model File | Entities | Purpose |
|-----------|----------|---------|
| user.py | User | Authentication, multi-role RBAC (roles TEXT[] ARRAY, 4 roles: editor/reviewer/admin/developer) |
| line.py | Line | Fab line master (e.g., Line-1, Line-2); FK for products, projects, equipments |
| product.py | Product, Layer, ProductLayer | Product master + layer templates (V1 backbone source); ProductLayer links products to layers |
| project.py | Project, ProjectLayer | Core work unit: conditions (JSONB), backbone_conditions (JSONB), device_ref_id, device_ref_version |
| column.py | ColumnCategory, ColumnDefinition, ColumnValidation | Column metadata (5 categories), validation rules (range/enum/regex/cross-layer), display ordering |
| change_log.py | ChangeLog, ProjectStatusLog, ReviewComment | Cell-level change history, status transition audit log, reviewer comments |
| export.py | ExportSystem, ExportColumnMapping, RecipeXmlMapping | Export system config, column-to-output-cell mappings (source_type: internal/external), XML XPath mappings |
| export_history.py | ExportHistory | Audit trail for every export download (who, when, which system) |
| export_data_source.py | ExportDataSource | External DB table definitions for Export sourcing data via JOIN |
| equipment.py | Equipment | Equipment master per line (autocomplete source for EQP_xx columns; ftp_pw write-only) |
| device_master.py | DeviceMaster, LayerMaster, SyncSourceConfig, DeviceMetaSource | Device/layer catalog for V2 project creation and sync orchestration |

---

## High Fan-in Modules

### Backend (3+ callers)

| Module | Estimated Callers | Role |
|--------|------------------|------|
| `app/dependencies/auth.py` | All 21 routers | Authentication + 6 RBAC dependency guards |
| `app/database.py` (async_session, Base) | All models + services | Async DB session factory |
| `app/models/project.py` (Project, ProjectLayer) | 10+ services | Core domain entities |
| `app/utils/comparison.py` (values_differ) | condition_service, validation_service, diff_service, export_validation_service | Unified cell value comparison (normalizes numeric types) |
| `app/constants.py` | project_status_service, validation_service, admin_service, cross_layer_validation_service | Domain constants: status transitions, rule types, category codes |
| `app/repositories/backbone_repository.py` | project_service, backbone_service | Approved-project-based dynamic backbone queries |
| `app/repositories/change_log_repository.py` | project_analytics_service, change_log_service | Change history queries + statistics |

### Frontend (3+ consumers)

| Module | Estimated Consumers | Role |
|--------|--------------------|----|
| `src/api/client.ts` | All 19 API modules | Axios instance with auth + refresh interceptors |
| `src/stores/useEditorStore.ts` | ConditionEditorPage + 6+ editor components | Central editor state (dirty cells, grid data, layer nav, UI toggles) |
| `src/stores/useAuthStore.ts` | ProtectedRoute, Header, AdminLayout, all admin pages | Auth state (current user, access token, RBAC helpers) |
| `src/types/index.ts` | All pages, hooks, components | Re-export hub for all 12 TypeScript type files |
| `src/components/editor/ConditionGrid.tsx` | ConditionEditorPage | AG Grid wrapper: condition table rendering + cell editing |
| `src/components/editor/buildColumnDefs.ts` | ConditionGrid | AG Grid column definition builder (EQP autocomplete detection, category grouping) |

---

## Testing Infrastructure

| Category | Count | Framework | Notes |
|----------|-------|-----------|-------|
| Backend test files | 33 | pytest + pytest-asyncio | Located in `backend/tests/` |
| Backend tests (passing) | 515 | pytest | Core business logic focus |
| Frontend test files | 2 | Vitest | Located in `frontend/src/**/__tests__/` |
| Test coverage target | 85%+ | pytest-cov | Backend priority per TRUST 5 |
| Mock strategy | pytest-mock + httpx | async test client | No external calls in CI |

Backend test areas: backbone copy, condition validation, bulk save, status transitions, cross-layer validation, export format generation (Type A/B/C), RBAC guard enforcement, diff calculation, device master sync.

Frontend test areas: diff calculation utilities (diff.ts), validation logic, auth component rendering.

---

## Network and Deployment Architecture

```
Development environment:
  Browser ──► localhost:5173  (Vite dev server, HMR hot reload)
  Browser ──► localhost:8000  (FastAPI uvicorn --reload)
  DB tools ──► localhost:5432 (PostgreSQL direct access)

Production (Docker Compose, 4 services):
  Browser ──► nginx:80
                ├── /api/*  ──► backend:8000 (FastAPI + uvicorn)
                └── /*      ──► frontend:5173 (Vite / static)
  backend:8000 ──► db:5432  (asyncpg, internal Docker network)

Docker volumes:
  pgdata         -- PostgreSQL data persistence (survives container restart)
  /app/node_modules -- Frontend node_modules (isolated from host)
```

Service dependency order: db (healthcheck) → backend → frontend → nginx

---

## Security Overview

| Concern | Implementation |
|---------|---------------|
| Authentication | JWT access token (15min in-memory) + refresh token (7d HTTP-only cookie) |
| Password storage | bcrypt hashing via passlib |
| Role-based access control | 4 roles: editor, reviewer, admin, developer; roles stored as PostgreSQL TEXT[] ARRAY |
| RBAC dependency guards | get_current_user, require_active_user, require_admin_or_developer, require_ops_write, require_system_write, require_project_owner |
| Operations vs System Config | admin role: master data, users; developer role: system config, export systems, device masters |
| CORS | Configurable allow-list via CORS_ORIGINS environment variable |
| Input validation | Pydantic v2 strict validation on all request bodies and query parameters |
| SQL injection prevention | SQLAlchemy ORM parameterized queries throughout (no raw SQL string concatenation) |
| Secret management | DATABASE_URL, SECRET_KEY via environment variables (.env not committed) |
| Token auto-refresh | Axios 401 interceptor transparently refreshes and retries failed requests |
| Write-only fields | Equipment.ftp_pw serialized as None in all responses (write-only pattern) |
| Error masking | Global exception handler returns generic 500 messages (no stack traces to client) |
