// 전산 출력 시스템 타입 정의

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
  column_id: number
  column_name: string
  category_code: string | null
  target_column_name: string
  sort_order: number
  is_required: boolean
}

export interface ExportMappingCreate {
  column_id: number
  target_column_name: string
  is_required?: boolean
}

// ========== Equipment Types ==========

export interface Equipment {
  id: number
  project_layer_id: number
  equipment_id: string
  equipment_params: Record<string, string>
  sort_order: number
  created_at: string
  updated_at: string
}

export interface EquipmentCreate {
  equipment_id: string
  equipment_params?: Record<string, string>
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
