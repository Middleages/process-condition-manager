# SPEC-DEVICE-001: Implementation Plan

## Traceability Tag: SPEC-DEVICE-001

---

## Milestone Overview

| Milestone | Title | Priority | Dependencies |
|-----------|-------|----------|-------------|
| M1 | Device Master Table + Sync Source Config + Sync + CRUD API + Admin UI | Primary Goal | None |
| M2 | Layer Master Table + Sync + API | Secondary Goal | M1 complete |
| M3 | Device Meta Source Config + Enrichment Service + Admin UI Sub-tab | Final Goal | M1 complete |

---

## M1: Device Master Table + Sync Source Config + Sync + CRUD API + Admin UI

### Priority: Primary Goal
### Tag: SPEC-DEVICE-001-M1

### Technical Approach

1. **SQLAlchemy model + Alembic migration**: Create `DeviceMaster` and `SyncSourceConfig` models following existing patterns (see `Equipment` model as reference for line-based master data with `line_id` FK).

2. **Sync service with upsert**: Use PostgreSQL `INSERT ... ON CONFLICT (line_id, product_name) DO UPDATE` via SQLAlchemy for atomic batch sync. Resolve `line_id` from external line codes by matching against `lines.line_code`. The source table is configured via `sync_source_config` (not hardcoded).

3. **CRUD API following admin patterns**: Mirror existing admin patterns (`admin_master_service.py`, `admin_users` router) for consistency. Public read API under `/api/device-masters`, admin sync under `/api/admin/device-masters/sync`.

4. **Admin UI following MasterDataPage patterns**: New `DeviceMasterPage` component following existing admin page patterns (table + filters + action buttons). Single tab with sub-tabs.

### Implementation Steps

**Step 1: ORM Models (single file)**
- Create `backend/app/models/device_master.py` with:
  - `DeviceMaster` class: id, line_id (FK to lines.id, RESTRICT), product_name, process, part_id, is_active, enrichment (JSONB, default={}), synced_at, created_at, updated_at
  - `SyncSourceConfig` class: id, source_type, source_name, table_name, schema_name, column_mappings (JSONB), description, is_active, created_at, updated_at
- Unique constraint: DeviceMaster (line_id, product_name), SyncSourceConfig (source_type, source_name)
- Indexes: line_id, product_name
- Register both in `backend/app/models/__init__.py`

**Step 2: Alembic Migration (single migration for all tables)**
- `backend/alembic/versions/018_create_device_layer_master_tables.py`
- Create `device_master` + `sync_source_config` tables (layer_master + device_meta_source also created here for M2/M3)
- DOWN: drop all 4 tables in reverse dependency order

**Step 3: Pydantic Schemas**
- Create `backend/app/schemas/device_master.py`
- `DeviceMasterResponse` (with line_name resolved), `DeviceMasterListResponse`, `DeviceSyncResult`
- `SyncSourceConfigCreate`, `SyncSourceConfigResponse`
- Pagination params reuse existing patterns

**Step 4: Sync Source Config Service**
- Create `backend/app/services/sync_source_config_service.py`
- CRUD operations for sync source configurations
- Table existence validation on create/update

**Step 5: Sync Service**
- Create `backend/app/services/device_master_sync_service.py`
- `DeviceMasterSyncService.sync_devices(db, auto_enrich=True) -> DeviceSyncResult`
- Read active sync_source_config where source_type="device"
- Query source table, resolve line_id via lines.line_code
- Upsert into device_master with conflict resolution
- Track inserted/updated/unchanged counts
- Update synced_at on all synced records (including unchanged)
- Auto-trigger enrichment after sync (if auto_enrich=True and meta sources exist)

**Step 6: CRUD API Endpoints**
- Create `backend/app/routers/device_masters.py` (public read)
  - `GET /api/device-masters` (paginated, filterable by line_id, product_name, process)
  - `GET /api/device-masters/{id}` (detail with line_name)
- Create `backend/app/routers/admin_device.py` (admin operations)
  - `POST /api/admin/device-masters/sync` (trigger sync + auto-enrich)
  - `GET/POST/PUT/DELETE /api/admin/sync-source-configs` (sync config CRUD)
- Register routers in `backend/app/main.py`

**Step 7: Frontend API Client + Types**
- Create `frontend/src/types/deviceMaster.ts`: TypeScript interfaces
- Create `frontend/src/api/deviceMaster.ts`: Axios API functions
- Create `frontend/src/hooks/useDeviceMaster.ts`: TanStack Query hooks

**Step 8: Admin UI**
- Create `frontend/src/pages/admin/DeviceMasterPage.tsx`
  - Sub-tab structure: "Device List" (default) | "Meta Sources" (M3)
  - Device List: table (line_name, product_name, process, part_id, is_active, synced_at)
  - Sync button with result display (sync + enrichment summary)
  - Line filter dropdown (reuse `useLines` hook)
  - Product name search input
  - Row click -> DeviceDetailModal
- Add "Device Master" tab to `AdminLayout.tsx` (after "Master Data")
- Add route in `App.tsx`

**Step 9: Tests**
- Backend: sync service unit tests (mock source table data, line resolution)
- Backend: API endpoint tests (list, detail, sync)
- Backend: sync source config CRUD tests
- Frontend: TypeScript build verification

### Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Source table schema unknown or changes | Medium | Configurable via sync_source_config; sync service validates schema before sync |
| Line code mismatch between external data and lines table | Medium | Skip unresolvable records with warning; include in sync error report |
| Large source table causes slow sync | Low | Batch processing with LIMIT/OFFSET if needed; upsert is efficient for PostgreSQL |
| Concurrent sync requests | Low | Use database-level unique constraints for idempotent upserts; optionally add a sync lock |

---

## M2: Layer Master Table + Sync + API

### Priority: Secondary Goal
### Tag: SPEC-DEVICE-001-M2
### Dependency: M1 complete

### Technical Approach

1. **Layer Master model with FK to DeviceMaster (RESTRICT)**: Each layer record belongs to a specific device. This differs from the existing global `layers` table which has no per-product association. RESTRICT prevents accidental device deletion.

2. **layer_id as string with numeric sorting**: Since layer_id values are like "1.0", "2.0", "15.0" (numeric but with decimal), store as String(10) for flexibility. Sort using `CAST(layer_id AS FLOAT)` in queries.

3. **step_seq + descript fields**: `step_seq` varies per device (unlike global layers table). `descript` is from external source and may serve as human-readable layer name.

### Implementation Steps

**Step 1: ORM Model**
- Add `LayerMaster` class to `backend/app/models/device_master.py`
- Fields: id, device_master_id (FK, RESTRICT), layer_id, step_seq, descript, synced_at, created_at, updated_at
- Unique constraint: (device_master_id, layer_id)
- FK: device_master_id -> device_master.id ON DELETE RESTRICT
- Relationship: DeviceMaster.layers (back_populates)

**Step 2: Migration**
- Already included in `018_create_device_layer_master_tables.py` (created in M1)

**Step 3: Pydantic Schemas**
- Add `LayerMasterResponse` to `device_master.py` schemas (includes descript field)
- Add layer-related sync result schema

**Step 4: Sync Service Extension**
- Add `DeviceMasterSyncService.sync_layers(db) -> DeviceSyncResult` method
- Read active sync_source_config where source_type="layer"
- Resolve device_master_id from (line_id via line_code, product_name)
- Upsert into layer_master
- Map descript from source column

**Step 5: API Endpoints**
- Add to `device_masters.py` router:
  - `GET /api/device-masters/{id}/layers` (sorted by CAST(layer_id AS FLOAT))
- Add to `admin_device.py` router:
  - `POST /api/admin/layer-masters/sync` (trigger layer sync)

**Step 6: Frontend Updates**
- Add layer types to `deviceMaster.ts` (includes descript)
- Add `fetchDeviceLayers` API function
- Add `useDeviceLayers` hook
- Add layer table to DeviceDetailModal (columns: layer_id, descript, step_seq, synced_at)
- Add layer sync button in DeviceDetailModal or DeviceMasterPage

**Step 7: Tests**
- Layer sync service tests (line_code resolution, device_master_id mapping)
- Layer API tests (list with numeric sort, FK integrity)
- Layer sync with missing device (error handling, skip + warn)

### Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Device master not yet synced when layer sync runs | Medium | Layer sync resolves device_master_id by (line_code -> line_id, product_name); skip and log if device not found |
| Many layers per device (100+) | Low | Pagination on layer list API if needed; DB index on device_master_id |
| layer_id format varies (e.g., "1.0" vs "1" vs "01") | Medium | Normalize layer_id format during sync; document expected format |
| RESTRICT FK blocks device deletion | Low | By design: prevents accidental deletion; admin must remove layers first |

---

## M3: Device Meta Source Config + Enrichment Service + Admin UI Sub-tab

### Priority: Final Goal
### Tag: SPEC-DEVICE-001-M3
### Dependency: M1 complete

### Technical Approach

1. **Dynamic SQL for enrichment**: The enrichment service builds SQL queries dynamically based on `device_meta_source` configuration. Table names and column names are validated against `information_schema.columns` before execution to prevent SQL injection.

2. **JSONB enrichment storage**: Enrichment results are stored in `device_master.enrichment` as nested JSONB keyed by source_name. This allows multiple enrichment sources without schema changes.

3. **Auto-trigger after sync**: Device sync automatically triggers enrichment for all synced devices. Manual enrichment API also available for on-demand use.

4. **Similar to ExportDataSource pattern**: The `device_meta_source` table follows a similar pattern to the existing `export_data_sources` table (source_name, table_name, join_key_mappings).

### Implementation Steps

**Step 1: ORM Model**
- Add `DeviceMetaSource` class to `backend/app/models/device_master.py`
- Fields: id, source_name (UNIQUE), table_name, schema_name, join_keys (JSONB), column_mappings (JSONB), description, is_active, created_at, updated_at

**Step 2: Migration**
- Already included in `018_create_device_layer_master_tables.py` (created in M1)

**Step 3: Pydantic Schemas**
- Add `DeviceMetaSourceCreate`, `DeviceMetaSourceUpdate`, `DeviceMetaSourceResponse`
- Add `EnrichmentResult`, `EnrichmentSummary`, `ColumnDiscoveryResponse`

**Step 4: Meta Source CRUD Service**
- Create `backend/app/services/device_meta_source_service.py`
- List, create, update, delete operations
- Table/column existence validation on create/update

**Step 5: Enrichment Service**
- Create `backend/app/services/device_enrichment_service.py`
- `enrich_device(db, device_id)`: per-device enrichment
- `enrich_all_devices(db)`: bulk enrichment (only is_active=True devices)
- `discover_columns(db, table_name, schema_name)`: column discovery
- Dynamic query building with parameterized values
- Error isolation per source (one failure does not block others)
- Called automatically from sync_devices() and also available as standalone API

**Step 6: API Endpoints**
- Add to `admin_device.py` router:
  - `POST /api/admin/device-masters/{id}/enrich` (single device)
  - `POST /api/admin/device-masters/enrich-all` (bulk)
  - `GET /api/admin/device-meta-sources` (list)
  - `POST /api/admin/device-meta-sources` (create)
  - `PUT /api/admin/device-meta-sources/{id}` (update)
  - `DELETE /api/admin/device-meta-sources/{id}` (delete)
  - `GET /api/admin/device-meta-sources/discover-columns?table_name=X` (column discovery)

**Step 7: Frontend - Meta Source Admin UI (sub-tab)**
- Add "Meta Sources" sub-tab to DeviceMasterPage
  - List of meta sources with source_name, table_name, is_active, column count
  - CRUD modal (`DeviceMetaSourceFormModal.tsx`)
  - Join key mapping editor (device field -> source column)
  - Column mapping editor (source column -> target field)
  - Column discovery integration (fetch columns when table_name changes)

**Step 8: Frontend - Enrichment Integration**
- Display enrichment data in DeviceDetailModal (collapsible sections keyed by source_name)
- Single device "Enrich" button in DeviceDetailModal
- Sync result includes enrichment summary display

**Step 9: Tests**
- Meta source CRUD service tests
- Enrichment service tests (mock source tables)
- Column discovery tests
- Error handling tests (missing table, missing column)
- SQL injection prevention tests
- Auto-enrich after sync integration tests
- API endpoint tests

### Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Dynamic SQL injection risk | High | Validate table/column names against information_schema; never interpolate user input directly into SQL |
| Source table schema changes break enrichment | Medium | Skip with warning if column not found; log error in enrichment result |
| Performance of bulk enrichment for 1000+ devices | Medium | Batch processing; consider async background task for very large datasets |
| Complex join_keys mapping (multi-column JOIN) | Low | JSONB array format supports multiple key pairs; service iterates all pairs for WHERE clause |

---

## Architecture Design Direction

### Layer Responsibility

```
[Admin Frontend - DeviceMasterPage]
  Sub-tab: Device List / Meta Sources
    |-- useDeviceMaster hooks (TanStack Query)
         |-- GET /api/device-masters (public read)
         |-- POST /api/admin/device-masters/sync (admin, auto-enrich)
         |-- POST /api/admin/device-masters/{id}/enrich (admin)
         |-- CRUD /api/admin/device-meta-sources (admin)
         |-- CRUD /api/admin/sync-source-configs (admin)

[Backend API Layer]
  device_masters.py router (public endpoints)
  admin_device.py router (admin endpoints)

[Backend Service Layer]
  device_master_sync_service.py
    |-- sync_devices(): source table -> device_master (upsert) -> auto-enrich
    |-- sync_layers(): source table -> layer_master (upsert)

  device_enrichment_service.py
    |-- enrich_device(): meta sources -> device_master.enrichment
    |-- enrich_all_devices(): bulk enrichment
    |-- discover_columns(): information_schema query

  device_meta_source_service.py
    |-- CRUD for device_meta_source config

  sync_source_config_service.py
    |-- CRUD for sync_source_config

[Database]
  device_master (synced from external, line_id FK to lines)
  layer_master (synced from external, FK to device_master RESTRICT)
  sync_source_config (configures sync source tables)
  device_meta_source (configures enrichment sources)
  --------
  [External source tables] (read-only, populated by ETL)
```

### Design Principles

1. **Additive, not destructive**: New tables and APIs only. No modification to existing products/layers/project tables
2. **Data foundation, not workflow change**: This SPEC builds the data layer; project creation changes are deferred to SPEC-PROJECT-002
3. **Configurable sync**: Source tables and column mappings are configurable via `sync_source_config`, not hardcoded
4. **Consistent FK patterns**: `line_id` FK to `lines` table, same as Equipment/Product models
5. **RESTRICT over CASCADE**: FK constraints use RESTRICT to prevent accidental data loss
6. **Resilient enrichment**: Individual enrichment failures do not cascade; errors are logged and reported
7. **Auto-enrich after sync**: Enrichment runs automatically after device sync for convenience
8. **Consistent admin patterns**: Follow existing admin UI patterns (MasterDataPage, CRUD modals, TanStack Query invalidation)

### Performance Considerations

- **Sync efficiency**: PostgreSQL `INSERT ... ON CONFLICT DO UPDATE` is highly efficient for batch upsert operations
- **Enrichment queries**: Dynamic SQL queries are simple JOINs; indexed source tables ensure fast lookups
- **Admin UI pagination**: Device master list uses server-side pagination to handle large datasets
- **Expected scale**: ~100-500 devices, ~50-100 layers per device, ~3-5 meta sources
- **Layer sorting**: `CAST(layer_id AS FLOAT)` in ORDER BY for correct numeric ordering
