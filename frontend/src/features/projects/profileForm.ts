import { PROJECT_PROFILE_PATCH_FIELDS } from '@/api/types'
import type { ProjectProfileOut, ProjectProfilePatchIn } from '@/api/types'
import { normalizeDecimalInput } from '@/shared/domain/decimal'

export const REQUIRED_PROFILE_FIELDS = [
  'process_name',
  'device_type_code',
  'project_category_code',
] as const

export const OPTIONAL_CHOICE_PROFILE_FIELDS = [
  'active_direction_code',
  'gate_direction_code',
] as const

export const DECIMAL_PROFILE_FIELDS = [
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
] as const

export const NULLABLE_TEXT_PROFILE_FIELDS = [
  'comment',
  'gross_die',
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
] as const

export const PROFILE_FORM_FIELDS = PROJECT_PROFILE_PATCH_FIELDS

export type ProfileFormField = (typeof PROFILE_FORM_FIELDS)[number]
export type ProfileFormState = Record<ProfileFormField, string>
export type ProfileFormErrors = Partial<Record<ProfileFormField, string>>
export type ProfileChoiceField =
  | 'device_type_code'
  | 'project_category_code'
  | 'active_direction_code'
  | 'gate_direction_code'

export interface ProfileChoiceFieldAuthorization {
  ready: boolean
  activeCodes: ReadonlySet<string>
}

export type ProfileChoiceAuthorization = Record<
  ProfileChoiceField,
  ProfileChoiceFieldAuthorization
>

export interface ProfilePatchPlan {
  payload: ProjectProfilePatchIn | null
  errors: ProfileFormErrors
  dirty: boolean
}

type NormalizedProfileForm = Record<ProfileFormField, string | null>

/** Hydrates only the approved mutable fields. Resolved choice objects become their stable codes. */
export function hydrateProfileForm(profile: ProjectProfileOut): ProfileFormState {
  return {
    process_name: profile.process_name,
    device_type_code: profile.device_type.code,
    project_category_code: profile.project_category.code,
    comment: profile.comment ?? '',
    active_direction_code: profile.active_direction?.code ?? '',
    gate_direction_code: profile.gate_direction?.code ?? '',
    gross_die: profile.gross_die ?? '',
    pitch_x: profile.pitch_x ?? '',
    pitch_y: profile.pitch_y ?? '',
    shot_x: profile.shot_x ?? '',
    shot_y: profile.shot_y ?? '',
    slit_occupancy: profile.slit_occupancy ?? '',
    lens_occupancy: profile.lens_occupancy ?? '',
    map_offset_x: profile.map_offset_x ?? '',
    map_offset_y: profile.map_offset_y ?? '',
    scribe_lane_x: profile.scribe_lane_x ?? '',
    scribe_lane_y: profile.scribe_lane_y ?? '',
    shot_count: profile.shot_count ?? '',
    full_shot: profile.full_shot ?? '',
    layer_total: profile.layer_total ?? '',
    euv: profile.euv ?? '',
    imm: profile.imm ?? '',
    arf: profile.arf ?? '',
    krf: profile.krf ?? '',
    iline: profile.iline ?? '',
    soh: profile.soh ?? '',
    pspi: profile.pspi ?? '',
    metal_layer_count: profile.metal_layer_count ?? '',
  }
}

/**
 * Validates and canonicalizes the whole candidate before constructing an exact diff.
 * Invalid drafts never produce a partial request payload.
 */
export function toProfilePatch(
  original: ProfileFormState,
  draft: ProfileFormState,
  choiceAuthorization: ProfileChoiceAuthorization,
): ProfilePatchPlan {
  const errors: ProfileFormErrors = {}
  const baseline = normalizeProfileForm(original)
  const candidate = normalizeProfileForm(draft, errors)
  let dirty = false

  for (const field of PROFILE_FORM_FIELDS) {
    if (candidate[field] !== baseline[field]) dirty = true
  }

  validateRequired(candidate, errors)
  validateChangedChoices(baseline, candidate, choiceAuthorization, errors)

  if (Object.keys(errors).length > 0) {
    // An invalid decimal has no canonical candidate value. Compare its preserved raw text so the
    // navigation guard still treats the draft as changed.
    for (const field of DECIMAL_PROFILE_FIELDS) {
      if (errors[field] && draft[field].trim() !== (baseline[field] ?? '')) dirty = true
    }
    return { payload: null, errors, dirty }
  }

  const payload: ProjectProfilePatchIn = {}
  const mutablePayload = payload as Record<ProfileFormField, string | null | undefined>
  for (const field of PROFILE_FORM_FIELDS) {
    if (candidate[field] !== baseline[field]) mutablePayload[field] = candidate[field]
  }

  return { payload, errors, dirty }
}

function normalizeProfileForm(
  state: ProfileFormState,
  errors: ProfileFormErrors = {},
): NormalizedProfileForm {
  const normalized = {} as NormalizedProfileForm

  for (const field of REQUIRED_PROFILE_FIELDS) normalized[field] = state[field].trim()
  for (const field of OPTIONAL_CHOICE_PROFILE_FIELDS) {
    normalized[field] = emptyToNull(state[field])
  }
  for (const field of NULLABLE_TEXT_PROFILE_FIELDS) {
    normalized[field] = emptyToNull(state[field])
  }
  for (const field of DECIMAL_PROFILE_FIELDS) {
    const result = normalizeDecimalInput(state[field])
    if (result.kind === 'invalid') {
      errors[field] = '유효한 10진수를 입력해 주세요.'
      // Preserve a distinct sentinel for dirty comparison; the caller returns no payload.
      normalized[field] = state[field].trim()
    } else {
      normalized[field] = result.value
    }
  }

  return normalized
}

function validateRequired(
  candidate: NormalizedProfileForm,
  errors: ProfileFormErrors,
): void {
  if (candidate.process_name === '') errors.process_name = 'Process Name은 필수입니다.'
  if (candidate.device_type_code === '') {
    errors.device_type_code = 'Device Type은 필수입니다.'
  }
  if (candidate.project_category_code === '') {
    errors.project_category_code = 'Category는 필수입니다.'
  }
}

function validateChangedChoices(
  baseline: NormalizedProfileForm,
  candidate: NormalizedProfileForm,
  authorization: ProfileChoiceAuthorization,
  errors: ProfileFormErrors,
): void {
  validateChangedChoice('device_type_code', baseline, candidate, authorization, errors)
  validateChangedChoice('project_category_code', baseline, candidate, authorization, errors)
  validateChangedChoice('active_direction_code', baseline, candidate, authorization, errors)
  validateChangedChoice('gate_direction_code', baseline, candidate, authorization, errors)
}

function validateChangedChoice(
  field: ProfileChoiceField,
  baseline: NormalizedProfileForm,
  candidate: NormalizedProfileForm,
  authorization: ProfileChoiceAuthorization,
  errors: ProfileFormErrors,
): void {
  const value = candidate[field]
  if (value === baseline[field] || value === null || value === '') return

  const fieldAuthorization = authorization[field]
  if (!fieldAuthorization.ready) {
    errors[field] = '최신 선택지를 확인한 뒤 다시 선택해 주세요.'
  } else if (!fieldAuthorization.activeCodes.has(value)) {
    errors[field] = '현재 활성 상태인 선택지를 선택해 주세요.'
  }
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
