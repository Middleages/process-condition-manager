// ========== User ==========
export interface User {
  id: number
  username: string
  display_name: string
  role: 'editor' | 'reviewer' | 'admin'
  is_active: boolean
}

// ========== Line ==========
export interface Line {
  id: number
  line_code: string
  line_name: string
}

// ========== Product / Layer ==========
export interface LayerInfo {
  id: number
  layer_name: string
  step_seq: string
  layer_number: string
  sort_order: number
}

export interface ProductLayerInfo {
  id: number
  product_id: number
  layer_id: number
  layer: LayerInfo
  conditions: Record<string, unknown>
}

export interface Product {
  id: number
  product_name: string
  description: string | null
  is_backbone: boolean
  line_id: number | null
  part_id: string | null
}

export interface ProductDetail extends Product {
  layers: ProductLayerInfo[]
}

// ========== Column ==========
export interface ColumnValidation {
  id: number
  rule_type: 'range' | 'required' | 'conditional_required' | 'cross_layer'
  rule_config: Record<string, unknown>
  error_message: string
  is_active: boolean
}

export interface ColumnDefinition {
  id: number
  column_name: string
  display_name: string
  category_id: number
  data_type: 'integer' | 'float' | 'string' | 'select'
  select_options: string[] | null
  unit: string | null
  sort_order: number
  is_required: boolean
  validations: ColumnValidation[]
}

export interface ColumnCategory {
  id: number
  category_code: 'SP' | 'SC' | 'OVL' | 'DEV'
  category_name: string
  sort_order: number
  columns: ColumnDefinition[]
}

// ========== Project ==========
export type ProjectStatus = 'draft' | 'review' | 'approved' | 'rejected' | 'archived'

export interface ProjectLayerData {
  id: number
  layer_id: number
  layer_name: string
  step_seq: string
  layer_number: string
  backbone_product_id: number | null
  backbone_product_name: string | null
  conditions: Record<string, unknown>
  backbone_conditions: Record<string, unknown>
  sort_order: number
  updated_at: string
}

export interface Project {
  id: number
  product_id: number
  product_name: string
  main_backbone_id: number
  backbone_name: string
  status: ProjectStatus
  revision: number
  parent_project_id: number | null
  is_latest: boolean
  created_by: number
  creator_name: string
  layer_count: number
  created_at: string
  updated_at: string
}

export interface ProjectDetail extends Project {
  layers: ProjectLayerData[]
}

// ========== API Requests ==========
export interface ProjectCreateRequest {
  product_id: number
  backbone_product_id: number
  created_by: number
}

export interface LayerConditions {
  project_layer_id: number
  conditions: Record<string, unknown>
}

export interface BulkSaveRequest {
  layers: LayerConditions[]
  updated_by: number
  expected_updated_at: string
}

// ========== Backbone Replacement ==========
export interface BackboneReplaceRequest {
  source_product_id: number
  source_layer_name?: string | null
  changed_by: number
}

export interface BackboneReplaceResponse {
  project_layer_id: number
  backbone_product_id: number
  backbone_product_name: string
  changed_columns: number
  conditions: Record<string, unknown>
  backbone_conditions: Record<string, unknown>
}

// ========== Layer Add/Delete ==========
export interface LayerAddRequest {
  layer_id: number
  source_product_id?: number | null
  source_layer_name?: string | null
  changed_by: number
}

export interface LayerAddResponse {
  project_layer_id: number
  layer_id: number
  layer_name: string
  backbone_product_id: number | null
  backbone_product_name: string | null
  conditions: Record<string, unknown>
  sort_order: number
}

// ========== API Responses ==========
export interface BulkSaveResponse {
  success: boolean
  updated_layers: number
  change_log_count: number
  updated_at: string
}

export interface ValidationError {
  layer_id: number
  layer_name: string
  column_name: string
  display_name: string
  rule_type: string
  message: string
  metadata?: Record<string, unknown> | null
}

export interface ValidationResponse {
  project_id: number
  is_valid: boolean
  error_count: number
  errors: ValidationError[]
}

// ========== Change Log ==========
export interface ChangeLogItem {
  id: number
  project_layer_id: number
  layer_name: string
  column_name: string
  old_value: string | null
  new_value: string | null
  change_type: 'manual' | 'backbone' | 'recipe'
  changed_by: number
  changed_by_name: string
  changed_at: string
}

export interface ChangeLogListResponse {
  total: number
  items: ChangeLogItem[]
}

// ========== Recipe XML ==========
export interface RecipeDiffItem {
  column_name: string
  display_name: string
  current_value: unknown | null
  recipe_value: unknown
  is_different: boolean
  category_code: string | null
}

export interface RecipeParseWarning {
  xpath: string
  message: string
}

export interface RecipeDiffResult {
  project_layer_id: number | null
  layer_name: string | null
  detected_layer_key: string | null
  total_mapped: number
  diff_count: number
  unmapped_xpaths: string[]
  warnings: RecipeParseWarning[]
  items: RecipeDiffItem[]
}

export interface RecipeUploadResponse {
  results: RecipeDiffResult[]
}

export interface RecipeApplyItem {
  project_layer_id: number
  column_name: string
  new_value: unknown
}

export interface RecipeApplyRequest {
  changes: RecipeApplyItem[]
  applied_by: number
}

export interface RecipeApplyResponse {
  applied_count: number
  change_log_count: number
  updated_at: string
}

// ========== Editor UI State ==========
export interface DirtyCell {
  projectLayerId: number
  columnName: string
  value: unknown
  originalValue: unknown
}

export type DirtyCellMap = Map<string, DirtyCell> // key: `${projectLayerId}:${columnName}`

export interface GridRowData {
  projectLayerId: number
  layerId: number
  layerName: string
  stepSeq: string
  layerNumber: string
  sortOrder: number
  backboneProductName: string | null
  [columnName: string]: unknown // dynamic condition columns
}

// ========== Admin: XML Mapping ==========
export interface XmlMapping {
  id: number
  xpath: string
  column_id: number
  column_name: string
  display_name: string
  category_code: string
  data_type: string
  value_transform: string | null
  is_active: boolean
  created_at: string
}

export interface XmlMappingCreateRequest {
  xpath: string
  column_id: number
  value_transform?: string | null
}

export interface XmlMappingUpdateRequest {
  xpath?: string
  column_id?: number
  value_transform?: string | null
  is_active?: boolean
}

// ========== Admin: Validation Rules ==========
export interface ValidationRuleCreate {
  rule_type: 'range' | 'required' | 'conditional_required' | 'cross_layer'
  rule_config: Record<string, unknown>
  error_message: string
  is_active?: boolean
}

export interface ColumnValidationsResponse {
  column_id: number
  column_name: string
  validations: ColumnValidation[]
}

export interface BulkUploadResponse {
  total_rows: number
  columns_updated: number
  rules_created: number
  warnings: string[]
}

// ========== Revision ==========
export interface ReviseProjectRequest {
  revision_reason?: string
}

export interface RevisionItem {
  id: number
  revision: number
  status: string
  revision_reason: string | null
  created_by: string | null
  created_at: string
  is_latest: boolean
}

export interface RevisionListResponse {
  product_id: number
  product_name: string
  revisions: RevisionItem[]
}

// ========== Comments ==========
export interface CommentCreate {
  user_id: number
  project_layer_id?: number | null
  column_name?: string | null
  content: string
  comment_type?: 'rejection' | 'general'
}

export interface CommentUpdate {
  content?: string
  is_resolved?: boolean
  resolved_by?: number
}

export interface Comment {
  id: number
  project_id: number
  project_layer_id: number | null
  layer_name: string | null
  column_name: string | null
  column_display_name: string | null
  content: string
  comment_type: 'rejection' | 'general'
  is_resolved: boolean
  created_by: number
  creator_name: string
  creator_role: 'editor' | 'reviewer' | 'admin'
  created_at: string
  resolved_at: string | null
  resolved_by: number | null
  resolver_name: string | null
}

export interface CommentListResponse {
  comments: Comment[]
  total: number
  unresolved_count: number
}

// ========== Status Transition ==========
export interface StatusTransitionRequest {
  new_status: 'review' | 'approved' | 'rejected'
  changed_by: number
  comment?: string
}

export interface StatusTransitionResponse {
  id: number
  status: ProjectStatus
  previous_status: ProjectStatus
  changed_by: number
  changed_at: string
}

// ========== Change Summary ==========
export interface ChangeSummaryResponse {
  validation_error_count: number
  changed_layers_count: number
  total_layers_count: number
  changed_cells_count: number
  backbone_replacements_count: number
  recipe_applications_count: number
}

// ========== Status History ==========
export interface StatusHistoryItem {
  id: number
  from_status: string | null
  to_status: string
  changed_by: number
  changer_name: string
  comment: string | null
  changed_at: string
}

export interface StatusHistoryResponse {
  history: StatusHistoryItem[]
}

// === SPEC-004: Timeline Types ===
export interface TimelineEntryDetails {
  // For cell_change
  layer_name?: string
  column_name?: string | null
  old_value?: string | null
  new_value?: string | null
  change_type?: string  // manual, backbone, recipe
  backbone_info?: string
  // For status_change
  from_status?: string
  to_status?: string
  comment?: string | null
}

export interface TimelineEntry {
  id: string  // "change-500" or "status-5"
  entry_type: 'cell_change' | 'status_change'
  timestamp: string
  user_id: number
  user_name: string
  details: TimelineEntryDetails
}

export interface TimelineGroup {
  date: string  // "YYYY-MM-DD"
  entries: TimelineEntry[]
}

export interface TimelineResponse {
  total: number
  page: number
  limit: number
  groups: TimelineGroup[]
}

export interface TimelineParams {
  page?: number
  limit?: number
  layer_id?: number
  change_type?: string
  changed_by?: number
}

// === SPEC-004: Cell History Types ===
export interface CellHistoryItem {
  id: number
  old_value: string | null
  new_value: string | null
  change_type: string
  changed_by: number
  changed_by_name: string
  changed_at: string
}

export interface CellHistoryResponse {
  project_layer_id: number
  layer_name: string
  column_name: string
  total: number
  items: CellHistoryItem[]
}

// === SPEC-004: Version History Types ===
export interface VersionItem {
  project_id: number
  revision: number
  status: string
  is_latest: boolean
  is_current: boolean
  created_by_name: string | null
  created_at: string
  revision_reason?: string | null
}

export interface VersionHistoryResponse {
  product_id: number
  product_name: string
  current_project_id: number
  versions: VersionItem[]
}

// === SPEC-006 M3: Version Diff Types ===
export interface CellDiff {
  column_name: string
  old_value: string | null
  new_value: string | null
}

export interface LayerDiff {
  layer_id: number
  layer_name: string
  change_type: 'modified' | 'added' | 'removed'
  changes: CellDiff[]
}

export interface DiffSummary {
  total_layers_changed: number
  total_cells_changed: number
}

export interface VersionDiffResponse {
  base_project_id: number
  compare_project_id: number
  base_revision: number
  compare_revision: number
  summary: DiffSummary
  layers: LayerDiff[]
}
