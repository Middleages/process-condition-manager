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
export type ProjectStatus = 'draft' | 'review' | 'approved' | 'rejected'

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
  created_by: number
  creator_name: string
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
}

export interface ValidationResponse {
  project_id: number
  is_valid: boolean
  error_count: number
  errors: ValidationError[]
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
