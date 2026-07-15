export type ValueType = 'text' | 'number' | 'choice'

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
  min_value: string | null
  max_value: string | null
  required: boolean
  pattern: string | null
  pattern_hint: string | null
  choice_set: ChoiceSetSummaryOut | null
  sort_order: number
  is_active: boolean
}

export interface ParameterCreate {
  code: string
  display_name: string
  value_type: ValueType
  choice_set_code: string | null
  description?: string | null
  category_id?: number | null
  unit?: string | null
  min_value?: string | null
  max_value?: string | null
  required?: boolean
  pattern?: string | null
  pattern_hint?: string | null
  sort_order?: number
}

export interface ParameterUpdate {
  display_name?: string | null
  description?: string | null
  category_id?: number | null
  unit?: string | null
  min_value?: string | null
  max_value?: string | null
  required?: boolean | null
  pattern?: string | null
  pattern_hint?: string | null
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

export interface ChoiceValueOut {
  code: string
  label: string
  is_active: boolean
}

export interface ProjectProfileOut {
  project_id: number
  process_name: string
  device_type: ChoiceValueOut
  project_category: ChoiceValueOut
  comment: string | null
  active_direction: ChoiceValueOut | null
  gate_direction: ChoiceValueOut | null
  gross_die: string | null
  pitch_x: string | null
  pitch_y: string | null
  shot_x: string | null
  shot_y: string | null
  slit_occupancy: string | null
  lens_occupancy: string | null
  map_offset_x: string | null
  map_offset_y: string | null
  scribe_lane_x: string | null
  scribe_lane_y: string | null
  shot_count: string | null
  full_shot: string | null
  layer_total: string | null
  euv: string | null
  imm: string | null
  arf: string | null
  krf: string | null
  iline: string | null
  soh: string | null
  pspi: string | null
  metal_layer_count: string | null
  created_at: string
  updated_at: string
}

/**
 * Atomic mutable boundary for the fixed Project Profile.
 *
 * Every property is optional because omission means "leave unchanged". Only the three required
 * stored strings reject an explicitly supplied null; all other values may be cleared with null.
 * Identity, resolved choice objects, provenance, and timestamps intentionally do not exist here.
 */
export interface ProjectProfilePatchIn {
  process_name?: string
  device_type_code?: string
  project_category_code?: string
  comment?: string | null
  active_direction_code?: string | null
  gate_direction_code?: string | null
  gross_die?: string | null
  pitch_x?: string | null
  pitch_y?: string | null
  shot_x?: string | null
  shot_y?: string | null
  slit_occupancy?: string | null
  lens_occupancy?: string | null
  map_offset_x?: string | null
  map_offset_y?: string | null
  scribe_lane_x?: string | null
  scribe_lane_y?: string | null
  shot_count?: string | null
  full_shot?: string | null
  layer_total?: string | null
  euv?: string | null
  imm?: string | null
  arf?: string | null
  krf?: string | null
  iline?: string | null
  soh?: string | null
  pspi?: string | null
  metal_layer_count?: string | null
}

/** Explicit runtime allow-list used by form diffing and contract tests. */
export const PROJECT_PROFILE_PATCH_FIELDS = [
  'process_name',
  'device_type_code',
  'project_category_code',
  'comment',
  'active_direction_code',
  'gate_direction_code',
  'gross_die',
  'pitch_x',
  'pitch_y',
  'shot_x',
  'shot_y',
  'slit_occupancy',
  'lens_occupancy',
  'map_offset_x',
  'map_offset_y',
  'scribe_lane_x',
  'scribe_lane_y',
  'shot_count',
  'full_shot',
  'layer_total',
  'euv',
  'imm',
  'arf',
  'krf',
  'iline',
  'soh',
  'pspi',
  'metal_layer_count',
] as const satisfies readonly (keyof ProjectProfilePatchIn)[]

export interface ProjectCreate {
  line_id: string
  process_id: string
  part_id: string
  name: string
  device_type_code: string
  project_category_code: string
  comment?: string | null
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
  status: 'draft'
  profile: ProjectProfileOut
  layers: ProjectLayerOut[]
}

export interface ProjectSummaryOut {
  id: number
  line_id: string
  process_id: string
  part_id: string
  name: string
  status: 'draft'
  device_type: ChoiceValueOut
  project_category: ChoiceValueOut
  layer_total: string | null
  updated_at: string
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
  details?: Record<string, unknown>
}

// --- managed choice sets (/api/choice-sets) ---
// Transport fields intentionally remain snake_case to match the backend schemas exactly.

export interface ChoiceSetCreateIn {
  code: string
  display_name: string
  description?: string | null
}

export interface ChoiceSetPatchIn {
  expected_version: number
  display_name?: string | null
  description?: string | null
  is_active?: boolean | null
}

export interface ChoiceOptionCreateIn {
  expected_version: number
  code: string
  label: string
  sort_order?: number
  is_active?: boolean
}

export interface ChoiceOptionPatchIn {
  expected_version: number
  label?: string | null
  sort_order?: number | null
  is_active?: boolean | null
}

export interface ChoiceOptionOrderIn {
  expected_version: number
  ordered_codes: string[]
}

export interface ChoiceImportIn {
  expected_version: number
  csv_text: string
}

export interface ChoiceSetSummaryOut {
  code: string
  display_name: string
  description: string | null
  is_active: boolean
  version: number
  option_count: number
  active_option_count: number
  parameter_usage_count: number
  profile_usage_fields: string[]
  created_at: string
  updated_at: string
}

export interface ChoiceOptionOut {
  code: string
  label: string
  sort_order: number
  is_active: boolean
}

export interface ChoiceOptionPageOut {
  set_code: string
  version: number
  items: ChoiceOptionOut[]
  next_cursor: string | null
}

export interface ChoiceOptionAggregate {
  set_code: string
  version: number
  items: ChoiceOptionOut[]
}

export interface ChoiceOptionMutationOut {
  choice_set: ChoiceSetSummaryOut
  option: ChoiceOptionOut
}

export type ChoiceImportAction = 'create' | 'update' | 'error'

export interface ChoiceImportRowOut {
  line: number
  code: string
  action: ChoiceImportAction
  message: string | null
}

export interface ChoiceImportPreviewOut {
  set_code: string
  base_version: number
  created_count: number
  updated_count: number
  error_count: number
  rows: ChoiceImportRowOut[]
}

export interface ChoiceImportApplyOut {
  choice_set: ChoiceSetSummaryOut
  created_count: number
  updated_count: number
  error_count: 0
  rows: ChoiceImportRowOut[]
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
  // choice 타입일 때만 둘 다 채워진다. option은 SheetOut에 임베드하지 않는다.
  choice_set_code: string | null
  choice_set_version: number | null
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
  /** 서버 설정에서 내려오는 잠금 heartbeat/readonly 재시도 주기. */
  heartbeat_seconds: number
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

// --- 조건 행 관리 (POST .../layers/{layer_key}/conditions, DELETE .../conditions/{id}, PUT .../por) ---
// backend `features/conditions/schema.py`(ConditionCreateIn/ConditionOut)와 1:1 대응 (snake_case).
// 구조 변경(추가/복제/삭제/POR 이양)은 더티 셀 버퍼와 분리된 즉시 API 호출이다(T7 즉시 커밋 원칙).

/**
 * 조건 행 추가/복제 요청 바디.
 *
 * source_condition_id가 null/생략이면 빈 조건 행을 추가하고, 값이 있으면 그 조건 행(같은
 * layer 소속이어야 함)의 셀 값을 전부 복사해 새 행을 만든다.
 */
export interface ConditionCreateIn {
  source_condition_id?: number | null
}

/** 조건 행 한 개의 최소 표현 (추가/복제·POR 이양 응답). ConditionOut. */
export interface ConditionOut {
  id: number
  layer_key: string
  label: string
  condition_index: number
  is_por: boolean
}
