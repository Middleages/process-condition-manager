// 전산 출력 시스템 타입 정의

// ========== External Data Source Types ==========

// JOIN key mapping type
export interface JoinKeyMapping {
  external_column: string
  pcm_field: 'project.product_id' | 'layer.step_seq' | 'layer.layer_name' | 'layer.layer_number'
}

export interface ExportDataSource {
  id: number
  source_name: string
  table_name: string
  schema_name: string
  description: string | null
  join_key_mappings: JoinKeyMapping[]
  is_active: boolean
  created_at: string
  updated_at: string
  mapping_count: number
}

export interface ExportDataSourceCreate {
  source_name: string
  table_name: string
  schema_name?: string
  description?: string
  join_key_mappings: JoinKeyMapping[]
  is_active?: boolean
}

export interface ExportDataSourceUpdate {
  source_name?: string
  table_name?: string
  schema_name?: string
  description?: string
  join_key_mappings?: JoinKeyMapping[]
  is_active?: boolean
}

export interface ColumnInfo {
  column_name: string
  data_type: string
}

export interface ExportSystem {
  id: number
  system_name: string
  format_type: 'TYPE_A' | 'TYPE_B' | 'TYPE_C'
  description: string | null
  column_count: number
  is_active: boolean
}

export interface ExportPreview {
  system_name: string
  format_type: string
  headers: string[]
  rows: Record<string, unknown>[]
  total_rows: number
}

export interface ExportHistory {
  id: number
  project_id: number
  export_system_id: number
  system_name: string
  exported_by: number
  exported_by_name: string
  export_type: 'single' | 'bulk'
  file_count: number
  total_rows: number
  exported_at: string
}

export interface ExportHistoryList {
  items: ExportHistory[]
  total: number
}

// ========== Admin Export System Types ==========

export interface ExportSystemAdmin {
  id: number
  system_name: string
  format_type: 'TYPE_A' | 'TYPE_B' | 'TYPE_C'
  description: string | null
  additional_config: Record<string, unknown> | null
  is_active: boolean
  created_at: string
  column_count: number
}

export interface ExportSystemCreate {
  system_name: string
  format_type: 'TYPE_A' | 'TYPE_B' | 'TYPE_C'
  description?: string
  additional_config?: Record<string, unknown>
  is_active?: boolean
}

export interface ExportMapping {
  id: number
  source_type: 'condition' | 'external'
  column_id: number | null
  column_name: string | null
  category_code: string | null
  data_source_id: number | null
  data_source_name: string | null
  source_column_name: string | null
  target_column_name: string
  sort_order: number
  is_required: boolean
}

export interface ExportMappingCreate {
  source_type?: 'condition' | 'external'
  column_id?: number
  data_source_id?: number
  source_column_name?: string
  target_column_name: string
  is_required?: boolean
}

// ========== Export Validation Types ==========

export interface ExportValidationIssue {
  level: 'error' | 'warning'
  layer_name: string
  column_name: string
  message: string
}

export interface ExportValidationSystemResult {
  system_id: number
  system_name: string
  error_count: number
  warning_count: number
  issues: ExportValidationIssue[]
}

export interface ExportValidationResponse {
  results: ExportValidationSystemResult[]
  has_errors: boolean
  total_errors: number
  total_warnings: number
}
