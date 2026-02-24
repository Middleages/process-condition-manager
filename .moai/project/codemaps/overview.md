# PCM Architecture Overview

Process Condition Manager is a semiconductor photo process condition management web application designed for managing and controlling process conditions across manufacturing layers and products.

## System Architecture

### High-Level View

PCM follows a layered architecture pattern with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                   Presentation Layer                        │
│              React 18 + TypeScript Frontend                 │
│     (50+ Components, 12 Pages, 30+ Hooks, AG Grid)          │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP/REST
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   API Gateway Layer                         │
│     Nginx Reverse Proxy (Docker) on port 80                 │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP/JSON
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               FastAPI Backend (Python)                      │
│        18 Routers + 23 Services + 4 Repositories            │
│           Async/Await Pattern throughout                    │
└─────────────────────────────────────────────────────────────┘
         ▲                              ▲
         │ AsyncSession                 │ REST API
         ▼                              ▼
┌──────────────────────┐    ┌─────────────────────────────────┐
│   PostgreSQL DB      │    │  External Systems               │
│  + JSONB Support     │    │  (Equipment, Recipe XML, etc)   │
└──────────────────────┘    └─────────────────────────────────┘
```

### Technology Stack

**Backend:**
- FastAPI 0.100+ (async Python web framework)
- SQLAlchemy 2.0+ (async ORM with JSONB support)
- asyncpg (PostgreSQL async driver)
- Pydantic v2 (data validation and DTOs)
- python-jose (JWT authentication)
- openpyxl (Excel export)
- lxml (XML processing for recipe import/diff)
- pytest-asyncio (async testing)

**Frontend:**
- React 18 (UI framework)
- TypeScript 5.7 (type safety)
- React Router v7 (navigation, 13 routes)
- React Query (server state management)
- Zustand (client state management, 3 stores)
- AG Grid Community Edition (data grid, 300+ columns)
- Tailwind CSS 4 (styling)
- Vite (build tool)
- Vitest (testing)
- Axios (HTTP client, 19 API modules)

**Infrastructure:**
- Docker Compose (local development, 4 services)
- Nginx (reverse proxy and static serving)
- PostgreSQL 15+ (relational database)
- Alembic (database migrations)

## Key Architectural Patterns

### Backend: Layered Architecture + Repository Pattern

```
Router Layer (18 endpoints)
    ↓ HTTP Request
Service Layer (23 services)
    ↓ Business Logic
Repository Layer (4 repositories)
    ↓ Data Access
ORM Layer (SQLAlchemy 2.0 async)
    ↓ SQL Generation
PostgreSQL Database (JSONB columns)
```

Each router delegates to a service, which uses repositories for data access. This enables clean separation, testability, and maintainability.

### Frontend: Component-Based + Hooks + State Management

```
Pages (12 protected routes)
    ↓
Components (50+)
    ↓
Hooks (30+, custom and built-in)
    ↓
API Client (Axios, 19 modules)
    ↓
Zustand Stores (3: auth, toast, projects)
    ↓
HTTP → Backend
```

### Authentication & Authorization

- JWT-based authentication with Access + Refresh tokens
- Role-Based Access Control (RBAC) with 2 roles: user, admin
- `get_current_user` dependency (high fan-in, 10+ routers)
- `require_admin` dependency (high fan-in, 8+ routers)
- Protected routes and API endpoints

### Data Model: JSONB for Dynamic Conditions

PCM stores ~300 parameters per layer in PostgreSQL JSONB columns:
- `ProductLayers.conditions` - Master condition template
- `ProjectLayers.conditions` - Project-specific conditions
- `ProjectLayers.backbone_conditions` - Copied from backbone
- `ColumnValidations.rule_config` - Validation rules as JSON

This flexibility enables rapid addition of new parameters without schema changes.

## Core Domain Concepts

### Backbone: Template-Based Project Creation

A "Backbone" is an approved Product's condition table (ProductLayers) used as a template when creating new projects. The backbone copy process transfers both structure and initial values, enabling consistency and fast project setup.

### Project Lifecycle

Projects progress through states: **Draft** (editable) → **Review** (reviewable) → **Approved** (locked) → **Archived** (historical).

Each state change is tracked with revision control and change logging.

### Layers and Parameters

Manufacturing processes consist of multiple **Layers** (e.g., "Photoresist", "Development"). Each layer contains **Parameters** stored as JSONB, organized by **ColumnCategories** (SP, SC, OVL, DEV).

### Validation System

Parameters support multiple validation types:
- Range validation (min/max)
- Required/optional fields
- Conditional requirements (if field A then require field B)
- Cross-layer validation (consistency across multiple layers)
- Pattern validation (regex)

### Recipe XML and Diff

Equipment exports recipe definitions as XML. PCM:
1. Imports the recipe XML
2. Performs structural diff against current conditions
3. Generates change preview for user review
4. Applies selected changes selectively (not all-or-nothing)

### Change Tracking

Every cell modification is logged in ChangeLogs with:
- Field name (parameter)
- Old and new values
- Change type (manual, backbone, recipe, status)
- Timestamp and user

### Comments System

Comments operate at 3 levels:
- **Project level** - Overall feedback on the project
- **Layer level** - Feedback on specific manufacturing layer
- **Cell level** - Feedback on individual parameter values

### Export System

Export supports 3 formats:
- **TYPE_A** - Horizontal layout (typical Excel)
- **TYPE_B** - Equipment-split layout (grouped by equipment)
- **TYPE_C** - Transposed layout (rotated view)

Export mappings are configurable per external system via ExportColumnMappings.

## Data Entities (10 Core Tables)

| Entity | Purpose | Key Fields |
|--------|---------|-----------|
| Users | User accounts | id, username, display_name, role, is_active |
| Products | Product master data | id, product_name, description, line_id |
| Layers | Manufacturing layers | id, layer_name, step_seq, layer_number, sort_order |
| ProductLayers | Product condition template | product_id, layer_id, conditions (JSONB) |
| Projects | Project work items | id, product_id, main_backbone_id, status, revision, parent_project_id |
| ProjectLayers | Project-specific layers | project_id, layer_id, backbone_product_id, conditions (JSONB), backbone_conditions (JSONB) |
| ColumnCategories | Parameter categories | SP, SC, OVL, DEV (4 default) |
| ColumnDefinitions | Parameter definitions | column_name, display_name, category_id, data_type, select_options |
| ColumnValidations | Validation rules | column_id, rule_type, rule_config (JSONB) |
| ChangeLogs | Audit trail | project_id, field_name, old_value, new_value, change_type |

Supporting tables: Comments (project/layer/cell), ExportSystems, ExportColumnMappings, ExportHistories, AuditLogs.

## High Fan-In Modules (Architectural Anchors)

### Backend High Fan-In

- `app.database.get_db` - Database session dependency (18+ routers)
- `app.dependencies.auth.get_current_user` - Current user injection (10+ routers)
- `app.dependencies.auth.require_admin` - Admin check (8+ routers)
- `app.models.User` - User entity (14+ imports)
- `app.models.Project` - Project entity (8+ imports)
- `app.services.project_service` - Core project logic (3+ routers)
- `app.repositories.backbone_repository` - Backbone operations (4+ services)
- `app.utils.comparison.compare_dicts` - Condition diffing (4+ places)

These modules require careful documentation (@MX:ANCHOR tags) and refactoring considerations due to their broad influence.

### Frontend High Fan-In

- `stores/useAuthStore` - Authentication state (20+ components)
- `stores/useToastStore` - Toast notifications (15+ components)
- `api/client.ts` - Axios configuration (19+ modules)
- `hooks/useProjects` - Project data fetching (5+ pages)

## Database Deployment

The database schema is version-controlled via **Alembic** with 14 migration versions, enabling reproducible deployments and safe schema evolution.

## Testing Infrastructure

- Backend: 25 test files with 380/380 tests passing (~7,900 lines)
- Frontend: 5 test files using Vitest
- Async test support via pytest-asyncio
- In-memory SQLite for isolated testing
- Dependency injection for mock auth and database

## Performance Characteristics

- AG Grid handles 300+ columns × 60+ layers without virtualization
- JSONB queries optimized with PostgreSQL GIN indexes
- Async API ensures non-blocking under load
- Docker Compose deployment supports local development with fast iteration

## Network Architecture

```
Internet
    ↓
┌─────────────────────┐
│   Docker Network    │
├─────────────────────┤
│                     │
│  Nginx:80           │
│  ├─→ Frontend       │
│  └─→ API:8000       │
│                     │
│  FastAPI:8000       │
│  └─→ PostgreSQL     │
│                     │
└─────────────────────┘
```

All services communicate via Docker internal networking with Nginx as the reverse proxy.

## Deployment Model

PCM deploys as 4 Docker services coordinated by docker-compose:
1. **nginx** - Reverse proxy and static frontend serving
2. **backend** - FastAPI application server
3. **database** - PostgreSQL database
4. **pgadmin** (optional) - Database administration UI

This model supports local development, staging, and production deployments with environment variable configuration.

## Security Considerations

- JWT tokens with configurable expiration
- Password hashing via python-jose
- Role-based access control enforcement
- Input validation via Pydantic schemas
- SQL injection prevention via SQLAlchemy ORM
- CORS configuration for frontend domain restriction
- Audit logging via ChangeLogs table

## Summary

PCM is a well-architected, modern web application following industry best practices:

- **Layered architecture** enables testability and maintainability
- **Async throughout** provides scalability
- **Domain-driven design** with clear models for backbone, project, layers, parameters
- **Flexible JSONB storage** enables rapid parameter evolution
- **Comprehensive validation** prevents invalid state
- **Audit trails** enable compliance and debugging
- **Clean separation** between frontend and backend
- **Container deployment** enables reproducibility
