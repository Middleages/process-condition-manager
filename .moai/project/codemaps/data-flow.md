# PCM Data Flow Architecture

Comprehensive documentation of critical data flow paths through the PCM system, illustrating how data moves between frontend, backend, and database layers.

## Key Data Flows

### Flow 1: User Authentication and Session Management

**Trigger:** User enters credentials on LoginPage
**Duration:** ~500ms

```
User Input (LoginPage)
    ↓
Form Validation (useLoginForm hook)
    ↓
API Call: POST /api/auth/login (axios client)
    ↓
Backend: auth.py router
    ↓
AuthService.authenticate(username, password)
    ↓
Database Query: SELECT * FROM users WHERE username = ?
    ↓
Password Hash Validation (python-jose)
    ↓
Generate JWT tokens (access + refresh)
    ↓
API Response: {access_token, refresh_token, user}
    ↓
useAuthStore.login() - Store tokens in state
    ↓
localStorage.setItem('token') - Persist token
    ↓
Redirect to /projects dashboard
```

**Data Points:**
- Input: username (string), password (string)
- Processing: Password hash comparison, JWT generation
- Output: JWT access token (string), refresh token (string), user object
- Storage: useAuthStore (in-memory), localStorage (browser storage)

**Token Structure:**
```json
Access Token Payload: {
  "sub": "user_id",
  "username": "string",
  "exp": 1705327800,
  "iat": 1705327200
}
```

**Token Lifecycle:**
- Access token: 30 minutes expiration
- Refresh token: 7 days expiration
- Auto-refresh: Intercepted 401 triggers refresh via POST /api/auth/refresh
- Logout: Tokens cleared from storage

**Critical Dependencies:**
- `database.get_db()` - Database session
- `User model` - User entity lookup
- `python-jose` - JWT encoding/decoding
- `useAuthStore` - Frontend state management

---

### Flow 2: Project Creation with Backbone Copy

**Trigger:** User clicks "Create Project" button on ProjectListPage
**Duration:** ~1.5 seconds

```
User selects Product + Backbone (ProjectForm)
    ↓
Form Validation
    ↓
API Call: POST /api/projects
  {
    "product_id": "uuid",
    "main_backbone_id": "uuid"
  }
    ↓
Backend: project.py router
    ↓
get_current_user dependency injects authenticated user
    ↓
ProjectService.create_project(product_id, current_user)
    ↓
Database Query 1: SELECT * FROM products WHERE id = ?
    ↓
Database Query 2: SELECT * FROM product_layers
    WHERE product_id = main_backbone_id
    ↓
BackboneRepository.get_backbone(main_backbone_id)
    Returns ProductLayers with conditions JSONB:
    {
      "SP_PARAMETER_1": "value",
      "SC_PARAMETER_1": 123,
      "DEV_PARAMETER_1": false
    }
    ↓
ProjectService creates new Project record
    ↓
Database Query 3: INSERT INTO projects
    (product_id, main_backbone_id, status)
    VALUES (...)
    Returns: project_id
    ↓
BackboneRepository.copy_backbone(main_backbone_id, new_project_id)
    ↓
For each layer in ProductLayers:
    Database Query 4: INSERT INTO project_layers
    (project_id, layer_id, backbone_product_id,
     conditions, backbone_conditions)
    VALUES (...copied conditions...)
    ↓
ChangeLogService.log_change(
  project_id,
  'backbone_copy',
  null,
  backbone_id,
  'backbone'
)
    ↓
Database Query 5: INSERT INTO changelogs (...)
    ↓
API Response: {project_id, status: 'draft', layers: [...]}
    ↓
Frontend: useProjectStore.selectProject(new_project)
    ↓
Redirect to /projects/{projectId}/edit
```

**Data Points:**
- Input: product_id, main_backbone_id, current_user
- Backbone Template: ProductLayers.conditions (JSONB ~300 params)
- Processing: Backbone copy with deep JSONB cloning
- Output: Project record with all ProjectLayers created
- Audit: Change logged with type 'backbone'

**JSONB Structure Example:**
```json
ProductLayers.conditions (Master):
{
  "SP": {
    "SP_PARAMETER_1": "standard",
    "SP_PARAMETER_2": 100
  },
  "SC": {
    "SC_PARAMETER_1": 50
  },
  "OVL": {},
  "DEV": {}
}

Copied to ProjectLayers.conditions (Project Copy)
AND ProjectLayers.backbone_conditions (Backup of original)
```

**Critical Dependencies:**
- `ProjectRepository.create()` - Insert project
- `BackboneRepository.copy_backbone()` - Deep JSONB copy (critical logic)
- `ChangeLogService.log_change()` - Audit trail
- `comparison.compare_dicts()` - Used in verification

**Risks:**
- Concurrent project creation can cause race condition on revision counter
- Large JSONB copy (300+ params) on slow database

---

### Flow 3: Condition Editing (Single Cell Change in Grid)

**Trigger:** User edits cell in AG Grid on ConditionEditorPage
**Duration:** ~300-800ms (depends on validation complexity)

```
User types new value in grid cell
    ↓
AG Grid: onCellValueChanged event
    ↓
GridCellEditor component
    ↓
useGridCellEdit hook captures change
    ↓
Client-side Validation:
  - Type check (number, string, date, select)
  - Format validation (email, date format)
    ↓
Mark cell as dirty (visual indicator)
    ↓
User clicks "Save" button
    ↓
useConditions.updateConditions() hook
    ↓
Collect all dirty cells for the layer
    ↓
API Call: PUT /api/project-conditions/{projectId}/{layerId}
  {
    "conditions": {
      "SP_PARAMETER_1": "new_value",
      "SC_PARAMETER_1": 456
    },
    "change_type": "manual"
  }
    ↓
Backend: condition.py router
    ↓
get_current_user + authorization check
    ↓
Check project status: must be 'draft' or 'review'
    ↓
ConditionService.save_conditions(projectId, layerId, data)
    ↓
ConditionRepository.get_conditions(projectId, layerId)
    Returns current conditions JSONB
    ↓
ValidationService.validate_layer(layerId, new_conditions)
    ↓
For each column in data:
    Database Query: SELECT * FROM column_validations
    WHERE column_id = ?
    ↓
Apply validation rules:
    - Range: min <= value <= max
    - Required: value IS NOT NULL
    - Pattern: REGEX_MATCH(value, pattern)
    - Conditional: IF condition_a THEN require condition_b
    ↓
If validation fails:
    API Response: {
      "validation_errors": [
        {"field": "SP_PARAMETER_1", "message": "Must be 0-100"}
      ]
    }
    Response Status: 400 Bad Request
    ↓
Frontend displays validation errors in grid
    User corrects input
    ↓
Else: Validation passes
    ↓
ConditionRepository.update_conditions(
  projectId,
  layerId,
  new_values
)
    ↓
JSONB Merge Logic:
    OLD: {SP_PARAMETER_1: "old", SC_PARAMETER_1: 100}
    NEW: {SP_PARAMETER_1: "new"}
    RESULT: {SP_PARAMETER_1: "new", SC_PARAMETER_1: 100}
    ↓
Database Query: UPDATE project_layers
    SET conditions = jsonb_set(conditions, '{SP_PARAMETER_1}', '"new"')
    WHERE project_id = ? AND layer_id = ?
    ↓
For each changed field:
    ChangeLogService.log_change(
      project_id,
      'SP_PARAMETER_1',
      old_value: 'old',
      new_value: 'new',
      change_type: 'manual',
      user_id: current_user.id
    )
    ↓
Database Query: INSERT INTO changelogs (...)
    ↓
Invalidate condition cache
    ↓
API Response: {
  "conditions": {...updated},
  "validation_errors": []
}
    ↓
Frontend:
  - Clear dirty cell markers
  - Update grid display
  - Show success toast notification
  - Update useConditions hook cache
```

**Data Points:**
- Input: Single cell value (string/number/bool/date)
- Validation Rules: From ColumnValidations.rule_config (JSONB)
- Processing: Type validation, rule application
- Output: Updated ProjectLayers.conditions
- Audit: Single ChangeLog entry per field changed

**Validation Rule Example:**
```json
ColumnValidations for SP_PARAMETER_1:
{
  "rule_type": "range",
  "rule_config": {
    "min": 0,
    "max": 100
  }
}

ColumnValidations for DEV_PARAMETER_1:
{
  "rule_type": "conditional_required",
  "rule_config": {
    "condition": "SP_PARAMETER_1 = 'high'",
    "required_field": "DEV_PARAMETER_1"
  }
}
```

**Critical Dependencies:**
- `ConditionRepository.update_conditions()` - JSONB merge (complex logic)
- `ValidationService.validate_layer()` - Rule application
- `ChangeLogService.log_change()` - Each change logged individually
- `comparison.compare_dicts()- Used in rule validation

**Performance Considerations:**
- For 300+ column edits: Should batch save instead of individual cell saves
- JSONB merge is O(n) where n = number of fields in conditions
- Validation lookup is O(m) where m = number of validation rules

**Error Scenarios:**
1. Validation failure → 400 Bad Request, show error in UI
2. Concurrent edit → 409 Conflict, refresh from server
3. Project status changed to approved → 403 Forbidden, refresh project status
4. Database constraint violation → 500 Internal Server Error, log and show generic error

---

### Flow 4: Recipe Import with Diff and Selective Apply

**Trigger:** User uploads recipe XML file on RecipeImportPanel
**Duration:** ~2-5 seconds (depends on file size)

```
User selects recipe XML file
    ↓
File Upload Form
    ↓
API Call: POST /api/recipe/import (multipart/form-data)
    ↓
Backend: recipe.py router
    ↓
File saved temporarily in /tmp/recipes/
    ↓
RecipeService.parse_recipe_xml(file_path)
    ↓
lxml.etree.parse(file) - XML parsing
    ↓
Validate XML schema against equipment template
    ↓
Extract parameters into dictionary:
{
  "SP_PARAMETER_1": "equipment_value1",
  "SC_PARAMETER_1": 200,
  "DEV_PARAMETER_1": true
}
    ↓
Store parsed recipe in temporary storage (recipe_id)
    ↓
API Response: {recipe_id, parsed_conditions}
    ↓
User selects layers to compare
    ↓
Frontend: useRecipe.getRecipeDiff()
    ↓
API Call: GET /api/recipe/diff?recipe_id=...&project_id=...&layer_id=...
    ↓
Backend: recipe.py router
    ↓
RecipeService.calculate_diff(recipe_id, project_id, layer_id)
    ↓
Database Query: SELECT conditions, backbone_conditions
    FROM project_layers
    WHERE project_id = ? AND layer_id = ?
    ↓
Load recipe_conditions from temp storage
    ↓
comparison.compare_dicts(current_conditions, recipe_conditions)
    Deep comparison returns:
    {
      "added": {"NEW_PARAM": "value"},
      "removed": {"OLD_PARAM": "value"},
      "modified": {
        "SP_PARAMETER_1": {
          "old": "old_value",
          "new": "new_value"
        }
      }
    }
    ↓
API Response: Diff report with each change
    {
      "changes": [
        {
          "type": "modified",
          "field": "SP_PARAMETER_1",
          "old_value": "old",
          "new_value": "new",
          "conflict": false
        }
      ],
      "summary": {"added": 0, "removed": 0, "modified": 2}
    }
    ↓
Frontend: RecipeImportPanel displays diff preview
    Show checkbox for each change
    User can select which changes to apply
    ↓
User clicks "Apply Selected Changes"
    ↓
API Call: POST /api/recipe/apply
  {
    "recipe_id": "uuid",
    "project_id": "uuid",
    "layer_id": "uuid",
    "selected_changes": ["SP_PARAMETER_1", "SC_PARAMETER_1"]
  }
    ↓
Backend: recipe.py router
    ↓
RecipeService.apply_recipe_diff(...)
    ↓
Load selected changes from recipe
    ↓
For each selected change:
    Run validation on new value
    ↓
If any validation fails:
    Rollback transaction
    API Response: 400 Bad Request with validation errors
    ↓
Else: All validations pass
    ↓
ConditionRepository.update_conditions(
      projectId,
      layerId,
      selected_changes_dict
    )
    ↓
JSONB Merge:
    OLD: {SP_PARAMETER_1: "old", SC_PARAMETER_1: 100, DEV: "value"}
    RECIPE: {SP_PARAMETER_1: "new", SC_PARAMETER_1: 200}
    RESULT: {SP_PARAMETER_1: "new", SC_PARAMETER_1: 200, DEV: "value"}
    ↓
Database Query: UPDATE project_layers
    SET conditions = jsonb_merge(conditions, new_values)
    WHERE project_id = ? AND layer_id = ?
    ↓
For each applied change:
    ChangeLogService.log_change(
      project_id,
      field_name,
      old_value,
      new_value,
      change_type: 'recipe',
      recipe_source: equipment_id
    )
    ↓
Database Query: INSERT INTO changelogs (...)
    ↓
Clean up temporary recipe file
    ↓
API Response: {
  "applied_count": 2,
  "failed_count": 0,
  "conditions": {...updated}
}
    ↓
Frontend:
  - Hide diff panel
  - Refresh grid data
  - Show success toast: "Applied 2 changes from recipe"
  - Update change history
```

**Data Points:**
- Input: Recipe XML file from equipment
- Parsing: Equipment-specific XML schema
- Diff: Compare recipe values vs. project values (deep dictionary comparison)
- Selection: User selects subset of changes (cherry-pick)
- Validation: Each selected change validated before apply
- Output: Updated ProjectLayers.conditions with selected changes
- Audit: Each change logged with type 'recipe' and equipment source

**Risk Areas:**
- XML parsing could fail on malformed file → 400 Bad Request
- Large recipe files with 1000+ parameters → slow comparison
- Concurrent recipe imports could overwrite temp files → use random temp directory names
- Memory usage: Parsing large XML files → use streaming parser for large files

**Critical Dependencies:**
- `lxml.etree` - XML parsing
- `comparison.compare_dicts()` - Diff algorithm (high fan-in, critical logic)
- `ValidationService.validate_layer()` - Validate recipe values
- `ChangeLogService.log_change()` - Audit trail

---

### Flow 5: Project Status Approval Workflow

**Trigger:** Admin clicks "Approve" on project in review status
**Duration:** ~500ms

```
Admin selects project on ProjectListPage
    ↓
Project status is 'review'
    ↓
Admin clicks "Approve" button
    ↓
Confirmation dialog appears
    ↓
Admin confirms
    ↓
API Call: PUT /api/projects/{projectId}/status
  {
    "new_status": "approved"
  }
    ↓
Backend: project.py router
    ↓
require_admin dependency check (only admin can approve)
    ↓
ProjectService.update_status(projectId, 'approved')
    ↓
Database Query: SELECT * FROM projects WHERE id = ?
    ↓
Validate status transition: 'review' → 'approved' allowed
    ↓
Check all conditions validated:
    For each ProjectLayer:
      SELECT COUNT(*) FROM changelogs
      WHERE project_id = ?
      AND change_type IN ('validation_failed')
    ↓
If validation failures exist:
    API Response: 409 Conflict
    Message: "Cannot approve: validation errors remain"
    ↓
Else: No validation errors
    ↓
Database Query: UPDATE projects
    SET status = 'approved',
        approved_at = NOW(),
        approved_by = current_user.id
    WHERE id = ?
    ↓
Lock conditions (prevent further edits):
    Database Query: UPDATE project_layers
    SET is_locked = TRUE
    WHERE project_id = ?
    ↓
ChangeLogService.log_change(
  project_id,
  'status',
  old_value: 'review',
  new_value: 'approved',
  change_type: 'status',
  user_id: admin_user.id
)
    ↓
Database Query: INSERT INTO changelogs (...)
    ↓
API Response: {
  "id": "uuid",
  "status": "approved",
  "approved_at": "2024-01-15T14:45:00Z",
  "approved_by": "admin_username"
}
    ↓
Frontend:
  - Update project in useProjectStore
  - Disable edit buttons on ConditionEditorPage
  - Show info toast: "Project approved successfully"
  - Update project status badge to 'approved'
```

**Data Points:**
- Input: Admin user ID, project ID, new status
- Validation: Status transition rules
- Authorization: require_admin check
- Output: Project with locked conditions, status change logged
- Audit: Status change logged with approver info

**State Machine:**
```
draft ↔ review → approved → archived
  ↓____________________↑
  (can revert to draft)
```

**Critical Dependencies:**
- `require_admin` - Authorization check
- `ProjectService.update_status()` - Status logic
- `ChangeLogService.log_change()` - Audit trail

---

### Flow 6: Excel Export (Multiple Formats)

**Trigger:** User generates Excel export on ExportPanel
**Duration:** ~2-10 seconds (depends on project size and format)

```
User selects export format (TYPE_A/B/C)
    ↓
User clicks "Export to Excel"
    ↓
API Call: POST /api/export/excel
  {
    "project_id": "uuid",
    "format_type": "TYPE_A",
    "system_id": "uuid"
  }
    ↓
Backend: export.py router
    ↓
ExportService.preview_export(projectId, formatType, systemId)
    ↓
Database Query 1: SELECT * FROM projects WHERE id = ?
    ↓
Database Query 2: SELECT pl.*, l.layer_name
    FROM project_layers pl
    JOIN layers l ON pl.layer_id = l.id
    WHERE pl.project_id = ?
    ↓
Database Query 3: SELECT * FROM export_column_mappings
    WHERE export_system_id = ?
    ↓
For each ProjectLayer, load conditions JSONB
    ↓
Format conditions based on TYPE:

TYPE_A (Horizontal - typical Excel):
    Headers: Layer | SP_PARAM_1 | SP_PARAM_2 | SC_PARAM_1 | ...
    Rows:    Layer1 | value1    | value2    | value3    | ...
             Layer2 | value4    | value5    | value6    | ...

TYPE_B (Equipment Split):
    For each equipment:
      Sheet name: Equipment1
      Headers: Layer | Equipment1_Param1 | Equipment1_Param2
      Rows: Layer1 | value1 | value2

TYPE_C (Transposed):
    Headers: Layer | Param1 | Param2 | Param3 | ...
    Rows:    Value1 | Value2 | Value3 | ...
    ↓
openpyxl.Workbook() - Create Excel workbook
    ↓
For each format:
    Create worksheet
    Write headers
    Write data rows
    Apply formatting (colors, fonts, borders)
    Apply column widths
    ↓
Save workbook to temporary file: /tmp/exports/{job_id}.xlsx
    ↓
Database Query: INSERT INTO export_histories
    (project_id, system_id, format_type, file_name, status)
    VALUES (...)
    ↓
API Response: {
  "job_id": "uuid",
  "file_url": "/api/export/download/uuid",
  "status": "completed"
}
    ↓
Frontend: ExportPanel
    - Show download button
    - Show file size
    - Show export time
    ↓
User clicks "Download"
    ↓
API Call: GET /api/export/download/{jobId}
    ↓
Backend: export.py router
    ↓
Load file from /tmp/exports/{jobId}.xlsx
    ↓
API Response: Binary file with headers:
    Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
    Content-Disposition: attachment; filename="project_export.xlsx"
    ↓
Browser downloads file to user's downloads folder
```

**Data Points:**
- Input: project_id, format_type, system_id
- Format Configuration: ExportColumnMappings.column_mapping JSONB
- Processing: Conditions JSONB flattened per format
- Output: Excel file (.xlsx) with 1-3 worksheets
- Storage: Temporary file in /tmp/exports/
- Audit: ExportHistory entry created

**Format Details:**

TYPE_A (Horizontal) - Most Common:
```
Layer Name | SP_PARAM_1 | SC_PARAM_1 | OVL_PARAM_1 | DEV_PARAM_1
Photoresist | value1    | value2     | value3      | value4
Development | value5    | value6     | value7      | value8
```

TYPE_B (Equipment Split):
```
Equipment A Sheet:
Layer Name | Equipment_Param_1 | Equipment_Param_2
Photoresist | value1           | value2

Equipment B Sheet:
Layer Name | Equipment_Param_1 | Equipment_Param_2
Photoresist | value3           | value4
```

TYPE_C (Transposed):
```
Parameter Name | Layer1 | Layer2 | Layer3
SP_PARAM_1     | val1   | val2   | val3
SC_PARAM_1     | val4   | val5   | val6
```

**Critical Dependencies:**
- `openpyxl` - Excel generation
- `ExportColumnMappingRepository` - Column mapping configuration
- File system for temporary storage

**Performance Considerations:**
- Large projects (300+ columns × 60+ layers) → Excel generation ~5-10 seconds
- ZIP export of multiple projects → ~2 seconds per project
- Cleanup temp files after download → Scheduled job every 24 hours

---

### Flow 7: Dashboard Analytics Data Aggregation

**Trigger:** User navigates to dashboard (DashboardPage)
**Duration:** ~800ms (cached, reduces on repeated access)

```
DashboardPage mounts
    ↓
useDashboard hook triggers
    ↓
useEffect: Fetch dashboard stats
    ↓
API Call: GET /api/dashboard/stats
    ↓
Backend: dashboard.py router
    ↓
Database Query 1: Count projects by status
    SELECT status, COUNT(*) as count
    FROM projects
    WHERE created_by = current_user.id OR current_user.role = 'admin'
    GROUP BY status
    ↓
Results:
{
  "draft": 5,
  "review": 2,
  "approved": 12,
  "archived": 1
}
    ↓
Database Query 2: Get recent activity (last 10 changes)
    SELECT cl.*, p.product_name, u.username
    FROM changelogs cl
    JOIN projects p ON cl.project_id = p.id
    JOIN users u ON cl.created_by = u.id
    ORDER BY cl.created_at DESC
    LIMIT 10
    ↓
Database Query 3: Count active users
    SELECT COUNT(DISTINCT user_id)
    FROM changelogs
    WHERE created_at > NOW() - INTERVAL '30 days'
    ↓
API Response: {
  "project_counts": {...},
  "recent_activity": [...],
  "user_counts": {...}
}
    ↓
Frontend: React Query caches response (5 minute stale time)
    ↓
DashboardPage renders:
  - StatsPanel: Display project counts by status
  - TimelinePanel: Display recent activity
  - QuickLinks: Quick actions for common tasks
    ↓
User can refetch manually or cache invalidates after 5 minutes
```

**Data Points:**
- Input: Current user (from JWT token)
- Aggregation: Group by status, order by timestamp
- Output: Summary statistics and timeline
- Caching: React Query 5 minute stale time

**Critical Dependencies:**
- ChangeLogService - Activity tracking
- Database indexing on changelogs.created_at for performance

---

## Summary of Data Flow Patterns

### Common Patterns

1. **Authorization Check:** Every request checked via `get_current_user` dependency
2. **Validation:** Input validated before processing (Pydantic schemas)
3. **Change Logging:** Every state change logged to ChangeLogs table
4. **Caching:** Frequently accessed data cached (columns, products, dashboard)
5. **JSONB Operations:** Flexible parameter storage using PostgreSQL JSONB
6. **Async Throughout:** All database operations async for scalability

### Critical Data Structures

**JSONB Conditions:**
- 300+ parameters per layer
- Stored in ProjectLayers.conditions
- Backup copy in ProjectLayers.backbone_conditions
- Merged during updates (not replaced)

**Change Logs:**
- Immutable append-only log
- Every field change recorded individually
- Includes change type (manual, backbone, recipe, status)
- Enables audit trail and history reconstruction

**Validation Rules:**
- Per-column configuration in ColumnValidations
- Supports: range, required, conditional, pattern, cross_layer
- Applied on save, cached on client for UX feedback

### Performance Bottlenecks

1. **Grid Loading:** 300+ columns × 60+ layers → optimize AG Grid virtualization
2. **Export Generation:** Large projects → background job recommended
3. **Diff Calculation:** Recipe comparison → cache for repeated views
4. **Dashboard Aggregation:** Lots of changelogs → denormalize or index

### Security Considerations

1. **Authentication:** JWT tokens with expiration
2. **Authorization:** Role-based access control (user, admin)
3. **Project Ownership:** Users can only edit own projects
4. **Approval Workflow:** Only admin can approve projects
5. **Audit Trail:** All changes logged for compliance

---

This document provides the complete data flow view necessary for debugging, optimization, and feature development.
