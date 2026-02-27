# PCM Module Catalog

Generated: 2026-02-27
Version: 3.0.0 (SPEC-DEVICE-001 + SPEC-PROJECT-002 + SPEC-RBAC-001 + SPEC-EQP-002)

---

## Module Layer Classification

```
PRESENTATION    Routers (21) + Frontend Pages (15) + Components (70+)
BUSINESS        Services (28) + Frontend Hooks (24) + Stores (3)
DATA            Repositories (4) + Frontend API Modules (19)
INFRASTRUCTURE  Models (12) + Schemas (18) + Database + Docker + Nginx
```

---

## Backend Modules

### Presentation Layer: Routers (21 files, ~115 endpoints)

| File | Path | Endpoints | Responsibility | Key Dependencies |
|------|------|-----------|----------------|-----------------|
| auth.py | app/routers/auth.py | 4 | Login, logout, token refresh, current user | auth_service |
| users.py | app/routers/users.py | 1 | Current user profile read | get_current_user |
| lines.py | app/routers/lines.py | 1 | Line master list (public read) | Line model |
| columns.py | app/routers/columns.py | 1 | Column definitions list with validations | ColumnDefinition model |
| products.py | app/routers/products.py | 5 | Product list, layer list, product-layer joins | Product, Layer models |
| equipments.py | app/routers/equipments.py | 1 | Equipment list by line (autocomplete source) | Equipment model |
| projects.py | app/routers/projects.py | 4 | Project CRUD (V1 product-based + V2 device-ref creation) | project_service |
| project_conditions.py | app/routers/project_conditions.py | 7 | Condition bulk save/validate, change logs, cell history, version list, JSONB diff | condition_service, validation_service, change_log_service, project_analytics_service, diff_service |
| project_layers.py | app/routers/project_layers.py | 5 | Backbone replace, Recipe XML upload/apply, layer add/delete | backbone_service, recipe_service |
| project_lifecycle.py | app/routers/project_lifecycle.py | 5 | Status transitions (Draft→Review→Approved), revise, change summary | project_service, project_status_service, project_analytics_service, change_log_service |
| dashboard.py | app/routers/dashboard.py | 1 | Dashboard overview aggregations (4 query types) | dashboard_service |
| comments.py | app/routers/comments.py | 4 | Review comment CRUD per project | comment_service |
| admin.py | app/routers/admin.py | 11 | Column validations CRUD, cross-layer rules CRUD, select options, audit logs | admin_service, export_history_service |
| admin_users.py | app/routers/admin_users.py | 5 | User CRUD, deactivate, password reset | admin_user_service |
| admin_master.py | app/routers/admin_master.py | 26 | Line/Product/Layer/Column/Category CRUD + reorder | admin_master_service |
| admin_device.py | app/routers/admin_device.py | 13 | Device master admin: sync source config, meta sources, sync trigger | device_enrichment_service, device_master_sync_service, sync_source_config_service, device_meta_source_service |
| device_masters.py | app/routers/device_masters.py | 5 | Device master public queries (list, detail, layers) | device_master_query_service |
| export.py | app/routers/export.py | 3 | Export preview, single download, bulk ZIP download | export_service, export_history_service, export_validation_service |
| export_admin.py | app/routers/export_admin.py | 9 | Export system CRUD, column mapping CRUD | export_admin_service |
| export_data_source.py | app/routers/export_data_source.py | 5 | External data source CRUD | export_data_source_service |

Note: export.py registers two routers (export.router for /api/export, export.project_router for /api/projects/{id}/export).

---

### Business Layer: Services (28 files)

#### Core Project Services

| File | Path | Responsibility |
|------|------|----------------|
| project_service.py | app/services/project_service.py | Project CRUD, V1/V2 creation, backbone copy, layer initialization, revision creation |
| project_status_service.py | app/services/project_status_service.py | Status transition workflow (Draft→Review→Approved→Archived), validation pre-check |
| project_analytics_service.py | app/services/project_analytics_service.py | Change summary generation, version history list, uses ChangeLogRepository |
| condition_service.py | app/services/condition_service.py | Bulk condition save, dirty cell application, change_log recording |
| validation_service.py | app/services/validation_service.py | Single-layer column validation (range, enum, required, regex rules) |
| cross_layer_validation_service.py | app/services/cross_layer_validation_service.py | Cross-layer rules: reference_exists, compare_layers, equipment_compatibility |
| diff_service.py | app/services/diff_service.py | JSONB diff between two project versions (backbone vs current, version A vs B) |

#### Backbone and Recipe Services

| File | Path | Responsibility |
|------|------|----------------|
| backbone_service.py | app/services/backbone_service.py | Layer-level backbone replacement (copies from Approved project_layers) |
| recipe_service.py | app/services/recipe_service.py | Recipe XML parse (lxml XPath), diff against current conditions, selective apply |

#### Device Master Services (SPEC-DEVICE-001)

| File | Path | Responsibility |
|------|------|----------------|
| device_master_query_service.py | app/services/device_master_query_service.py | Device/layer master read queries for V2 project creation and admin views |
| device_master_sync_service.py | app/services/device_master_sync_service.py | Sync orchestration: pull from external source, upsert DeviceMaster/LayerMaster |
| device_enrichment_service.py | app/services/device_enrichment_service.py | Enrichment of device records with metadata from DeviceMetaSource tables |
| sync_source_config_service.py | app/services/sync_source_config_service.py | CRUD for SyncSourceConfig (external data source connection settings) |
| device_meta_source_service.py | app/services/device_meta_source_service.py | CRUD for DeviceMetaSource (metadata column definitions for device enrichment) |

#### Export Services

| File | Path | Responsibility |
|------|------|----------------|
| export_service.py | app/services/export_service.py | Export orchestration: coordinates builders, resolves data sources, calls history logger |
| export_builders.py | app/services/export_builders.py | Pure Excel-building functions: build_type_a(), build_type_b(), build_type_c() |
| export_admin_service.py | app/services/export_admin_service.py | ExportSystem and ExportColumnMapping CRUD |
| export_history_service.py | app/services/export_history_service.py | ExportHistory record creation and query |
| export_validation_service.py | app/services/export_validation_service.py | Pre-export data quality validation (completeness, required fields) |
| export_data_source_service.py | app/services/export_data_source_service.py | ExportDataSource CRUD and external table introspection |

#### Admin Services

| File | Path | Responsibility |
|------|------|----------------|
| admin_service.py | app/services/admin_service.py | Column validation CRUD, cross-layer rule CRUD, select options, audit log queries |
| admin_master_service.py | app/services/admin_master_service.py | Line/Product/Layer/ColumnDefinition/ColumnCategory CRUD with FK-safe deletion and reorder |
| admin_user_service.py | app/services/admin_user_service.py | User CRUD, role assignment, deactivation, password reset (bcrypt) |

#### Infrastructure Services

| File | Path | Responsibility |
|------|------|----------------|
| auth_service.py | app/services/auth_service.py | JWT token generation/validation, login, logout, token refresh |
| comment_service.py | app/services/comment_service.py | Review comment CRUD, uses CommentRepository for optimized joins |
| change_log_service.py | app/services/change_log_service.py | ChangeLog queries with filters, timeline, cell history; uses ChangeLogRepository |
| dashboard_service.py | app/services/dashboard_service.py | Dashboard aggregation orchestration using DashboardRepository |

---

### Data Layer: Repositories (4 files + __init__)

| File | Path | Responsibility | Optimization Focus |
|------|------|----------------|-------------------|
| backbone_repository.py | app/repositories/backbone_repository.py | Approved project backbone eligibility queries + condition retrieval | Partial index on status=Approved; avoids N+1 on layer joins |
| comment_repository.py | app/repositories/comment_repository.py | ReviewComment queries with user JOIN | Single JOIN query vs N+1 per comment |
| change_log_repository.py | app/repositories/change_log_repository.py | ChangeLog/StatusLog queries + statistics aggregations | Indexed queries on project_id + column_key; bulk fetch |
| dashboard_repository.py | app/repositories/dashboard_repository.py | 4 dashboard aggregate query types (status counts, my projects, review queue, activity timeline) | All aggregations in single SQL query per type |

---

### Infrastructure Layer: Models (12 files)

| File | Path | Entities | Key Fields |
|------|------|----------|-----------|
| user.py | app/models/user.py | User | id, username, email, roles (TEXT[]), is_active, hashed_password |
| line.py | app/models/line.py | Line | id, name |
| product.py | app/models/product.py | Product, Layer, ProductLayer | product: line_id, name; layer: step_seq, name; product_layer: conditions JSONB |
| project.py | app/models/project.py | Project, ProjectLayer | project: status, version, line_id, device_ref_id, device_ref_version; project_layer: conditions JSONB, backbone_conditions JSONB |
| column.py | app/models/column.py | ColumnCategory, ColumnDefinition, ColumnValidation | category: code (SP/SC/OVL/DEV/EQP); definition: key, display_name, data_type, order; validation: rule_type, parameters |
| change_log.py | app/models/change_log.py | ChangeLog, ProjectStatusLog, ReviewComment | changelog: project_layer_id, column_key, old_value, new_value, source_type; status_log: from/to_status |
| export.py | app/models/export.py | ExportSystem, ExportColumnMapping, RecipeXmlMapping | export_system: name, format_type; mapping: source_type (internal/external), data_source_id, source_column_name |
| export_history.py | app/models/export_history.py | ExportHistory | project_id, export_system_id, user_id, exported_at, layer_ids |
| export_data_source.py | app/models/export_data_source.py | ExportDataSource | table_name, join_key, description |
| equipment.py | app/models/equipment.py | Equipment | line_id, equipment_name (UNIQUE per line), model, PRC, ip, ftp, ftp_pw (write-only) |
| device_master.py | app/models/device_master.py | DeviceMaster, LayerMaster, SyncSourceConfig, DeviceMetaSource | device: name, code, line_id; layer_master: step_seq, name, device_master_id; sync: connection config |

---

### Infrastructure Layer: Schemas (18 files)

| File | Path | Covers |
|------|------|--------|
| user.py | app/schemas/user.py | UserResponse, UserCreate, UserUpdate |
| line.py | app/schemas/line.py | LineResponse |
| product.py | app/schemas/product.py | ProductResponse, LayerResponse |
| project.py | app/schemas/project.py | ProjectCreate (V1+V2), ProjectResponse, ProjectLayerResponse, ProjectSummary |
| column.py | app/schemas/column.py | ColumnDefinitionResponse, ColumnCategoryResponse, ColumnValidationResponse |
| comment.py | app/schemas/comment.py | ReviewCommentCreate, ReviewCommentResponse |
| backbone.py | app/schemas/backbone.py | BackboneProjectResponse, BackboneLayerResponse |
| dashboard.py | app/schemas/dashboard.py | DashboardOverviewResponse |
| export.py | app/schemas/export.py | ExportPreviewResponse, ExportSystemResponse |
| export_admin.py | app/schemas/export_admin.py | ExportSystemCreate/Update, ExportColumnMappingCreate |
| export_data_source.py | app/schemas/export_data_source.py | ExportDataSourceCreate, ExportDataSourceResponse |
| device_master.py | app/schemas/device_master.py | DeviceMasterResponse, LayerMasterResponse, SyncSourceConfigResponse |
| admin.py | app/schemas/admin.py | ValidationRuleCreate, CrossLayerRuleCreate, SelectOptionUpdate, AuditLogResponse |
| admin_master.py | app/schemas/admin_master.py | LineCreate, ProductCreate, LayerCreate, ColumnDefinitionCreate, CategoryCreate |
| admin_user.py | app/schemas/admin_user.py | AdminUserCreate, AdminUserUpdate, PasswordResetRequest |
| recipe.py | app/schemas/recipe.py | RecipeDiffResponse, RecipeApplyRequest |

---

## Frontend Modules

### Presentation Layer: Pages (15 files)

| File | Path | Route | Auth Required | Role |
|------|------|-------|---------------|------|
| LoginPage.tsx | src/pages/LoginPage.tsx | /login | No | Public authentication entry |
| DashboardPage.tsx | src/pages/DashboardPage.tsx | / | Yes | Overview: status cards, my projects, review queue, activity |
| ProjectListPage.tsx | src/pages/ProjectListPage.tsx | /projects | Yes | Project list with line + status filters, URL state sync |
| ConditionEditorPage.tsx | src/pages/ConditionEditorPage.tsx | /projects/:id/edit | Yes | Full condition table editor with panels and modals |
| NotFoundPage.tsx | src/pages/NotFoundPage.tsx | * | No | 404 fallback |
| AdminLayout.tsx | src/pages/admin/AdminLayout.tsx | /admin | Yes (admin/developer) | Admin section shell with role-filtered tabs |
| UserManagementPage.tsx | src/pages/admin/UserManagementPage.tsx | /admin/users | Yes (admin) | User CRUD, role assignment, deactivate |
| MasterDataPage.tsx | src/pages/admin/MasterDataPage.tsx | /admin/master-data | Yes (admin) | Line/Product/Layer/Column/Category/Equipment management |
| DeviceMasterPage.tsx | src/pages/admin/DeviceMasterPage.tsx | /admin/device-masters | Yes (developer) | DeviceMaster + LayerMaster admin + sync config |
| EnumManagementPage.tsx | src/pages/admin/EnumManagementPage.tsx | /admin/enum-options | Yes (admin/developer) | Select column options editor |
| XmlMappingsPage.tsx | src/pages/admin/XmlMappingsPage.tsx | /admin/xml-mappings | Yes (developer) | Recipe XML XPath mappings CRUD |
| ValidationRulesPage.tsx | src/pages/admin/ValidationRulesPage.tsx | /admin/validations | Yes (admin) | Column validation + cross-layer rule CRUD |
| ExportSystemsPage.tsx | src/pages/admin/ExportSystemsPage.tsx | /admin/export-systems | Yes (developer) | Export system + column mapping CRUD |
| ExportDataSourcesPage.tsx | src/pages/admin/ExportDataSourcesPage.tsx | /admin/data-sources | Yes (developer) | External data source CRUD |
| AuditLogPage.tsx | src/pages/admin/AuditLogPage.tsx | /admin/audit-logs | Yes (admin/developer) | Audit log viewer with filters + pagination |

---

### Business Layer: Hooks (24 files)

#### Data Fetching Hooks (TanStack Query)

| File | Path | Queries / Mutations |
|------|------|---------------------|
| useProjects.ts | src/hooks/useProjects.ts | useProjects (list), useProjectDetail, useCreateProject, useDeleteProject, useDeleteLayer, useValidateProjectMutation |
| useColumns.ts | src/hooks/useColumns.ts | useColumns (all definitions + validations) |
| useLines.ts | src/hooks/useLines.ts | useLines (line list) |
| useUsers.ts | src/hooks/useUsers.ts | useUsers (list for reviewer selection) |
| useComments.ts | src/hooks/useComments.ts | useComments, useCreateComment, useUpdateComment, useDeleteComment |
| useDashboard.ts | src/hooks/useDashboard.ts | useDashboardOverview, useRefreshDashboard |
| useProducts.ts | src/hooks/useProducts.ts | useProducts, useProductLayers (V1 backbone selection) |
| useDeviceMaster.ts | src/hooks/useDeviceMaster.ts | useDeviceMasters, useDeviceMasterLayers (V2 project creation) |

#### Editor Hooks

| File | Path | Responsibility |
|------|------|----------------|
| useEditorCellEdit.ts | src/hooks/useEditorCellEdit.ts | Cell edit dirty tracking, bulk save, autosave trigger |
| useEditorNavigation.ts | src/hooks/useEditorNavigation.ts | Layer navigation, error cell focus, category tab navigation |
| useEditorModals.ts | src/hooks/useEditorModals.ts | Modal open/close state management for all editor modals |
| useAutoSave.ts | src/hooks/useAutoSave.ts | 30-second interval autosave trigger |
| useConfirm.ts | src/hooks/useConfirm.ts | Reusable confirm dialog promise wrapper |
| useExportHistory.ts | src/hooks/useExportHistory.ts | Export history list for ExportHistoryPanel |
| useExportPreview.ts | src/hooks/useExportPreview.ts | Export preview data fetch |
| useExportSystems.ts | src/hooks/useExportSystems.ts | Export system list for ExportPanel |

#### Admin Hooks

| File | Path | Responsibility |
|------|------|----------------|
| useAdminUsers.ts | src/hooks/useAdminUsers.ts | User CRUD mutations + list queries |
| useAdminMaster.ts | src/hooks/useAdminMaster.ts | Line/Product/Layer/Column/Category/Equipment CRUD |
| useAdminColumns.ts | src/hooks/useAdminColumns.ts | ColumnDefinition + ColumnCategory mutations |
| useAdminMappings.ts | src/hooks/useAdminMappings.ts | RecipeXmlMapping CRUD |
| useAdminValidations.ts | src/hooks/useAdminValidations.ts | ColumnValidation + CrossLayerRule CRUD |
| useAdminAudit.ts | src/hooks/useAdminAudit.ts | Audit log queries with filter + pagination |
| useExportAdmin.ts | src/hooks/useExportAdmin.ts | ExportSystem + ExportColumnMapping CRUD |
| useExportDataSources.ts | src/hooks/useExportDataSources.ts | ExportDataSource CRUD |

---

### Business Layer: Stores (3 files)

| File | Path | State Managed |
|------|------|--------------|
| useEditorStore.ts | src/stores/useEditorStore.ts | gridData, dirtyCells, validationErrors, selectedLayerIndex, activeCategory, isBackboneComparisonOpen, isChangeHistoryOpen, readOnlyMode, currentVersionId |
| useAuthStore.ts | src/stores/useAuthStore.ts | currentUser (User), accessToken, isAuthenticated, fetchCurrentUser, logout, refreshToken |
| useToastStore.ts | src/stores/useToastStore.ts | toasts queue, addToast, removeToast |

---

### Data Layer: API Modules (19 files)

| File | Path | Backend Endpoints Called |
|------|------|--------------------------|
| client.ts | src/api/client.ts | Axios instance: baseURL, Bearer token injection, 401 refresh interceptor |
| authToken.ts | src/api/authToken.ts | POST /api/auth/login, POST /api/auth/logout, POST /api/auth/refresh, GET /api/auth/me |
| projects.ts | src/api/projects.ts | GET/POST /api/projects, GET/PUT/DELETE /api/projects/:id, project lifecycle endpoints |
| columns.ts | src/api/columns.ts | GET /api/columns |
| lines.ts | src/api/lines.ts | GET /api/lines |
| users.ts | src/api/users.ts | GET /api/users |
| comments.ts | src/api/comments.ts | GET/POST/PUT/DELETE /api/projects/:id/comments |
| dashboard.ts | src/api/dashboard.ts | GET /api/dashboard |
| products.ts | src/api/products.ts | GET /api/products, GET /api/products/:id/layers |
| equipments.ts | src/api/equipments.ts | GET /api/equipments?line_id=X |
| export.ts | src/api/export.ts | GET /api/projects/:id/export/*, POST /api/export/bulk |
| exportAdmin.ts | src/api/exportAdmin.ts | GET/POST/PUT/DELETE /api/admin/export-systems, /api/admin/export-mappings |
| exportDataSource.ts | src/api/exportDataSource.ts | GET/POST/PUT/DELETE /api/admin/export-data-sources |
| deviceMaster.ts | src/api/deviceMaster.ts | GET /api/device-masters, GET /api/device-masters/:id/layers |
| adminUsers.ts | src/api/adminUsers.ts | GET/POST/PUT /api/admin/users, PATCH deactivate/reset-password |
| adminMaster.ts | src/api/adminMaster.ts | CRUD for /api/admin/lines, products, layers, columns, categories, equipments |
| adminColumns.ts | src/api/adminColumns.ts | CRUD for /api/admin/column-definitions, /api/admin/column-categories |
| adminMappings.ts | src/api/adminMappings.ts | CRUD for /api/admin/xml-mappings |
| adminValidations.ts | src/api/adminValidations.ts | CRUD for /api/admin/validations, /api/admin/cross-layer-rules |
| adminAudit.ts | src/api/adminAudit.ts | GET /api/admin/audit-logs |
| admin.ts | src/api/admin.ts | GET /api/admin/select-options, PUT /api/admin/select-options/:id |

---

### Presentation Layer: Components (70+ files, 8 subdirectories)

#### editor/ (28 files) — Core Condition Table Editor

| File | Responsibility |
|------|----------------|
| ConditionGrid.tsx | AG Grid community wrapper: renders condition table, handles cell edit events |
| buildColumnDefs.ts | Builds AG Grid ColDef array from ColumnDefinition list; auto-detects EQP_xx → autocomplete editor |
| GridContextMenu.tsx | Right-click context menu: copy row, paste, fill down |
| EditorHeader.tsx | Project title, status badge, action buttons (save, validate, BB compare toggle) |
| CategoryTabs.tsx | SP/SC/OVL/DEV/EQP category tab switcher |
| LayerNavPanel.tsx | Left-side layer list with navigation and add/delete |
| ValidationPanel.tsx | Validation error list with cross-layer error distinction + cell focus navigation |
| ChangeHistoryPanel.tsx | Slide-out change history with filters |
| ChangeHistoryEntry.tsx | Single change log entry display |
| ChangeHistoryFilters.tsx | Filter bar for change history panel |
| BackboneComparisonPanel.tsx | Side panel: backbone vs current diff summary by layer |
| BackboneComparisonView.tsx | Detailed diff view: column-level changes per layer |
| VersionHistoryPanel.tsx | Version list dropdown with read-only archived version viewer |
| VersionDiffView.tsx | Side-by-side diff view between two versions |
| CellHistoryModal.tsx | Modal: complete edit history for a single cell |
| CommentPanel.tsx | Review comment thread panel |
| CommentDialog.tsx | Comment create/edit dialog |
| CommentThread.tsx | Threaded comment display |
| ReviewRequestModal.tsx | Submit for review: validation summary + backbone comparison preview |
| ApprovalButtons.tsx | Approve / Reject action buttons (reviewer role) |
| RevisionCreateModal.tsx | Create new revision with reason input |
| StatusBanner.tsx | Top banner showing current project status |
| StatusTimeline.tsx | Visual timeline of status transitions |
| BackboneReplaceModal.tsx | Modal: select and replace backbone for a specific layer |
| RecipeUploadModal.tsx | Modal: upload Recipe XML file |
| RecipeDiffTable.tsx | Table showing XML diff results with apply checkboxes |
| LayerAddModal.tsx | Modal: add new layer to project |
| EquipmentAutocompleteEditor.tsx | Custom AG Grid cell editor: searchable equipment dropdown |

#### admin/ (23 files) — Admin Management Panels

| File | Responsibility |
|------|----------------|
| LineManagementPanel.tsx | Line CRUD with inline editing |
| LineFormModal.tsx | Line create/edit modal |
| ProductManagementPanel.tsx | Product CRUD |
| ProductFormModal.tsx | Product create/edit modal |
| LayerManagementPanel.tsx | Layer CRUD with reorder |
| LayerFormModal.tsx | Layer create/edit modal |
| ColumnMetadataPanel.tsx | Column definition list with category grouping |
| CategoryManagementPanel.tsx | Column category CRUD |
| EquipmentManagementPanel.tsx | Equipment master CRUD per line |
| EquipmentFormModal.tsx | Equipment create/edit modal |
| UserFormModal.tsx | User create/edit with multi-role checkbox UI |
| PasswordResetModal.tsx | Admin password reset for a user |
| ValidationEditModal.tsx | Column validation rule create/edit |
| CrossLayerRuleForm.tsx | Cross-layer validation rule form |
| MappingFormModal.tsx | XML mapping create/edit modal |
| ExportSystemForm.tsx | Export system create/edit |
| ExportMappingForm.tsx | Export column mapping form |
| ExportMappingManager.tsx | Export mapping list manager |
| ExportDataSourceForm.tsx | External data source form |
| SelectOptionsEditModal.tsx | Select column options editor |
| DeviceDetailModal.tsx | Device master detail view |
| DeviceMetaSourceFormModal.tsx | DeviceMetaSource create/edit form |
| BulkUploadModal.tsx | Bulk data upload interface |

#### export/ (6 files) — Export UI

| File | Responsibility |
|------|----------------|
| ExportPanel.tsx | Export system selector + download trigger (Approved projects only) |
| ExportSystemList.tsx | List of available export systems |
| ExportPreviewTable.tsx | Preview grid for selected export system |
| ExportDownloadButton.tsx | Single/bulk download action button |
| ExportHistoryPanel.tsx | Export history log display |
| ExportValidationReport.tsx | Pre-download validation result display |

#### projects/ (3 files)

| File | Responsibility |
|------|----------------|
| StatusBadge.tsx | Colored status badge (Draft/Review/Approved/Archived) |
| VersionHistoryModal.tsx | Full version history modal from project list |
| ProjectCreateModalV2.tsx | V2 project creation: DeviceMaster + LayerMaster selection |

#### auth/ (2 files + tests)

| File | Responsibility |
|------|----------------|
| ProtectedRoute.tsx | Redirects to /login if not authenticated |
| RequireRole.tsx | Role-gated render wrapper for admin UI elements |

#### layout/ (2 files)

| File | Responsibility |
|------|----------------|
| Header.tsx | Top navigation: project nav, user info, multi-role badge, logout |
| Layout.tsx | App shell: Header + Outlet (React Router) |

#### ui/ (8 files) — Headless/Primitive UI Components

button.tsx, dialog.tsx, input.tsx, select.tsx, badge.tsx, toast.tsx, combobox.tsx, confirm-dialog.tsx

#### Root-level

| File | Responsibility |
|------|----------------|
| ErrorBoundary.tsx | React error boundary: catches render errors, displays fallback UI |
