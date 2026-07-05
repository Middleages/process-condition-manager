export type ValueType = 'text' | 'number' | 'choice' | 'date' | 'boolean'

export interface OptionIn {
  value: string
  display_name: string
  sort_order?: number
}

export interface OptionOut {
  id: number
  value: string
  display_name: string
  sort_order: number
  is_active: boolean
}

export interface CategoryCreate {
  code: string
  display_name: string
  sort_order?: number
}

export interface CategoryUpdate {
  display_name?: string | null
  sort_order?: number | null
  is_active?: boolean | null
}

export interface CategoryOut {
  id: number
  code: string
  display_name: string
  sort_order: number
  is_active: boolean
}

export interface ParameterOut {
  id: number
  code: string
  display_name: string
  description: string | null
  value_type: ValueType
  category_id: number | null
  unit: string | null
  min_value: number | null
  max_value: number | null
  sort_order: number
  is_active: boolean
  options: OptionOut[]
}

export interface ParameterCreate {
  code: string
  display_name: string
  value_type: ValueType
  description?: string | null
  category_id?: number | null
  unit?: string | null
  min_value?: number | null
  max_value?: number | null
  sort_order?: number
  options?: OptionIn[]
}

export interface ParameterUpdate {
  display_name?: string | null
  description?: string | null
  category_id?: number | null
  unit?: string | null
  min_value?: number | null
  max_value?: number | null
  sort_order?: number | null
  is_active?: boolean | null
}

export interface ProcessOut {
  key: string
  display_name: string
  sort_order: number
}

export interface LayerOut {
  key: string
  display_name: string
  sort_order: number
}

export interface ApiErrorBody {
  code: string
  message: string
}
