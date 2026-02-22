import { ColumnValidation } from './column'

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

