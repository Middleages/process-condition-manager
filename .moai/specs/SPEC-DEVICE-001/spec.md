# SPEC-DEVICE-001: Device Master & Layer Master Integration

## Metadata

| Item | Value |
|------|-------|
| SPEC ID | SPEC-DEVICE-001 |
| Title | Device Master & Layer Master Integration (External Data Foundation) |
| Status | Completed |
| Priority | High |
| Created | 2026-02-26 |
| Updated | 2026-02-26 |
| Prerequisite SPECs | SPEC-BACKBONE-001 (Dynamic Backbone Eligibility - completed) |
| Phase | Phase 5 (Enhancement) |
| Downstream SPECs | SPEC-PROJECT-002 (Project Creation Refactor - future, consumes device/layer master) |

---

## 1. Environment

### 1.1 Current System State

- **Product data source**: `products` table managed via Admin CRUD and seed scripts. Products are manually created with `product_name`, `description`, `line_id`, `part_id`.
- **Layer data source**: `layers` table is a global pool of ~150 step definitions (`layer_name`, `step_seq`, `layer_number`). Global and shared across all products.
- **Product-layer association**: `product_layers` table links products to layers, originally storing backbone conditions in JSONB. Since SPEC-BACKBONE-001, backbone source shifted to approved `project_layers.conditions`, making `product_layers.conditions` vestigial.
- **Project creation flow**: User selects line -> product -> backbone product -> conditions copied from approved project's `project_layers`.
- **External data**: No current external data integration for product/layer master data. The `export_data_sources` table exists for export pipeline external data, but is unrelated to product/layer master.

### 1.2 Relevant Code

**Backend Models:**
- `backend/app/models/product.py`: `Product` (id, product_name, description, line_id, part_id, created_at), `Layer` (id, layer_name, step_seq, layer_number, sort_order, created_at), `ProductLayer` (id, product_id FK, layer_id FK, conditions JSONB)
- `backend/app/models/project.py`: `Project` (id, product_id FK, main_backbone_id FK, status, revision, is_latest, ...), `ProjectLayer` (id, project_id FK, layer_id FK, conditions JSONB, backbone_conditions JSONB)
- `backend/app/models/line.py`: `Line` (id, line_code, line_name)
- `backend/app/models/equipment.py`: `Equipment` (id, line_id FK, equipment_name, ...) - reference for line-based master data pattern

**Backend Services:**
- `backend/app/services/project_service.py`: `create_project()` - uses backbone product's approved project_layers for conditions
- `backend/app/repositories/backbone_repository.py`: Backbone eligibility queries using approved projects
- `backend/app/services/admin_master_service.py`: CRUD for products, layers, lines (manual management)

**Frontend:**
- `frontend/src/types/master.ts`: `Product`, `Layer` type definitions
- `frontend/src/hooks/useProducts.ts`: Product hooks
- `frontend/src/api/products.ts`: Product API client
- `frontend/src/components/admin/ProductManagementPanel.tsx`: Admin product management
- `frontend/src/components/admin/MasterDataPage.tsx`: Master data management (sub-tabs for Line/Product/Layer/Column/Category)

### 1.3 Gap Analysis

| Current (As-Is) | Target (To-Be) | Gap |
|------------------|-----------------|-----|
| Products manually created/seeded | Products synced from external DB tables (device_master) | New table + sync mechanism needed |
| Layers are global pool, not per-product | Layers are per-product from external DB (layer_master) | New table with device FK needed |
| No external data source config for master data | Configurable sync source + meta source definitions | New config tables needed |
| No auto-enrichment of product metadata | Auto-enrichment with pitch_size, shot_count, etc. from external tables | Enrichment service + auto-trigger after sync |
| `product_layers.conditions` vestigial | Remains unchanged (conditions still from approved project_layers) | No change (backbone source already migrated) |

### 1.4 Technology Stack

- Backend: FastAPI + SQLAlchemy 2.x (async) + Pydantic v2 + PostgreSQL 16
- Frontend: React 18 + TypeScript + Zustand + AG Grid Community + TanStack Query
- Auth: JWT (access/refresh token) + RBAC (admin/reviewer/editor/developer)
- DB: Same PostgreSQL instance; "external tables" are populated by ETL into the same database

---

## 2. Assumptions

| ID | Assumption | Confidence | Basis | Risk (If Wrong) |
|----|-----------|------------|-------|------------------|
| A1 | "External DB" refers to other tables within the same PostgreSQL database, populated by an external ETL process | High | User confirmation: "just other tables in the same PCM database that are populated by ETL" | If truly external DB, need connection pooling to separate instance |
| A2 | Device master sync is periodic batch-based, not real-time CDC | High | User stated "Hybrid approach: periodic batch sync + real-time freshness check on project creation" | If real-time needed, requires triggers or CDC mechanism |
| A3 | Layer matching between products uses `layer_id` (numeric like 1.0, 2.0, 15.0) as the primary key, not `step_seq` | High | User confirmed: "step_seq can differ between products for same layer_id" | If step_seq is the key, FK relationships and matching logic change |
| A4 | This SPEC does NOT modify the project creation flow; it only creates the data foundation | High | User stated: "This SPEC creates the data foundation that SPEC-PROJECT-002 will use" | If project creation changes are expected here, scope would significantly expand |
| A5 | Existing `products`, `layers`, `product_layers` tables remain untouched; migration to device/layer master is a separate future SPEC | High | User stated: "will be gradually migrated (separate SPEC)" | If tables must be deprecated now, migration effort increases |
| A6 | The ETL process that populates source tables is managed externally; PCM only reads from them | High | Logical separation of concerns | If PCM must also write to source tables, bidirectional sync needed |
| A7 | Auto-enrichment fields (pitch_size, shot_count, die_size) come from yet another external table via JOIN, configured in device_meta_source | High | User described: "Auto-enriched fields from yet another external table" | If enrichment data structure changes, meta_source config must be updated |
| A8 | The device_master and layer_master tables are PCM-owned tables that receive synced data, not direct views or foreign tables | High | Sync into "PCM's own DB" implies owned tables | If using foreign data wrappers, different architecture needed |
| A9 | Freshness check on project creation means comparing synced_at with a configurable staleness threshold, not re-syncing on demand | Medium | Reasonable interpretation of "real-time freshness check" | If on-demand re-sync is needed, sync service must be callable from project creation flow |
| A10 | `device_master.line_id` uses FK to existing `lines` table, with sync resolving external line codes via `lines.line_code` | High | User confirmed: consistent with Equipment, Product FK patterns | If external line codes don't match lines.line_code, mapping table needed |
| A11 | Sync source tables are configured via `sync_source_config` table, not hardcoded. Testing uses mock data in the same DB | High | User confirmed: separate config table for flexibility | If hardcoded, future source changes require code changes |
| A12 | Enrichment runs automatically after device sync completes, in addition to being callable on-demand | High | User confirmed: auto-enrich after sync | If manual-only, users must remember to trigger enrichment separately |

---

## 3. Requirements

### M1: Device Master Table + Sync + Admin UI

#### 3.1 Device Master Table

**REQ-DEV-001** [Ubiquitous]
The system shall **always** store device (product) master data in a `device_master` table with the following fields: `id` (PK), `line_id` (FK to lines.id), `product_name` (string, e.g. "LN04LPPM"), `process` (string, e.g. "PFRC"), `part_id` (string, from external table via JOIN), `is_active` (boolean, default true), `enrichment` (JSONB, default {}), `synced_at` (timestamp), `created_at`, `updated_at`.

**REQ-DEV-002** [Ubiquitous]
The system shall **always** maintain a unique constraint on `(line_id, product_name)` within the `device_master` table to prevent duplicate device entries per line.

**REQ-DEV-003** [State-Driven]
**IF** a device record with the same `(line_id, product_name)` already exists in `device_master` **THEN** the sync operation shall update the existing record rather than creating a duplicate.

#### 3.2 Sync Source Configuration

**REQ-DEV-035** [Ubiquitous]
The system shall **always** store sync source table configurations in a `sync_source_config` table with the following fields: `id` (PK), `source_type` (string, enum: "device", "layer"), `source_name` (string, unique per source_type), `table_name` (string - source table in same DB), `schema_name` (string, default "public"), `column_mappings` (JSONB - mapping of source columns to target fields), `description` (text, nullable), `is_active` (boolean), `created_at`, `updated_at`.

**REQ-DEV-036** [Event-Driven]
**WHEN** a sync operation is triggered **THEN** the system shall read the active `sync_source_config` for the appropriate source_type to determine which table and column mappings to use.

#### 3.3 Device Master Sync Service

**REQ-DEV-004** [Event-Driven]
**WHEN** the device master sync is triggered (via API or scheduled job) **THEN** the system shall read from the configured external source table (per `sync_source_config` where source_type="device"), resolve `line_id` by matching external line codes against `lines.line_code`, join with the part_id source if configured, and upsert records into the `device_master` table.

**REQ-DEV-005** [Ubiquitous]
The system shall **always** update the `synced_at` timestamp on each device record during a sync operation to track data freshness, including records where data is unchanged.

**REQ-DEV-006** [Unwanted]
The system shall **not** delete existing `device_master` records during sync if they no longer appear in the source table. Records not present in source shall retain their existing data and `synced_at` shall NOT be updated (stale indicator). The `is_active` field may be used in future to mark stale records.

**REQ-DEV-007** [Event-Driven]
**WHEN** the sync API is called **THEN** the system shall return a summary including: total records processed, records inserted, records updated, records unchanged, and any errors encountered.

**REQ-DEV-037** [Event-Driven]
**WHEN** device sync completes successfully **THEN** the system shall automatically trigger enrichment for all synced devices using active `device_meta_source` configurations.

#### 3.4 Device Master CRUD API

**REQ-DEV-008** [Event-Driven]
**WHEN** an authenticated user requests the device master list via `GET /api/device-masters` **THEN** the system shall return paginated device records with optional filters for `line_id`, `product_name`, and `process`.

**REQ-DEV-009** [Event-Driven]
**WHEN** an admin or developer user triggers a sync via `POST /api/admin/device-masters/sync` **THEN** the system shall execute the sync operation followed by auto-enrichment and return both sync and enrichment summaries.

#### 3.5 Device Master Admin UI

**REQ-DEV-030** [Event-Driven]
**WHEN** an admin or developer user navigates to the Admin > Device Master page **THEN** the system shall display a table of all device master records with columns: line_name (resolved from line_id), product_name, process, part_id, synced_at, is_active.

**REQ-DEV-031** [Event-Driven]
**WHEN** an admin or developer user clicks the "Sync" button on the Device Master admin page **THEN** the system shall trigger the device master sync API (which includes auto-enrichment) and display the sync + enrichment result summary.

**REQ-DEV-032** [Optional]
**Where** filtering is available, the Device Master admin page shall provide filter controls for line (dropdown) and product_name (search) to narrow the displayed records.

---

### M2: Layer Master Table + API

#### 3.6 Layer Master Table

**REQ-DEV-010** [Ubiquitous]
The system shall **always** store per-device layer definitions in a `layer_master` table with the following fields: `id` (PK), `device_master_id` (FK to device_master), `layer_id` (string, e.g. "1.0", "2.0", "15.0" - numeric identifier), `step_seq` (string, e.g. "vu500000", "cd700000" - equipment step sequence code), `descript` (string, nullable - layer description, may serve as layer name), `synced_at` (timestamp), `created_at`, `updated_at`.

**REQ-DEV-011** [Ubiquitous]
The system shall **always** maintain a unique constraint on `(device_master_id, layer_id)` within the `layer_master` table to prevent duplicate layer entries per device.

**REQ-DEV-012** [Event-Driven]
**WHEN** the layer master sync is triggered **THEN** the system shall read per-device layer definitions from the configured external source table (per `sync_source_config` where source_type="layer") and upsert records into the `layer_master` table.

**REQ-DEV-013** [State-Driven]
**IF** a layer record with the same `(device_master_id, layer_id)` already exists **THEN** the sync operation shall update the existing record (e.g., step_seq or descript changes) rather than creating a duplicate.

**REQ-DEV-014** [Event-Driven]
**WHEN** a client requests layers for a specific device via `GET /api/device-masters/{id}/layers` **THEN** the system shall return all layer_master records for that device, sorted by `CAST(layer_id AS FLOAT)` for correct numeric ordering.

**REQ-DEV-015** [Event-Driven]
**WHEN** an admin or developer user triggers layer sync via `POST /api/admin/layer-masters/sync` **THEN** the system shall execute the layer sync operation and return a summary.

**REQ-DEV-016** [Unwanted]
The system shall **not** allow a `layer_master` record to reference a non-existent `device_master_id`. Database-level FK constraint (RESTRICT) shall enforce this.

**REQ-DEV-017** [State-Driven]
**IF** a `device_master` record deletion is attempted while associated `layer_master` records exist **THEN** the deletion shall be blocked (RESTRICT) to prevent accidental data loss. Layer records must be explicitly removed first.

---

### M3: Device Meta Enrichment

#### 3.7 Device Meta Source Configuration

**REQ-DEV-020** [Ubiquitous]
The system shall **always** store enrichment data source configurations in a `device_meta_source` table with the following fields: `id` (PK), `source_name` (string, unique), `table_name` (string - source table in same DB), `schema_name` (string, default "public"), `join_keys` (JSONB - mapping of device_master fields to source table columns), `column_mappings` (JSONB - mapping of source columns to device_master enrichment fields), `description` (text, nullable), `is_active` (boolean), `created_at`, `updated_at`.

**REQ-DEV-021** [Event-Driven]
**WHEN** an admin or developer user creates or updates a device_meta_source record via CRUD API **THEN** the system shall validate that the referenced `table_name` exists in the database and that the mapped columns exist in the source table.

**REQ-DEV-022** [Optional]
**Where** column validation is available, the system shall provide an API endpoint to discover available columns from a given table name for use in the Admin UI's column mapping interface.

#### 3.8 Auto-Enrichment

**REQ-DEV-023** [Event-Driven]
**WHEN** the enrichment process is triggered for a device (automatically after sync or via manual API call) **THEN** the system shall query each active `device_meta_source`, JOIN with the device record using configured `join_keys`, and populate the device's enrichment fields with the values from `column_mappings`.

**REQ-DEV-024** [Ubiquitous]
The system shall **always** store enrichment results in the `enrichment` JSONB column on the `device_master` table, keyed by source_name, to support multiple enrichment sources.

**REQ-DEV-025** [Event-Driven]
**WHEN** the enrichment API `POST /api/admin/device-masters/{id}/enrich` is called **THEN** the system shall execute enrichment for the specified device and return the enriched data.

**REQ-DEV-026** [Event-Driven]
**WHEN** a bulk enrichment API `POST /api/admin/device-masters/enrich-all` is called **THEN** the system shall execute enrichment for all active devices and return a summary.

**REQ-DEV-027** [Unwanted]
The system shall **not** fail the entire enrichment operation if a single device's enrichment encounters an error. Errors shall be logged and the operation shall continue with remaining devices.

**REQ-DEV-028** [State-Driven]
**IF** a configured `device_meta_source` references a table or column that no longer exists **THEN** the enrichment for that source shall be skipped with a warning, not crash the entire process.

#### 3.9 Device Master Admin UI (Combined Tab)

**REQ-DEV-033** [Event-Driven]
**WHEN** an admin or developer user navigates to Admin > Device Master **THEN** the system shall display a single admin tab with internal sub-tabs: "Device List" (default) and "Meta Sources".

**REQ-DEV-034** [Event-Driven]
**WHEN** creating or editing a meta source in the "Meta Sources" sub-tab **THEN** the system shall provide a form with: source_name, table_name (with table discovery), join_keys mapping editor, column_mappings editor, and description.

---

## 4. Specifications

### 4.1 DB Schema Design

#### New Table: `device_master`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | Integer | PK, auto-increment | Primary key |
| line_id | Integer | FK(lines.id, RESTRICT), NOT NULL, INDEX | Production line reference |
| product_name | String(100) | NOT NULL, INDEX | Device/product name (e.g., "LN04LPPM") |
| process | String(50) | NOT NULL | Process type (e.g., "PFRC") |
| part_id | String(100) | NULLABLE | Part identifier from external JOIN |
| is_active | Boolean | DEFAULT true | Active flag for soft-retain on sync |
| enrichment | JSONB | DEFAULT '{}' | Auto-enriched metadata keyed by source_name |
| synced_at | DateTime(tz) | NULLABLE | Last sync timestamp |
| created_at | DateTime(tz) | server_default=now() | Record creation time |
| updated_at | DateTime(tz) | server_default=now(), onupdate=now() | Last update time |

**Constraints:**
- UNIQUE: `(line_id, product_name)`
- INDEX: `idx_device_master_line_id` on `line_id`
- INDEX: `idx_device_master_product_name` on `product_name`
- FK: `line_id` REFERENCES `lines(id)` ON DELETE RESTRICT

#### New Table: `layer_master`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | Integer | PK, auto-increment | Primary key |
| device_master_id | Integer | FK(device_master.id, RESTRICT), NOT NULL, INDEX | Parent device reference |
| layer_id | String(10) | NOT NULL | Numeric layer identifier (e.g., "1.0", "2.0", "15.0") |
| step_seq | String(20) | NULLABLE | Equipment step sequence code (e.g., "vu500000") |
| descript | String(200) | NULLABLE | Layer description (may serve as human-readable layer name) |
| synced_at | DateTime(tz) | NULLABLE | Last sync timestamp |
| created_at | DateTime(tz) | server_default=now() | Record creation time |
| updated_at | DateTime(tz) | server_default=now(), onupdate=now() | Last update time |

**Constraints:**
- UNIQUE: `(device_master_id, layer_id)`
- INDEX: `idx_layer_master_device_id` on `device_master_id`
- FK: `device_master_id` REFERENCES `device_master(id)` ON DELETE RESTRICT

#### New Table: `sync_source_config`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | Integer | PK, auto-increment | Primary key |
| source_type | String(20) | NOT NULL | Type: "device" or "layer" |
| source_name | String(100) | NOT NULL | Human-readable source identifier |
| table_name | String(200) | NOT NULL | Source table name in same DB |
| schema_name | String(50) | DEFAULT "public" | Database schema |
| column_mappings | JSONB | NOT NULL | Mapping of source columns to target fields |
| description | Text | NULLABLE | Source description |
| is_active | Boolean | DEFAULT true | Active flag |
| created_at | DateTime(tz) | server_default=now() | Record creation time |
| updated_at | DateTime(tz) | server_default=now(), onupdate=now() | Last update time |

**Constraints:**
- UNIQUE: `(source_type, source_name)`

#### New Table: `device_meta_source`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | Integer | PK, auto-increment | Primary key |
| source_name | String(100) | UNIQUE, NOT NULL | Human-readable source identifier |
| table_name | String(200) | NOT NULL | Source table name in same DB |
| schema_name | String(50) | DEFAULT "public" | Database schema |
| join_keys | JSONB | NOT NULL | Key mapping: `[{device_field, source_column}]` |
| column_mappings | JSONB | NOT NULL | Value mapping: `[{source_column, target_field}]` |
| description | Text | NULLABLE | Source description |
| is_active | Boolean | DEFAULT true | Active flag |
| created_at | DateTime(tz) | server_default=now() | Record creation time |
| updated_at | DateTime(tz) | server_default=now(), onupdate=now() | Last update time |

### 4.2 Alembic Migrations

| Migration | Description |
|-----------|-------------|
| `018_create_device_layer_master_tables.py` | Create all 4 tables: `device_master`, `layer_master`, `sync_source_config`, `device_meta_source` with all indexes, constraints, and FKs in a single migration |

Single migration for atomic deploy/rollback. DOWN drops all 4 tables in reverse dependency order.

### 4.3 API Design

#### Public API (Authenticated Users)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/device-masters` | List device masters with pagination and filters | require_auth |
| GET | `/api/device-masters/{id}` | Get single device master detail with line_name | require_auth |
| GET | `/api/device-masters/{id}/layers` | List layers for a device (sorted by CAST(layer_id AS FLOAT)) | require_auth |

#### Admin API (Admin/Developer Only)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/admin/device-masters/sync` | Trigger device master sync + auto-enrich | require_admin_or_developer |
| POST | `/api/admin/layer-masters/sync` | Trigger layer master sync from source | require_admin_or_developer |
| POST | `/api/admin/device-masters/{id}/enrich` | Enrich single device with meta sources | require_admin_or_developer |
| POST | `/api/admin/device-masters/enrich-all` | Bulk enrich all active devices | require_admin_or_developer |
| GET | `/api/admin/device-meta-sources` | List meta source configs | require_admin_or_developer |
| POST | `/api/admin/device-meta-sources` | Create meta source config | require_admin_or_developer |
| PUT | `/api/admin/device-meta-sources/{id}` | Update meta source config | require_admin_or_developer |
| DELETE | `/api/admin/device-meta-sources/{id}` | Delete meta source config | require_admin_or_developer |
| GET | `/api/admin/device-meta-sources/discover-columns` | Discover columns for a table name | require_admin_or_developer |
| GET | `/api/admin/sync-source-configs` | List sync source configs | require_admin_or_developer |
| POST | `/api/admin/sync-source-configs` | Create sync source config | require_admin_or_developer |
| PUT | `/api/admin/sync-source-configs/{id}` | Update sync source config | require_admin_or_developer |
| DELETE | `/api/admin/sync-source-configs/{id}` | Delete sync source config | require_admin_or_developer |

#### Pydantic Schemas

```python
# Device Master schemas
class DeviceMasterResponse(BaseModel):
    id: int
    line_id: int
    line_name: str  # resolved from lines table
    product_name: str
    process: str
    part_id: str | None
    is_active: bool
    enrichment: dict
    synced_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class DeviceMasterListResponse(BaseModel):
    items: list[DeviceMasterResponse]
    total: int
    page: int
    size: int

class DeviceSyncResult(BaseModel):
    total_processed: int
    inserted: int
    updated: int
    unchanged: int
    errors: list[str]
    enrichment_summary: EnrichmentSummary | None  # auto-enrich results

class EnrichmentSummary(BaseModel):
    devices_enriched: int
    total_errors: int
    details: list[EnrichmentResult]

# Layer Master schemas
class LayerMasterResponse(BaseModel):
    id: int
    device_master_id: int
    layer_id: str
    step_seq: str | None
    descript: str | None
    synced_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

# Sync Source Config schemas
class SyncSourceConfigCreate(BaseModel):
    source_type: Literal["device", "layer"]
    source_name: str
    table_name: str
    schema_name: str = "public"
    column_mappings: list[dict]  # [{source_column, target_field}]
    description: str | None = None
    is_active: bool = True

class SyncSourceConfigResponse(BaseModel):
    id: int
    source_type: str
    source_name: str
    table_name: str
    schema_name: str
    column_mappings: list[dict]
    description: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

# Device Meta Source schemas
class DeviceMetaSourceCreate(BaseModel):
    source_name: str
    table_name: str
    schema_name: str = "public"
    join_keys: list[dict]  # [{device_field, source_column}]
    column_mappings: list[dict]  # [{source_column, target_field}]
    description: str | None = None
    is_active: bool = True

class DeviceMetaSourceResponse(BaseModel):
    id: int
    source_name: str
    table_name: str
    schema_name: str
    join_keys: list[dict]
    column_mappings: list[dict]
    description: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class EnrichmentResult(BaseModel):
    device_id: int
    product_name: str
    sources_processed: int
    fields_enriched: list[str]
    errors: list[str]
```

### 4.4 Service Layer Design

#### DeviceMasterSyncService

```python
class DeviceMasterSyncService:
    """Sync device master data from external source tables."""

    @staticmethod
    async def sync_devices(db: AsyncSession, auto_enrich: bool = True) -> DeviceSyncResult:
        """
        1. Read active sync_source_config where source_type="device"
        2. Query source table using configured column_mappings
        3. Resolve line_id by matching external line codes against lines.line_code
        4. Upsert into device_master with INSERT ... ON CONFLICT (line_id, product_name) DO UPDATE
        5. Update synced_at on all synced records (including unchanged)
        6. If auto_enrich=True, trigger enrichment for all synced devices
        7. Return sync + enrichment summary
        """

    @staticmethod
    async def sync_layers(db: AsyncSession) -> DeviceSyncResult:
        """
        1. Read active sync_source_config where source_type="layer"
        2. Query source table
        3. Resolve device_master_id by matching (line_id, product_name)
        4. Upsert into layer_master with INSERT ... ON CONFLICT (device_master_id, layer_id) DO UPDATE
        5. Return sync summary
        """
```

#### DeviceEnrichmentService

```python
class DeviceEnrichmentService:
    """Auto-enrich device master records from configured meta sources."""

    @staticmethod
    async def enrich_device(
        db: AsyncSession, device_id: int
    ) -> EnrichmentResult:
        """
        For each active device_meta_source:
        1. Build dynamic query: SELECT source_columns FROM table WHERE join_keys match
        2. Validate table/column names against information_schema
        3. Execute query with parameterized values
        4. Map results to device_master.enrichment[source_name] JSONB
        """

    @staticmethod
    async def enrich_all_devices(
        db: AsyncSession
    ) -> EnrichmentSummary:
        """Bulk enrichment for all active (is_active=True) devices."""

    @staticmethod
    async def discover_columns(
        db: AsyncSession, table_name: str, schema_name: str = "public"
    ) -> list[dict]:
        """
        Query information_schema.columns to discover available columns
        for a given table. Used by Admin UI for column mapping.
        """
```

#### DeviceMetaSourceService

```python
class DeviceMetaSourceService:
    """CRUD for device meta source configurations."""

    @staticmethod
    async def list_sources(db: AsyncSession) -> list[DeviceMetaSource]:
        ...

    @staticmethod
    async def create_source(
        db: AsyncSession, data: DeviceMetaSourceCreate
    ) -> DeviceMetaSource:
        """Validate table/column existence before creation."""

    @staticmethod
    async def update_source(
        db: AsyncSession, source_id: int, data: DeviceMetaSourceUpdate
    ) -> DeviceMetaSource:
        ...

    @staticmethod
    async def delete_source(db: AsyncSession, source_id: int) -> None:
        ...
```

#### SyncSourceConfigService

```python
class SyncSourceConfigService:
    """CRUD for sync source table configurations."""

    @staticmethod
    async def list_configs(db: AsyncSession, source_type: str | None = None) -> list[SyncSourceConfig]:
        ...

    @staticmethod
    async def create_config(
        db: AsyncSession, data: SyncSourceConfigCreate
    ) -> SyncSourceConfig:
        """Validate table existence before creation."""

    @staticmethod
    async def update_config(
        db: AsyncSession, config_id: int, data: SyncSourceConfigUpdate
    ) -> SyncSourceConfig:
        ...

    @staticmethod
    async def delete_config(db: AsyncSession, config_id: int) -> None:
        ...
```

### 4.5 Sync Strategy Detail

**Source Table Configuration:**
The sync service reads source table names and column mappings from the `sync_source_config` table. Each source_type ("device", "layer") has its own configuration. During testing, mock tables are created in the same database to simulate external ETL data.

**Line Resolution:**
When syncing devices, the external source provides line codes as strings (e.g., "S3", "S5"). The sync service resolves these to `line_id` by querying `lines` table WHERE `line_code = source_line_value`. Records with unresolvable line codes are skipped with a warning.

**Batch Sync Flow:**
1. Read active `sync_source_config` for the target source_type
2. Query source table with SELECT using configured column_mappings
3. For device sync: resolve line_id from lines.line_code
4. For layer sync: resolve device_master_id from (line_id, product_name)
5. Use PostgreSQL `INSERT ... ON CONFLICT DO UPDATE` (upsert) for atomic sync
6. Update `synced_at` on all synced records (including unchanged data)
7. For device sync: auto-trigger enrichment after sync
8. Return sync summary (+ enrichment summary for device sync)

**Freshness Check:**
- `synced_at` on each record tracks when it was last synced
- Records not in source during sync retain old `synced_at` (stale indicator)
- Future SPEC-PROJECT-002 may check `synced_at` staleness before project creation
- This SPEC only stores the timestamp; freshness threshold logic is deferred

**Enrichment Flow (auto-triggered after device sync):**
1. Read all active `device_meta_source` records
2. For each source, build a dynamic SQL query:
   - Validate table_name and column names against `information_schema`
   - `SELECT column_mappings.source_columns FROM table_name WHERE join_keys match device fields`
3. Execute query via `db.execute(text(query), params)` with parameterized values
4. Store results in `device_master.enrichment[source_name]` JSONB
5. Errors per device/source are isolated and logged

### 4.6 Data Flow Diagram

```
[External ETL Process]
    |
    v
[Source Tables in Same PostgreSQL DB]
    |  (populated by ETL, read-only from PCM perspective)
    |
    v
[sync_source_config]  <-- configures which tables/columns to read
    |
    v
[PCM Sync Service]  <-- triggered by Admin API or scheduled job
    |
    |-- sync_devices() --> device_master table (upsert)
    |       |                  |
    |       |                  v  (auto-trigger)
    |       |           [PCM Enrichment Service]
    |       |                  |
    |       |                  |-- For each active device_meta_source:
    |       |                  |     query source table --> populate enrichment JSONB
    |       |                  v
    |       |           device_master.enrichment updated
    |       |
    |-- sync_layers()  --> layer_master table (upsert)
    |
    v
[device_master + layer_master]  (PCM-owned, synced + enriched data)
    |
    v
[Future: SPEC-PROJECT-002 consumes this data for project creation]
```

### 4.7 Frontend Components

#### Admin UI Additions

**DeviceMasterPage** (`frontend/src/pages/admin/DeviceMasterPage.tsx`)
- Single admin tab with 2 internal sub-tabs: "Device List" (default), "Meta Sources"
- **Device List sub-tab:**
  - Table view: line_name, product_name, process, part_id, is_active, enrichment summary, synced_at
  - Sync button: triggers `POST /api/admin/device-masters/sync` (includes auto-enrich)
  - Sync + enrichment result toast/modal
  - Filters: line dropdown (reuse useLines hook), product_name search
  - Row click: show device detail modal with enrichment data and layer list
  - Layer sync button within device detail
- **Meta Sources sub-tab:**
  - List of meta source configurations
  - CRUD modal: source_name, table_name, join_keys mapping editor, column_mappings editor
  - Column discovery: when table_name is entered, fetch available columns for mapping

**DeviceDetailModal** (`frontend/src/components/admin/DeviceDetailModal.tsx`)
- Device info: line_name, product_name, process, part_id, is_active
- Enrichment data display (collapsible, keyed by source_name)
- Layer table: layer_id, descript, step_seq, synced_at (sorted by layer_id numerically)
- Enrich button: single device enrichment
- Layer sync button

**DeviceMetaSourceFormModal** (`frontend/src/components/admin/DeviceMetaSourceFormModal.tsx`)
- source_name, table_name (with discovery), join_keys mapping editor, column_mappings editor, description
- Column discovery integration

#### Admin Layout Integration

Add one new Admin tab: "Device Master" (after existing "Master Data" tab).

Updated Admin tab order:
User Management | Master Data | **Device Master** | Select Options | XML Mapping | Validation Rules | Export Systems | External Data | Audit Log

### 4.8 Backward Compatibility

- **No changes to existing tables**: `products`, `layers`, `product_layers` remain untouched
- **No changes to project creation**: Current flow using `products`/`layers` continues as-is
- **No changes to backbone logic**: SPEC-BACKBONE-001 logic is unaffected
- **Additive only**: All changes are new tables, new APIs, new UI components
- **Coexistence**: `device_master` and `products` tables coexist independently until future migration SPEC

### 4.9 Security

- Public read APIs (`GET /api/device-masters`, `GET /api/device-masters/{id}/layers`): `require_auth` dependency (any authenticated user)
- Admin sync/enrich/CRUD APIs: `require_admin_or_developer` dependency (RBAC)
- Dynamic SQL in enrichment service: Use parameterized queries to prevent SQL injection. Table/column names validated against `information_schema` before use
- No new secrets or credentials required (same DB connection)

### 4.10 Traceability Tags

| Tag | Scope |
|-----|-------|
| SPEC-DEVICE-001 | Full SPEC |
| SPEC-DEVICE-001-M1 | Device Master table + sync source config + sync + CRUD API + Admin UI |
| SPEC-DEVICE-001-M2 | Layer Master table + sync + API |
| SPEC-DEVICE-001-M3 | Device Meta Source config + enrichment service + Admin UI sub-tab |

### 4.11 Affected Files

#### New Files

**Backend:**
- `backend/app/models/device_master.py` - DeviceMaster, LayerMaster, SyncSourceConfig, DeviceMetaSource ORM models
- `backend/app/schemas/device_master.py` - Pydantic schemas for all device/layer/sync/meta APIs
- `backend/app/services/device_master_sync_service.py` - Sync service (batch upsert from source tables + auto-enrich)
- `backend/app/services/device_enrichment_service.py` - Enrichment service (dynamic query + JSONB update)
- `backend/app/services/device_meta_source_service.py` - Meta source CRUD service
- `backend/app/services/sync_source_config_service.py` - Sync source config CRUD service
- `backend/app/routers/device_masters.py` - Public API endpoints (list, detail, layers)
- `backend/app/routers/admin_device.py` - Admin API endpoints (sync, enrich, meta source CRUD, sync config CRUD)
- `backend/alembic/versions/018_create_device_layer_master_tables.py` - All 4 tables in single migration

**Frontend:**
- `frontend/src/api/deviceMaster.ts` - API client functions
- `frontend/src/types/deviceMaster.ts` - TypeScript type definitions
- `frontend/src/hooks/useDeviceMaster.ts` - TanStack Query hooks
- `frontend/src/pages/admin/DeviceMasterPage.tsx` - Admin device master page (with sub-tabs)
- `frontend/src/components/admin/DeviceDetailModal.tsx` - Device detail with layers and enrichment
- `frontend/src/components/admin/DeviceMetaSourceFormModal.tsx` - Meta source CRUD form

#### Modified Files

**Backend:**
- `backend/app/models/__init__.py` - Import new models
- `backend/app/main.py` - Register new routers

**Frontend:**
- `frontend/src/App.tsx` - Add admin route for DeviceMasterPage
- `frontend/src/components/layout/AdminLayout.tsx` - Add "Device Master" tab
- `frontend/src/types/index.ts` - Re-export new types

#### No Changes Required

- `backend/app/models/product.py` - Existing products/layers/product_layers unchanged
- `backend/app/models/project.py` - Project model unchanged
- `backend/app/services/project_service.py` - Project creation unchanged (deferred to SPEC-PROJECT-002)
- `backend/app/repositories/backbone_repository.py` - Backbone logic unchanged
