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
  line_id: number | null
  line_name: string | null
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

// ========== Recipe Apply ==========
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

export type RuleType =
  | 'required'
  | 'range'
  | 'conditional_required'
  | 'cross_layer'
  | 'client'

export interface ValidationError {
  layer_id: number
  layer_name: string
  column_name: string
  display_name: string
  rule_type: RuleType
  message: string
  metadata?: Record<string, unknown> | null
}

export interface ValidationResponse {
  project_id: number
  is_valid: boolean
  error_count: number
  errors: ValidationError[]
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

// ========== Status Transition ==========
export interface StatusTransitionRequest {
  new_status: 'review' | 'approved' | 'rejected'
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
