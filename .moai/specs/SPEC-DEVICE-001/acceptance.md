# SPEC-DEVICE-001: Acceptance Criteria

## Traceability Tag: SPEC-DEVICE-001

---

## M1: Device Master Table + Sync Source Config + Sync + CRUD API + Admin UI

### AC-1.1: Device Master Table Schema

**Given** the database migration 018 is applied
**When** querying the `device_master` table schema
**Then** the table shall have columns: id (PK), line_id (INTEGER FK NOT NULL), product_name (VARCHAR NOT NULL), process (VARCHAR NOT NULL), part_id (VARCHAR NULLABLE), is_active (BOOLEAN DEFAULT true), enrichment (JSONB DEFAULT '{}'), synced_at (TIMESTAMPTZ NULLABLE), created_at (TIMESTAMPTZ), updated_at (TIMESTAMPTZ)
**And** a unique constraint on (line_id, product_name) shall exist
**And** a FK constraint on line_id referencing lines(id) with RESTRICT shall exist
**And** indexes on `line_id` and `product_name` shall exist

### AC-1.2: Sync Source Config Table Schema

**Given** the database migration 018 is applied
**When** querying the `sync_source_config` table schema
**Then** the table shall have columns: id (PK), source_type (VARCHAR NOT NULL), source_name (VARCHAR NOT NULL), table_name (VARCHAR NOT NULL), schema_name (VARCHAR DEFAULT 'public'), column_mappings (JSONB NOT NULL), description (TEXT NULLABLE), is_active (BOOLEAN DEFAULT true), created_at, updated_at
**And** a unique constraint on (source_type, source_name) shall exist

### AC-1.3: Device Master Sync - Insert New Records

**Given** the source table contains 5 device records that do not exist in `device_master`
**And** a sync_source_config for source_type="device" is configured
**When** `POST /api/admin/device-masters/sync` is called
**Then** 5 new records shall be inserted into `device_master`
**And** each record's `line_id` shall be resolved from the external line code via `lines.line_code`
**And** the response shall include `inserted: 5, updated: 0, unchanged: 0`
**And** all records shall have `synced_at` set to the current timestamp

### AC-1.4: Device Master Sync - Line Code Resolution

**Given** the source table contains a device with line code "S3"
**And** the `lines` table has a record with `line_code = "S3"` and `id = 1`
**When** sync is triggered
**Then** the device_master record shall have `line_id = 1`

### AC-1.5: Device Master Sync - Unresolvable Line Code

**Given** the source table contains a device with line code "UNKNOWN"
**And** no `lines` record has `line_code = "UNKNOWN"`
**When** sync is triggered
**Then** the device with "UNKNOWN" line code shall be skipped
**And** the error shall be included in the sync result's `errors` list
**And** other devices shall still be synced successfully

### AC-1.6: Device Master Sync - Update Existing Records

**Given** the source table contains a device "S3/LN04LPPM" with process "PFRC"
**And** `device_master` already has "S3/LN04LPPM" (via line_id) with process "XFRC" (outdated)
**When** sync is triggered
**Then** the existing record shall be updated with process "PFRC"
**And** `synced_at` shall be refreshed
**And** the response shall include `updated: 1`

### AC-1.7: Device Master Sync - Unchanged Data Still Updates synced_at

**Given** `device_master` already contains identical data to the source table
**When** sync is triggered
**Then** `synced_at` shall be updated on all matched records (as a freshness indicator)
**And** the response shall include `unchanged: N` (where N = total records with identical data)

### AC-1.8: Device Master Sync - No Deletion

**Given** `device_master` contains device "S3/OLD_PRODUCT"
**And** the source table no longer contains this device
**When** sync is triggered
**Then** "S3/OLD_PRODUCT" shall remain in `device_master` (no deletion)
**And** its `synced_at` shall NOT be updated (stale indicator)

### AC-1.9: Device Master Sync - Unique Constraint Enforcement

**Given** the source table contains two records with the same (line, product_name)
**When** sync is triggered
**Then** only one record shall exist in `device_master` for that (line_id, product_name) combination
**And** the last-processed record's values shall be retained

### AC-1.10: Device Master Sync - Auto-Enrichment

**Given** active device_meta_source configurations exist
**When** `POST /api/admin/device-masters/sync` is called
**Then** after sync completes, enrichment shall automatically run for all synced devices
**And** the response shall include both sync summary and enrichment summary

### AC-1.11: Device Master List API - Basic

**Given** `device_master` contains 25 records
**When** `GET /api/device-masters?page=1&size=10` is called by an authenticated user
**Then** the response shall contain `items` (10 records with line_name resolved), `total: 25`, `page: 1`, `size: 10`

### AC-1.12: Device Master List API - Line Filter

**Given** `device_master` contains 10 records with line_id=1 and 15 with line_id=2
**When** `GET /api/device-masters?line_id=1` is called
**Then** only the 10 records with line_id=1 shall be returned

### AC-1.13: Device Master List API - Product Name Search

**Given** `device_master` contains records including "LN04LPPM" and "LN04LPPN"
**When** `GET /api/device-masters?product_name=LN04` is called
**Then** both "LN04LPPM" and "LN04LPPN" shall be returned (partial match)

### AC-1.14: Device Master Detail API

**Given** device_master record with id=5 exists
**When** `GET /api/device-masters/5` is called
**Then** the full device record shall be returned including enrichment data and line_name

### AC-1.15: Device Master Sync - Auth Enforcement

**Given** a user with only "editor" role (no admin or developer role)
**When** `POST /api/admin/device-masters/sync` is called
**Then** HTTP 403 Forbidden shall be returned

### AC-1.16: Admin UI - Device Master Page

**Given** an admin or developer user navigates to the Device Master admin page
**When** the page loads
**Then** a table of device master records shall be displayed with columns: line_name, product_name, process, part_id, is_active, synced_at
**And** a "Sync" button shall be visible
**And** line filter dropdown and product name search input shall be available
**And** sub-tabs "Device List" and "Meta Sources" shall be visible

### AC-1.17: Admin UI - Sync Button

**Given** the admin user is on the Device Master page
**When** the "Sync" button is clicked
**Then** the sync API shall be called
**And** a result summary (inserted/updated/unchanged/errors + enrichment summary) shall be displayed
**And** the table shall refresh to show updated data

### AC-1.18: Migration Rollback

**Given** migration 018 has been applied
**When** `alembic downgrade -1` is executed
**Then** all 4 tables (device_meta_source, sync_source_config, layer_master, device_master) shall be dropped in reverse dependency order
**And** no other tables shall be affected

### AC-1.19: Sync Source Config CRUD

**Given** an admin user creates a sync source config with source_type="device", table_name="ext_device_table"
**When** `POST /api/admin/sync-source-configs` is called
**Then** the config shall be created
**And** the config shall be returned with id and all fields

---

## M2: Layer Master Table + Sync + API

### AC-2.1: Layer Master Table Schema

**Given** migration 018 is applied
**When** querying the `layer_master` table schema
**Then** the table shall have columns: id (PK), device_master_id (FK NOT NULL), layer_id (VARCHAR NOT NULL), step_seq (VARCHAR NULLABLE), descript (VARCHAR NULLABLE), synced_at (TIMESTAMPTZ NULLABLE), created_at (TIMESTAMPTZ), updated_at (TIMESTAMPTZ)
**And** a unique constraint on (device_master_id, layer_id) shall exist
**And** FK constraint on device_master_id referencing device_master(id) with RESTRICT shall exist

### AC-2.2: Layer Master Sync - Insert

**Given** device "S3/LN04LPPM" exists in `device_master` with id=1
**And** a sync_source_config for source_type="layer" is configured
**And** the source table contains 40 layer records for this device
**When** layer sync is triggered
**Then** 40 layer_master records shall be created with device_master_id=1
**And** each record shall have the correct layer_id, step_seq, and descript from source

### AC-2.3: Layer Master Sync - Device Not Found

**Given** the source table references device "S3/UNKNOWN" that does not exist in `device_master`
**When** layer sync is triggered
**Then** the layers for "S3/UNKNOWN" shall be skipped with a logged warning
**And** the sync shall continue processing other devices
**And** the error count shall include the skipped records

### AC-2.4: Layer Master Sync - Update step_seq

**Given** layer_master has record (device_master_id=1, layer_id="5.0", step_seq="vu500000")
**And** the source now shows step_seq="vu500001" for the same device/layer
**When** layer sync is triggered
**Then** the step_seq shall be updated to "vu500001"
**And** synced_at shall be refreshed

### AC-2.5: Layer List API - Numeric Sort

**Given** device_master record id=1 has layer_master records with layer_id values: "1.0", "2.0", "15.0", "3.0"
**When** `GET /api/device-masters/1/layers` is called
**Then** layers shall be returned in order: "1.0", "2.0", "3.0", "15.0" (numeric order via CAST)
**And** each record shall include layer_id, step_seq, descript, synced_at

### AC-2.6: Layer List - Non-existent Device

**Given** no device_master record with id=999 exists
**When** `GET /api/device-masters/999/layers` is called
**Then** HTTP 404 Not Found shall be returned

### AC-2.7: RESTRICT FK - Block Device Deletion

**Given** device_master id=1 has 30 associated layer_master records
**When** an attempt to delete device_master id=1 is made
**Then** the deletion shall be blocked with an FK constraint violation error
**And** all 30 layer_master records shall remain intact

### AC-2.8: Layer Master Unique Constraint

**Given** layer_master already has (device_master_id=1, layer_id="5.0")
**When** an attempt to insert another record with (device_master_id=1, layer_id="5.0") is made
**Then** a unique constraint violation shall be raised
**And** the sync service shall handle this via ON CONFLICT DO UPDATE

### AC-2.9: Layer Master Sync - Auth Enforcement

**Given** a user with only "editor" role
**When** `POST /api/admin/layer-masters/sync` is called
**Then** HTTP 403 Forbidden shall be returned

### AC-2.10: Frontend - Layer Display

**Given** a device master record is selected in the admin UI
**When** the device detail modal is opened
**Then** a list of associated layer_master records shall be displayed
**And** layer_id, descript, step_seq, and synced_at columns shall be visible
**And** layers shall be sorted in numeric order by layer_id

---

## M3: Device Meta Source Config + Enrichment Service + Admin UI

### AC-3.1: Device Meta Source Table Schema

**Given** migration 018 is applied
**When** querying the `device_meta_source` table schema
**Then** the table shall have columns: id (PK), source_name (VARCHAR UNIQUE NOT NULL), table_name (VARCHAR NOT NULL), schema_name (VARCHAR DEFAULT 'public'), join_keys (JSONB NOT NULL), column_mappings (JSONB NOT NULL), description (TEXT NULLABLE), is_active (BOOLEAN DEFAULT true), created_at, updated_at

### AC-3.2: Meta Source CRUD - Create

**Given** an admin user provides valid meta source configuration:
- source_name: "wafer_info"
- table_name: "ext_wafer_data"
- join_keys: [{"device_field": "product_name", "source_column": "product"}]
- column_mappings: [{"source_column": "pitch", "target_field": "pitch_size"}, {"source_column": "shot_cnt", "target_field": "shot_count"}]
**When** `POST /api/admin/device-meta-sources` is called
**Then** a new device_meta_source record shall be created
**And** the response shall include the full record with id

### AC-3.3: Meta Source CRUD - Table Validation

**Given** an admin user provides table_name "nonexistent_table"
**When** `POST /api/admin/device-meta-sources` is called
**Then** HTTP 400 shall be returned with an error message indicating the table does not exist

### AC-3.4: Meta Source CRUD - Update

**Given** meta source id=1 exists with source_name "wafer_info"
**When** `PUT /api/admin/device-meta-sources/1` is called with updated column_mappings
**Then** the record shall be updated
**And** `updated_at` shall be refreshed

### AC-3.5: Meta Source CRUD - Delete

**Given** meta source id=1 exists
**When** `DELETE /api/admin/device-meta-sources/1` is called
**Then** the record shall be removed
**And** subsequent GET shall not include this record

### AC-3.6: Column Discovery API

**Given** a table "ext_wafer_data" exists with columns: product (varchar), pitch (float), shot_cnt (int), die_w (float)
**When** `GET /api/admin/device-meta-sources/discover-columns?table_name=ext_wafer_data` is called
**Then** the response shall include all 4 columns with their data types

### AC-3.7: Column Discovery - Nonexistent Table

**Given** table "nonexistent_table" does not exist
**When** `GET /api/admin/device-meta-sources/discover-columns?table_name=nonexistent_table` is called
**Then** an empty list or HTTP 404 shall be returned

### AC-3.8: Single Device Enrichment

**Given** device_master id=1 has product_name "LN04LPPM"
**And** meta source "wafer_info" is configured to JOIN on product_name
**And** source table "ext_wafer_data" has a row: product="LN04LPPM", pitch=0.05, shot_cnt=120
**When** `POST /api/admin/device-masters/1/enrich` is called
**Then** device_master id=1's enrichment JSONB shall be updated to:
```json
{
  "wafer_info": {
    "pitch_size": 0.05,
    "shot_count": 120
  }
}
```
**And** the response shall include the enrichment result summary

### AC-3.9: Enrichment - Source Not Found

**Given** device "LN04LPPM" does not have a matching row in "ext_wafer_data"
**When** enrichment is triggered for this device
**Then** the enrichment for "wafer_info" source shall return empty/null
**And** the operation shall not fail

### AC-3.10: Enrichment - Missing Source Table

**Given** meta source "old_source" references table "deleted_table" which no longer exists
**When** enrichment is triggered
**Then** the enrichment for "old_source" shall be skipped with a warning
**And** other active meta sources shall still be processed
**And** the error shall be included in the enrichment result

### AC-3.11: Bulk Enrichment

**Given** device_master contains 50 active records (is_active=True)
**And** 2 active meta sources are configured
**When** `POST /api/admin/device-masters/enrich-all` is called
**Then** all 50 active devices shall be enriched against both sources
**And** the response shall include per-device summaries
**And** individual device errors shall not block other devices

### AC-3.12: Enrichment - Multiple Sources

**Given** two meta sources are configured: "wafer_info" and "layout_info"
**And** device "LN04LPPM" has matching data in both source tables
**When** enrichment is triggered
**Then** the enrichment JSONB shall contain both source results:
```json
{
  "wafer_info": {"pitch_size": 0.05},
  "layout_info": {"die_size": 10.5}
}
```

### AC-3.13: Enrichment - SQL Injection Prevention

**Given** a meta source is configured with table_name containing SQL injection attempt (e.g., "ext_data; DROP TABLE device_master;")
**When** enrichment is triggered
**Then** the operation shall fail safely with a validation error
**And** no SQL injection shall be executed
**And** the device_master table shall remain intact

### AC-3.14: Meta Source Admin UI (Sub-tab)

**Given** an admin user navigates to Admin > Device Master > Meta Sources sub-tab
**When** the sub-tab loads
**Then** a list of configured meta sources shall be displayed
**And** each entry shall show: source_name, table_name, is_active, column count

### AC-3.15: Meta Source Form - Column Discovery

**Given** the admin user is creating a new meta source
**When** a table_name is entered in the form
**Then** the column discovery API shall be called
**And** available columns shall be displayed for selection in the join_keys and column_mappings editors

### AC-3.16: Enrichment Auth Enforcement

**Given** a user with only "editor" role
**When** `POST /api/admin/device-masters/1/enrich` is called
**Then** HTTP 403 Forbidden shall be returned

---

## Quality Gate Criteria

### Test Coverage

- M1 new files: 85%+ coverage required
  - `device_master_sync_service.py`: 90%+ (critical sync + line resolution logic)
  - `sync_source_config_service.py`: 85%+
  - `device_masters.py` router: 85%+
  - `admin_device.py` router: 85%+
- M2 new files: 85%+ coverage required
  - Layer sync logic: 90%+ (device resolution, upsert)
  - Layer API endpoints: 85%+
- M3 new files: 85%+ coverage required
  - `device_enrichment_service.py`: 90%+ (dynamic SQL, error handling)
  - `device_meta_source_service.py`: 85%+
  - Column discovery: 85%+

### Performance Criteria

- Device Master List API: P95 < 200ms (500 records, paginated)
- Device Sync: < 30s for 500 devices batch sync (including line resolution)
- Layer Sync: < 60s for 500 devices x 50 layers each
- Single Device Enrichment: < 500ms per device per source
- Bulk Enrichment: < 60s for 500 devices x 3 sources
- Layer List Sort: CAST(layer_id AS FLOAT) ORDER BY adds < 5ms overhead

### Security Criteria

- All admin endpoints: RBAC enforced (admin or developer only)
- Dynamic SQL: Table/column names validated against information_schema
- No raw user input interpolated into SQL queries
- All API inputs validated via Pydantic schemas
- FK constraints use RESTRICT to prevent accidental data loss

### Backward Compatibility

- Existing `products`, `layers`, `product_layers` tables: Zero changes
- Existing project creation flow: Zero changes
- Existing backbone logic: Zero changes
- All changes are additive (new tables, new APIs, new UI)

### Definition of Done

- [ ] M1: `device_master` table created with line_id FK (RESTRICT), is_active, and all constraints
- [ ] M1: `sync_source_config` table created with source_type + source_name unique constraint
- [ ] M1: Sync service resolves line_id from external line codes via lines.line_code
- [ ] M1: Sync updates synced_at on all records including unchanged
- [ ] M1: Sync auto-triggers enrichment after completion
- [ ] M1: Public list/detail API endpoints functional with pagination and filters (line_name resolved)
- [ ] M1: Admin sync endpoint functional with combined sync + enrichment summary
- [ ] M1: Admin UI displays device master data with sync capability and sub-tab structure
- [ ] M1: Sync source config CRUD API functional
- [ ] M1: All tests passing with 85%+ coverage on new code
- [ ] M2: `layer_master` table created with FK to device_master (RESTRICT) and descript column
- [ ] M2: Layer sync resolves device references via (line_code -> line_id, product_name) and upserts correctly
- [ ] M2: Layer list API returns sorted layers per device (CAST(layer_id AS FLOAT) ordering)
- [ ] M2: Frontend displays layers in DeviceDetailModal with descript column
- [ ] M2: RESTRICT FK blocks device deletion when layers exist
- [ ] M2: All tests passing with 85%+ coverage on new code
- [ ] M3: `device_meta_source` table created
- [ ] M3: Meta source CRUD with table/column validation
- [ ] M3: Column discovery API functional
- [ ] M3: Enrichment service processes all active sources per device
- [ ] M3: Enrichment errors isolated per device/source (no cascading failure)
- [ ] M3: SQL injection prevention verified in tests
- [ ] M3: Admin UI for meta source management in "Meta Sources" sub-tab
- [ ] M3: All tests passing with 85%+ coverage on new code
- [ ] Single migration (018): up and down tested successfully (all 4 tables)
- [ ] TypeScript build: zero errors across all frontend changes
