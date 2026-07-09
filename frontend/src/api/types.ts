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
  line_id: string
  process_id: string
  display_name: string
  sort_order: number
  has_project: boolean
}

export interface ProcessListOut {
  items: ProcessOut[]
  next_cursor: string | null
}

export interface ProcessDetailOut {
  key: string
  line_id: string
  process_id: string
  display_name: string
  step_count: number
  area_names: string[]
  has_project: boolean
  project_count: number
}

export interface LayerOut {
  key: string
  step_seq: string
  layer_id: string
  eqp_type: string | null
  eqp_type_desc: string | null
  area_name: string | null
  sort_order: number
}

export interface ManualOverrideIn {
  target_layer_key: string
  source_layer_key: string
}

export interface ProjectCreate {
  line_id: string
  process_id: string
  part_id: string
  name: string
  description?: string | null
  backbone_project_id?: number | null
  manual_overrides?: ManualOverrideIn[]
}

export interface ProjectLayerOut {
  id: number
  layer_key: string
  step_seq: string
  layer_id: string
  eqp_type: string | null
  eqp_type_desc: string | null
  area_name: string | null
  sort_order: number
  condition_count: number
  cell_count: number
  source_project_id: number | null
  source_layer_key: string | null
}

export interface ProjectOut {
  id: number
  line_id: string
  process_id: string
  part_id: string
  name: string
  description: string | null
  status: 'draft'
  layers: ProjectLayerOut[]
}

export interface ProjectSummaryOut {
  id: number
  line_id: string
  process_id: string
  part_id: string
  name: string
  description: string | null
  status: 'draft'
  layer_count: number
  cell_count: number
}

export interface ProjectListOut {
  items: ProjectSummaryOut[]
  next_cursor: number | null
}

export interface ApiErrorBody {
  code: string
  message: string
}
