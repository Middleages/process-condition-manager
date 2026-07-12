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

export interface ImportRowOut {
  line: number
  code: string
  action: 'create' | 'update' | 'error'
  message: string | null
}

export interface ImportResultOut {
  created_count: number
  updated_count: number
  error_count: number
  rows: ImportRowOut[]
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

export interface BackboneCandidateOut {
  id: number
  name: string
  line_id: string
  process_id: string
  part_id: string
  status: string
  layer_count: number
  match_rate: number
  matched_count: number
  unmatched_count: number
}

export type MatchType = 'auto' | 'manual' | 'unmatched'

export interface MatchOut {
  target_layer_key: string
  source_layer_key: string | null
  match_type: MatchType
}

export interface MatchPreviewOut {
  match_rate: number
  matched_count: number
  unmatched_count: number
  copy_condition_count: number
  copy_cell_count: number
  matches: MatchOut[]
}

export interface BackboneReplaceIn {
  source_project_id: number
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

// --- 시트 조회 (GET /api/projects/{project_id}/sheet) ---
// backend `features/sheets/schema.py`와 1:1 대응. 필드명은 snake_case 그대로 (camelCase 변환 레이어 없음).

/** 그리드 컬럼 정의 한 개 (= live 파라미터 한 개). SheetColumnOut. */
export interface SheetColumnOut {
  parameter_code: string
  display_name: string
  value_type: ValueType
  category_code: string | null
  unit: string | null
  description: string | null
  // choice 타입일 때만 채워진다 (number/text는 빈 리스트).
  choice_options: string[]
  sort_order: number
}

/** 그리드 행 한 개 (= layer 안의 조건 행 한 개). SheetRowOut. */
export interface SheetRowOut {
  condition_id: number
  layer_key: string
  // P1-D3 병기 규칙: "{layer_id} ({step_seq})"
  layer_label: string
  condition_label: string
  is_por: boolean
  // parameter_code -> value_text. 값이 없는 셀은 응답에서 생략된다 (희소 표현).
  cells: Record<string, string | null>
}

/** 편집 잠금 요약 — 비보유자 "누가 편집 중" 표시용. SheetLockSummaryOut (T5 전까지 항상 미잠금 스텁). */
export interface SheetLockSummaryOut {
  locked_by: string | null
  // datetime → ISO8601 문자열로 직렬화된다.
  locked_at: string | null
  expires_at: string | null
  is_mine: boolean
}

/** 시트 조회 응답: 컬럼 정의 + 본문 행 + 잠금 요약. SheetOut. */
export interface SheetOut {
  columns: SheetColumnOut[]
  rows: SheetRowOut[]
  lock: SheetLockSummaryOut
}

// --- 편집 잠금 (POST/DELETE /api/projects/{project_id}/lock, POST .../lock/heartbeat) ---

/** 잠금 획득/하트비트 응답. LockOut. */
export interface LockOut {
  locked_by: string
  lock_token: string
  locked_at: string
  expires_at: string
}

// --- 셀 배치 편집 (PATCH /api/projects/{project_id}/cells) ---
// 자동저장 파이프라인(T3). 백엔드와 동시 구현 중이라 계약대로 프론트를 먼저 맞춰 둔다.

/** 편집 출처 — 수동 셀 편집인지 붙여넣기 적용(T4)인지 구분. */
export type CellUpdateOrigin = 'manual' | 'paste'

/**
 * 셀 한 개의 갱신값(요청/응답 공용 형태).
 *
 * condition_id는 number다(그리드 계약의 문자열 id와 다름 — 경계에서 변환한다).
 * value=null은 "셀 비우기"를 뜻한다(빈 문자열이 아니라 NULL).
 */
export interface CellUpdateIn {
  condition_id: number
  parameter_code: string
  value: string | null
}

/** PATCH /cells 요청 바디. origin은 선택. */
export interface CellsPatchIn {
  cells: CellUpdateIn[]
  origin?: CellUpdateOrigin
}

/** PATCH /cells 응답: 반영된 셀 + 배치 식별자. */
export interface CellsPatchOut {
  cells: CellUpdateIn[]
  batch_id: string
}
