# PCM Data Flow Architecture

Generated: 2026-02-27
Version: 3.0.0 (SPEC-DEVICE-001 + SPEC-PROJECT-002 + SPEC-RBAC-001 + SPEC-EQP-002)

---

## 1. Project Creation Flow

### V1: Product-Based Creation (Legacy)

```mermaid
sequenceDiagram
    participant UI as ProjectCreateModal (V1)
    participant API as api/projects.ts
    participant Router as projects.py
    participant Service as project_service
    participant BbRepo as BackboneRepository
    participant DB as PostgreSQL

    UI->>API: POST /api/projects {name, line_id, product_id, backbone_project_id}
    API->>Router: validate ProjectCreate schema
    Router->>Service: create_project_v1(data, user)
    Service->>BbRepo: get_backbone_layers(backbone_project_id)
    BbRepo->>DB: SELECT project_layers WHERE project_id = backbone_project_id AND project.status = 'Approved'
    DB-->>BbRepo: ProjectLayer rows with conditions JSONB
    BbRepo-->>Service: layer list with conditions
    Service->>DB: INSERT INTO projects (name, line_id, product_id, status='Draft', version=1)
    loop For each backbone layer
        Service->>DB: INSERT INTO project_layers (project_id, step_seq, layer_name, conditions=backbone.conditions, backbone_conditions=backbone.conditions)
    end
    DB-->>Service: created project + layers
    Service-->>Router: ProjectResponse
    Router-->>UI: 201 Created {id, name, status, layers}
    UI->>UI: navigate to /projects/:id/edit
```

### V2: Device-Ref Based Creation (SPEC-DEVICE-001 / SPEC-PROJECT-002)

```mermaid
sequenceDiagram
    participant UI as ProjectCreateModalV2
    participant API as api/projects.ts
    participant Router as projects.py
    participant Service as project_service
    participant DevSvc as device_master_query_service
    participant DB as PostgreSQL

    UI->>API: POST /api/projects {name, line_id, device_master_id, device_ref_version}
    API->>Router: validate ProjectCreate (V2 variant)
    Router->>Service: create_project_v2(data, user)
    Service->>DevSvc: get_device_master_layers(device_master_id)
    DevSvc->>DB: SELECT layer_masters WHERE device_master_id = X ORDER BY step_seq
    DB-->>DevSvc: LayerMaster rows
    DevSvc-->>Service: layer master list
    Service->>DB: INSERT INTO projects (name, line_id, device_ref_id, device_ref_version, status='Draft', version=1)
    loop For each layer master
        Service->>DB: INSERT INTO project_layers (project_id, step_seq, layer_name, conditions={}, backbone_conditions={})
    end
    DB-->>Service: created project + empty layers
    Service-->>Router: ProjectResponse
    Router-->>UI: 201 Created {id, name, status, layers}
    UI->>UI: navigate to /projects/:id/edit
```

---

## 2. Backbone Copy Flow

Triggered when a user replaces a specific layer's conditions with backbone source.

```mermaid
sequenceDiagram
    participant UI as BackboneReplaceModal
    participant API as api/projects.ts
    participant Router as project_layers.py
    participant Service as backbone_service
    participant BbRepo as BackboneRepository
    participant DB as PostgreSQL

    UI->>API: POST /api/projects/:id/layers/:layerId/backbone-replace {backbone_project_id, backbone_layer_id}
    API->>Router: authenticate (owner guard)
    Router->>Service: replace_layer_backbone(project_id, layer_id, backbone_project_id, backbone_layer_id)
    Service->>BbRepo: get_backbone_layer_conditions(backbone_project_id, backbone_layer_id)
    BbRepo->>DB: SELECT project_layers.conditions WHERE id = backbone_layer_id AND project.status = 'Approved'
    DB-->>BbRepo: conditions JSONB
    BbRepo-->>Service: conditions dict
    Service->>DB: UPDATE project_layers SET conditions = backbone_conditions_copy, backbone_conditions = backbone_conditions_copy, source_type = 'backbone' WHERE id = layer_id
    Service->>DB: INSERT INTO change_logs (project_layer_id, column_key, old_value, new_value, source_type='backbone') for each changed column
    DB-->>Service: updated layer
    Service-->>Router: ProjectLayerResponse
    Router-->>UI: 200 OK {conditions, backbone_conditions}
    UI->>UI: refresh AG Grid with new conditions, backbone cells highlighted
```

---

## 3. Condition Editing + Auto-Save Flow

```mermaid
sequenceDiagram
    participant User
    participant Grid as ConditionGrid (AG Grid)
    participant Store as useEditorStore
    participant Hook as useEditorCellEdit
    participant AutoSave as useAutoSave
    participant API as api/projects.ts
    participant Router as project_conditions.py
    participant Service as condition_service
    participant DB as PostgreSQL

    User->>Grid: edit cell (column_key, layer_id, new_value)
    Grid->>Hook: onCellValueChanged(params)
    Hook->>Hook: run client-side validation (range/enum/required)
    Hook->>Store: set dirtyCells[layerId][columnKey] = new_value
    Hook->>Store: set validationErrors (if any)
    Grid->>Grid: re-render cell with dirty color indicator

    Note over AutoSave: Every 30 seconds
    AutoSave->>Hook: trigger save()
    Hook->>Store: read all dirtyCells
    Hook->>API: PUT /api/projects/:id/conditions {changes: [{layer_id, column_key, value}]}
    API->>Router: validate bulk save request
    Router->>Service: save_conditions(project_id, changes, user_id)
    loop For each change
        Service->>DB: SELECT current value from project_layers.conditions[column_key]
        Service->>DB: UPDATE project_layers SET conditions[column_key] = new_value
        Service->>DB: INSERT INTO change_logs (old_value, new_value, source_type='manual', user_id)
    end
    DB-->>Service: success
    Service-->>Router: SaveResponse
    Router-->>Hook: 200 OK
    Hook->>Store: clear dirtyCells for saved changes
    Grid->>Grid: re-render cells as clean (dirty color removed)
```

---

## 4. Validation Flow

### Single-Layer Validation

```mermaid
sequenceDiagram
    participant UI as ValidationPanel
    participant API as api/projects.ts
    participant Router as project_conditions.py
    participant ValSvc as validation_service
    participant DB as PostgreSQL

    UI->>API: POST /api/projects/:id/validate
    API->>Router: authenticate
    Router->>ValSvc: validate_project(project_id)
    ValSvc->>DB: SELECT project_layers WHERE project_id = X
    ValSvc->>DB: SELECT column_validations (range, required, enum, regex rules)
    loop For each layer
        loop For each column with validation rules
            ValSvc->>ValSvc: apply rule (range check, required check, enum check, regex match)
            ValSvc->>ValSvc: call values_differ() for comparison
        end
    end
    ValSvc-->>Router: ValidationResult {errors: [{layer_id, column_key, message, rule_type}]}
    Router-->>UI: 200 OK {errors}
    UI->>UI: display errors in ValidationPanel, highlight error cells in grid
```

### Cross-Layer Validation

```mermaid
sequenceDiagram
    participant ValSvc as validation_service
    participant XValSvc as cross_layer_validation_service
    participant DB as PostgreSQL

    ValSvc->>XValSvc: validate_cross_layer_rules(project_id, layers_data)
    XValSvc->>DB: SELECT cross_layer_rules WHERE is_active = true
    loop For each rule
        alt rule_type = reference_exists
            XValSvc->>XValSvc: check layer A column_key value exists in layer B
        else rule_type = compare_layers
            XValSvc->>XValSvc: compare value between two specified layers with operator
        else rule_type = equipment_compatibility
            XValSvc->>XValSvc: check EQP column consistency across specified layers
        end
    end
    XValSvc-->>ValSvc: cross_layer_errors [{source_layer_id, target_layer_id, column_key, message}]
```

---

## 5. Status Transition Flow (Draft → Review → Approved → Archived)

```mermaid
stateDiagram-v2
    [*] --> Draft: Project created
    Draft --> Review: submit-review (0 validation errors required)
    Review --> Draft: reject (reviewer role)
    Review --> Approved: approve (reviewer role)
    Approved --> Archived: revise (creates new Draft v+1)
    Approved --> Archived: next revision approved

    note right of Draft: Editable conditions\nAuto-save enabled
    note right of Review: Read-only\nReview comments enabled
    note right of Approved: Read-only\nExport enabled\nBackbone source available
    note right of Archived: Read-only\nHistorical view only
```

**Submit for Review** (`POST /api/projects/:id/submit-review`):
1. `project_status_service` calls `validation_service.validate_project()`
2. If errors > 0: returns 400 with validation error list
3. If errors == 0: updates `project.status = 'Review'`
4. Inserts `project_status_logs` record (Draft → Review, user_id, timestamp)

**Approve** (`POST /api/projects/:id/approve`):
1. `require_reviewer` RBAC guard
2. Updates `project.status = 'Approved'`
3. Inserts status log (Review → Approved)
4. Project now eligible as backbone source for new projects

**Reject** (`POST /api/projects/:id/reject`):
1. `require_reviewer` RBAC guard
2. Updates `project.status = 'Draft'` (allows further editing)
3. Inserts status log (Review → Draft, with reject reason)

**Revise** (`POST /api/projects/:id/revise`):
1. `project_service.create_revision()`
2. Original project status → 'Archived'
3. New project created: copies all project_layers with conditions, increments version
4. New project status = 'Draft', linked to same product/device, new `revision_reason` stored
5. Returns new project ID

---

## 6. Export Flow (Type A / B / C)

```mermaid
sequenceDiagram
    participant UI as ExportPanel
    participant API as api/export.ts
    participant Router as export.py
    participant ExportSvc as export_service
    participant Builders as export_builders
    participant DataSrcSvc as export_data_source_service
    participant HistSvc as export_history_service
    participant DB as PostgreSQL

    UI->>API: GET /api/projects/:id/export/download/:systemId
    API->>Router: authenticate (project must be Approved)
    Router->>ExportSvc: generate_export(project_id, system_id, user_id)
    ExportSvc->>DB: SELECT export_system + export_column_mappings WHERE system_id = X
    ExportSvc->>DB: SELECT project_layers + conditions WHERE project_id = X

    loop For each column mapping with source_type = 'external'
        ExportSvc->>DataSrcSvc: fetch_external_column_data(data_source_id, source_column_name, layer_ids)
        DataSrcSvc->>DB: JOIN external table ON layer key
        DB-->>DataSrcSvc: external column values
        DataSrcSvc-->>ExportSvc: {layer_id: value} map
    end

    alt format_type = 'type_a'
        ExportSvc->>Builders: build_type_a(layers, mappings, data)
        Note over Builders: Horizontal: each layer = column, conditions = rows
    else format_type = 'type_b'
        ExportSvc->>Builders: build_type_b(layers, mappings, data)
        Note over Builders: Equipment-split: one sheet per EQP column value
    else format_type = 'type_c'
        ExportSvc->>Builders: build_type_c(layers, mappings, data)
        Note over Builders: Key-value transpose: column names as rows
    end

    Builders-->>ExportSvc: openpyxl Workbook
    ExportSvc->>HistSvc: record_export(project_id, system_id, user_id, layer_ids)
    HistSvc->>DB: INSERT INTO export_histories
    ExportSvc-->>Router: Excel bytes (BytesIO)
    Router-->>UI: StreamingResponse (.xlsx file download)
```

---

## 7. Recipe XML Import + Diff Flow

```mermaid
sequenceDiagram
    participant UI as RecipeUploadModal + RecipeDiffTable
    participant API as api/projects.ts
    participant Router as project_layers.py
    participant RecipeSvc as recipe_service
    participant DB as PostgreSQL

    UI->>API: POST /api/projects/:id/layers/:layerId/recipe-upload (multipart XML file)
    API->>Router: authenticate (owner)
    Router->>RecipeSvc: parse_recipe_xml(xml_bytes, layer_id)
    RecipeSvc->>DB: SELECT recipe_xml_mappings (XPath ↔ column_key mappings)
    RecipeSvc->>RecipeSvc: lxml parse XML, extract values via XPath expressions
    RecipeSvc->>DB: SELECT project_layers.conditions WHERE id = layer_id
    loop For each mapped XPath value
        RecipeSvc->>RecipeSvc: compare extracted value vs current condition value (values_differ)
    end
    RecipeSvc-->>Router: RecipeDiffResponse [{column_key, xpath, recipe_value, current_value, is_different}]
    Router-->>UI: 200 OK {diff_items}

    UI->>UI: display diff items in RecipeDiffTable with checkboxes
    User->>UI: select subset of diff items to apply
    UI->>API: POST /api/projects/:id/layers/:layerId/recipe-apply {apply_items: [column_key list]}
    API->>Router: authenticate (owner)
    Router->>RecipeSvc: apply_recipe_diff(layer_id, apply_items, user_id)
    loop For each selected column_key
        RecipeSvc->>DB: UPDATE project_layers.conditions[column_key] = recipe_value
        RecipeSvc->>DB: INSERT INTO change_logs (source_type='recipe', old_value, new_value)
    end
    RecipeSvc-->>Router: updated conditions
    Router-->>UI: 200 OK {updated_conditions}
    UI->>UI: refresh grid with new recipe values
```

---

## 8. Authentication Flow

### Login

```mermaid
sequenceDiagram
    participant UI as LoginPage
    participant Store as useAuthStore
    participant API as api/authToken.ts
    participant Router as auth.py
    participant AuthSvc as auth_service
    participant DB as PostgreSQL

    UI->>Store: login(username, password)
    Store->>API: POST /api/auth/login {username, password}
    API->>Router: OAuth2PasswordRequestForm
    Router->>AuthSvc: authenticate_user(username, password)
    AuthSvc->>DB: SELECT user WHERE username = X
    AuthSvc->>AuthSvc: passlib.verify(password, hashed_password)
    AuthSvc-->>Router: User or None
    Router->>AuthSvc: create_access_token(user_id, roles, exp=15min)
    Router->>AuthSvc: create_refresh_token(user_id, exp=7d)
    Router-->>Store: {access_token} + Set-Cookie: refresh_token (HTTP-only)
    Store->>Store: set accessToken, currentUser, isAuthenticated
    Store-->>UI: success
    UI->>UI: navigate to /
```

### Token Refresh (Axios Interceptor)

```mermaid
sequenceDiagram
    participant Interceptor as Axios Response Interceptor (client.ts)
    participant API as api/authToken.ts
    participant Router as auth.py
    participant Store as useAuthStore

    Interceptor->>Interceptor: detect 401 response on any API call
    Interceptor->>API: POST /api/auth/refresh (sends HTTP-only cookie automatically)
    API->>Router: verify refresh token from cookie
    Router->>Router: decode JWT, check exp, fetch User
    Router-->>API: {access_token: new_token}
    API-->>Interceptor: new access token
    Interceptor->>Store: set new accessToken
    Interceptor->>Interceptor: retry original failed request with new token
    Interceptor-->>Caller: original response (transparent to caller)

    Note over Interceptor: On refresh failure (expired/invalid cookie):
    Interceptor->>Store: logout() (clears state)
    Interceptor->>Interceptor: redirect to /login
```

### Logout

```mermaid
sequenceDiagram
    participant UI as Header
    participant Store as useAuthStore
    participant API as api/authToken.ts
    participant Router as auth.py

    UI->>Store: logout()
    Store->>API: POST /api/auth/logout
    API->>Router: clear refresh token cookie (Set-Cookie: refresh_token=; MaxAge=0)
    Router-->>Store: 200 OK
    Store->>Store: clear accessToken, currentUser
    Store-->>UI: redirect to /login
```

---

## 9. Device Master Sync Flow (SPEC-DEVICE-001)

```mermaid
sequenceDiagram
    participant Admin as DeviceMasterPage (admin UI)
    participant API as api/deviceMaster.ts
    participant Router as admin_device.py
    participant SyncSvc as device_master_sync_service
    participant EnrichSvc as device_enrichment_service
    participant MetaSvc as device_meta_source_service
    participant DB as PostgreSQL
    participant ExtDB as External Database / API Source

    Admin->>API: POST /api/admin/device-masters/sync
    API->>Router: authenticate (developer role)
    Router->>SyncSvc: trigger_sync()
    SyncSvc->>DB: SELECT sync_source_configs (connection settings, source table, mappings)
    SyncSvc->>ExtDB: query external source (DB connection / HTTP API)
    ExtDB-->>SyncSvc: raw device + layer records
    loop For each device record
        SyncSvc->>DB: UPSERT device_masters (name, code, line_id) ON CONFLICT DO UPDATE
        loop For each layer record
            SyncSvc->>DB: UPSERT layer_masters (step_seq, name, device_master_id)
        end
    end

    Note over SyncSvc,EnrichSvc: Enrichment phase (metadata join)
    SyncSvc->>EnrichSvc: enrich_devices(updated_device_ids)
    EnrichSvc->>DB: SELECT device_meta_sources (table_name, join_key, columns)
    loop For each meta source
        EnrichSvc->>DB: JOIN external_table ON device.code = external_table.join_key
        EnrichSvc->>DB: UPDATE device_masters SET meta_json = enriched_data
    end

    DB-->>Router: sync_result {synced_count, enriched_count, errors}
    Router-->>Admin: 200 OK {sync_result}
    Admin->>Admin: refresh device master list
```

**V2 Project Creation with Device Master**:

After sync, device masters are available for V2 project creation:

```
DeviceMasterPage (admin) confirms device records are synced and correct
     ↓
ProjectCreateModalV2 (user)
  GET /api/device-masters → list available device masters
  GET /api/device-masters/:id/layers → get associated layer masters
  User selects device master + confirms layer list
  POST /api/projects {device_master_id, device_ref_version, ...}
     ↓
project_service.create_project_v2()
  - Creates Project with device_ref_id, device_ref_version FK fields
  - Creates ProjectLayer for each LayerMaster with empty conditions {}
  - User fills in conditions via ConditionEditorPage
```

---

## 10. Backbone Comparison Flow

Allows editors to review differences between current conditions and backbone baseline.

```mermaid
sequenceDiagram
    participant User
    participant Header as EditorHeader
    participant Store as useEditorStore
    participant Panel as BackboneComparisonPanel
    participant View as BackboneComparisonView
    participant DiffLib as src/lib/diff.ts

    User->>Header: click "BB Compare" toggle button
    Header->>Store: toggleBackboneComparison()
    Store->>Store: isBackboneComparisonOpen = true
    Store-->>Panel: render BackboneComparisonPanel

    Panel->>DiffLib: computeProjectComparisonDetail(layers, columns)
    Note over DiffLib: Iterates each layer, compares conditions vs backbone_conditions
    Note over DiffLib: Uses getLayerComparisonDetail() per layer
    DiffLib-->>Panel: {changedLayers: [{layerName, changedColumns: [{key, current, backbone}]}]}

    Panel->>Panel: display count of changed layers in badge
    User->>Panel: click specific layer
    Panel->>View: render BackboneComparisonView (column-level diff)

    Note over View: Also embedded in ReviewRequestModal (compact mode)
    Note over View: Shows: column name, backbone value, current value, diff highlighted
```

---

## 11. Change History Flow

```mermaid
sequenceDiagram
    participant UI as ChangeHistoryPanel
    participant API as api/projects.ts
    participant Router as project_conditions.py
    participant Service as change_log_service
    participant Repo as ChangeLogRepository
    participant DB as PostgreSQL

    UI->>API: GET /api/projects/:id/change-logs?layer_id=X&source_type=manual&page=1
    API->>Router: authenticate
    Router->>Service: get_change_logs(project_id, filters)
    Service->>Repo: query_change_logs(project_id, filters, pagination)
    Repo->>DB: SELECT change_logs JOIN users WHERE project_layer.project_id = X [+ filters] ORDER BY created_at DESC LIMIT 50
    DB-->>Repo: ChangeLog rows with user info
    Repo-->>Service: paginated results
    Service-->>Router: ChangeLogListResponse
    Router-->>UI: {items, total, page}

    User->>UI: click specific cell in ChangeHistoryEntry
    UI->>API: GET /api/projects/:id/cell-history?layer_id=X&column_key=Y
    API->>Router: authenticate
    Router->>Service: get_cell_history(project_id, layer_id, column_key)
    Service->>Repo: query_cell_history(layer_id, column_key)
    Repo->>DB: SELECT change_logs WHERE project_layer_id = X AND column_key = Y ORDER BY created_at
    DB-->>Repo: full cell history
    Repo-->>Router: CellHistoryResponse
    Router-->>UI: [{old_value, new_value, source_type, user, timestamp}]
    UI->>UI: render CellHistoryModal with timeline
```
