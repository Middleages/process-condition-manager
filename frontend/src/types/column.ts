// ========== Column ==========
export type CategoryCode = 'SP' | 'SC' | 'OVL' | 'DEV' | 'EQP'

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
  use_yn: boolean
  validations: ColumnValidation[]
}

export interface ColumnCategory {
  id: number
  category_code: CategoryCode
  category_name: string
  sort_order: number
  columns: ColumnDefinition[]
}
