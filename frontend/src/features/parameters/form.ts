import type { ParameterCreate, ParameterOut, ParameterUpdate, ValueType } from '@/api/types'
import {
  compareCanonicalDecimals,
  normalizeDecimalInput,
} from '@/shared/domain/decimal'

export interface ParameterFormState {
  code: string
  displayName: string
  valueType: ValueType
  description: string
  categoryId: string
  unit: string
  minValue: string
  maxValue: string
  required: boolean
  pattern: string
  patternHint: string
  choiceSetCode: string
}

export type ParameterFieldErrors = Partial<Record<keyof ParameterFormState, string>>

export interface ParameterCreatePlan {
  payload: ParameterCreate
  fieldErrors: ParameterFieldErrors
  dirty: boolean
}

export interface ParameterUpdatePlan {
  payload: ParameterUpdate
  fieldErrors: ParameterFieldErrors
  dirty: boolean
}

export interface ParameterCreateValidationContext {
  activeChoiceSetCodes?: ReadonlySet<string>
  authorizedChoiceSetCode?: string | null
}

export const initialParameterFormState: ParameterFormState = {
  code: '',
  displayName: '',
  valueType: 'text',
  description: '',
  categoryId: '',
  unit: '',
  minValue: '',
  maxValue: '',
  required: false,
  pattern: '',
  patternHint: '',
  choiceSetCode: '',
}

export function stateFromParameter(parameter: ParameterOut): ParameterFormState {
  return {
    code: parameter.code,
    displayName: parameter.display_name,
    valueType: parameter.value_type,
    description: parameter.description ?? '',
    categoryId: parameter.category_id?.toString() ?? '',
    unit: parameter.unit ?? '',
    minValue: parameter.min_value ?? '',
    maxValue: parameter.max_value ?? '',
    required: parameter.required,
    pattern: parameter.pattern ?? '',
    patternHint: parameter.pattern_hint ?? '',
    choiceSetCode: parameter.choice_set?.code ?? '',
  }
}

export function toCreatePayload(state: ParameterFormState): ParameterCreate {
  const number = state.valueType === 'number'
  const text = state.valueType === 'text'
  return {
    code: state.code.trim(),
    display_name: state.displayName.trim(),
    value_type: state.valueType,
    choice_set_code:
      state.valueType === 'choice' ? normalizeChoiceSetCode(state.choiceSetCode) : null,
    description: emptyToNull(state.description),
    category_id: categoryIdOrNull(state.categoryId),
    unit: number ? emptyToNull(state.unit) : null,
    min_value: number ? canonicalDecimalOrNull(state.minValue) : null,
    max_value: number ? canonicalDecimalOrNull(state.maxValue) : null,
    required: state.required,
    pattern: text ? emptyPatternToNull(state.pattern) : null,
    pattern_hint: text ? emptyToNull(state.patternHint) : null,
  }
}

export function toUpdatePayload(state: ParameterFormState): ParameterUpdate {
  const number = state.valueType === 'number'
  const text = state.valueType === 'text'
  return {
    display_name: state.displayName.trim(),
    description: emptyToNull(state.description),
    category_id: categoryIdOrNull(state.categoryId),
    unit: number ? emptyToNull(state.unit) : null,
    min_value: number ? canonicalDecimalOrNull(state.minValue) : null,
    max_value: number ? canonicalDecimalOrNull(state.maxValue) : null,
    required: state.required,
    pattern: text ? emptyPatternToNull(state.pattern) : null,
    pattern_hint: text ? emptyToNull(state.patternHint) : null,
  }
}

export function buildParameterCreatePlan(
  state: ParameterFormState,
  context: ParameterCreateValidationContext = {},
): ParameterCreatePlan {
  return {
    payload: toCreatePayload(state),
    fieldErrors: validateForm(state, {
      validateCode: true,
      validateChoiceSet: true,
      activeChoiceSetCodes: context.activeChoiceSetCodes ?? EMPTY_CODES,
      authorizedChoiceSetCode: context.authorizedChoiceSetCode ?? null,
    }),
    dirty: createFingerprint(state) !== createFingerprint(initialParameterFormState),
  }
}

export function buildParameterUpdatePlan(
  original: ParameterOut,
  state: ParameterFormState,
): ParameterUpdatePlan {
  const payload: ParameterUpdate = {}
  const effectiveState = { ...state, valueType: original.value_type }
  const fieldErrors = validateForm(effectiveState, {
    validateCode: false,
    validateChoiceSet: false,
    activeChoiceSetCodes: EMPTY_CODES,
    authorizedChoiceSetCode: null,
  })
  const displayName = state.displayName.trim()
  if (displayName !== '' && displayName !== original.display_name.trim()) {
    payload.display_name = displayName
  }

  addOptionalStringChange({
    payloadKey: 'description',
    original: normalizeOptionalString(original.description),
    current: normalizeOptionalString(state.description),
    payload,
  })
  addCategoryChange(original, state, payload)
  addOptionalStringChange({
    payloadKey: 'unit',
    original: normalizeOptionalString(original.unit),
    current: normalizeOptionalString(state.unit),
    payload,
  })
  addDecimalChange({
    payloadKey: 'min_value',
    original: original.min_value,
    current: parseOptionalDecimal(state.minValue),
    payload,
  })
  addDecimalChange({
    payloadKey: 'max_value',
    original: original.max_value,
    current: parseOptionalDecimal(state.maxValue),
    payload,
  })

  if (state.required !== original.required) payload.required = state.required
  if (original.value_type === 'text') {
    const pattern = emptyPatternToNull(state.pattern)
    const patternHint = normalizeOptionalString(state.patternHint)
    if (pattern !== original.pattern || patternHint !== original.pattern_hint) {
      payload.pattern = pattern
      payload.pattern_hint = patternHint
    }
  }

  return {
    payload,
    fieldErrors,
    dirty: updateFingerprint(state) !== originalFingerprint(original),
  }
}

interface OptionalStringChange {
  payloadKey: Extract<keyof ParameterUpdate, 'description' | 'unit'>
  original: string | null
  current: string | null
  payload: ParameterUpdate
}

function addOptionalStringChange(change: OptionalStringChange): void {
  if (change.current === change.original) return
  change.payload[change.payloadKey] = change.current
}

function addCategoryChange(
  original: ParameterOut,
  state: ParameterFormState,
  payload: ParameterUpdate,
): void {
  const current = parseOptionalCategoryId(state.categoryId)
  if (current.kind === 'invalid' || current.value === original.category_id) return
  payload.category_id = current.value
}

interface DecimalChange {
  payloadKey: Extract<keyof ParameterUpdate, 'min_value' | 'max_value'>
  original: string | null
  current: ParsedOptionalDecimal
  payload: ParameterUpdate
}

function addDecimalChange(change: DecimalChange): void {
  if (change.current.kind === 'invalid') return
  const original = canonicalDecimalOrNull(change.original ?? '')
  if (change.current.value === original) return
  change.payload[change.payloadKey] = change.current.value
}

interface ValidationSettings {
  validateCode: boolean
  validateChoiceSet: boolean
  activeChoiceSetCodes: ReadonlySet<string>
  authorizedChoiceSetCode: string | null
}

function validateForm(
  state: ParameterFormState,
  settings: ValidationSettings,
): ParameterFieldErrors {
  const errors: ParameterFieldErrors = {}

  if (settings.validateCode && state.code.trim() === '') errors.code = 'Code를 입력해 주세요.'
  if (state.displayName.trim() === '') errors.displayName = '표시명을 입력해 주세요.'

  const categoryId = parseOptionalCategoryId(state.categoryId)
  if (categoryId.kind === 'invalid') {
    errors.categoryId = '유효한 카테고리를 선택해 주세요.'
  }

  if (state.valueType === 'number') {
    const minValue = parseOptionalDecimal(state.minValue)
    const maxValue = parseOptionalDecimal(state.maxValue)
    if (minValue.kind === 'invalid') errors.minValue = '유효한 10진수를 입력해 주세요.'
    if (maxValue.kind === 'invalid') errors.maxValue = '유효한 10진수를 입력해 주세요.'
    if (
      minValue.kind === 'valid' &&
      maxValue.kind === 'valid' &&
      minValue.value !== null &&
      maxValue.value !== null &&
      compareCanonicalDecimals(minValue.value, maxValue.value) > 0
    ) {
      errors.maxValue = '최대값은 최소값보다 작을 수 없습니다.'
    }
  }

  if (state.valueType === 'text') {
    const pattern = emptyPatternToNull(state.pattern)
    const patternHint = normalizeOptionalString(state.patternHint)
    if (pattern !== null && patternHint === null) {
      errors.patternHint = '사용자에게 표시할 형식 안내를 입력해 주세요.'
    }
    if (pattern === null && patternHint !== null) {
      errors.pattern = '형식 안내와 함께 패턴을 입력해 주세요.'
    }
    if (state.pattern.length > 256) errors.pattern = '패턴은 256자 이하여야 합니다.'
    if (state.patternHint.trim().length > 256) {
      errors.patternHint = '형식 안내는 256자 이하여야 합니다.'
    }
  }

  if (settings.validateChoiceSet && state.valueType === 'choice') {
    const choiceSetCode = normalizeChoiceSetCode(state.choiceSetCode)
    if (choiceSetCode === null) {
      errors.choiceSetCode = 'Choice 타입에 사용할 선택지 집합을 선택해 주세요.'
    } else if (!settings.activeChoiceSetCodes.has(choiceSetCode)) {
      errors.choiceSetCode = '현재 활성 상태인 선택지 집합을 선택해 주세요.'
    } else if (settings.authorizedChoiceSetCode !== choiceSetCode) {
      errors.choiceSetCode = '최신 목록에서 선택지 집합을 다시 선택해 주세요.'
    }
  }

  return errors
}

type ParsedOptionalDecimal =
  | { kind: 'valid'; value: string | null }
  | { kind: 'invalid'; raw: string }

function parseOptionalDecimal(value: string): ParsedOptionalDecimal {
  const result = normalizeDecimalInput(value)
  return result.kind === 'invalid'
    ? { kind: 'invalid', raw: value.trim() }
    : { kind: 'valid', value: result.value }
}

type ParsedOptionalCategory =
  | { kind: 'valid'; value: number | null }
  | { kind: 'invalid'; raw: string }

function parseOptionalCategoryId(value: string): ParsedOptionalCategory {
  const trimmed = value.trim()
  if (trimmed === '') return { kind: 'valid', value: null }
  if (!/^\d+$/.test(trimmed)) return { kind: 'invalid', raw: trimmed }
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? { kind: 'valid', value: parsed }
    : { kind: 'invalid', raw: trimmed }
}

function normalizeOptionalString(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

function createFingerprint(state: ParameterFormState): string {
  return JSON.stringify({
    code: state.code.trim(),
    displayName: state.displayName.trim(),
    valueType: state.valueType,
    description: normalizeOptionalString(state.description),
    categoryId: comparableCategory(state.categoryId),
    unit: normalizeOptionalString(state.unit),
    minValue: comparableDecimal(state.minValue),
    maxValue: comparableDecimal(state.maxValue),
    required: state.required,
    pattern: state.valueType === 'text' ? emptyPatternToNull(state.pattern) : null,
    patternHint:
      state.valueType === 'text' ? normalizeOptionalString(state.patternHint) : null,
    choiceSetCode:
      state.valueType === 'choice' ? normalizeChoiceSetCode(state.choiceSetCode) : null,
  })
}

function updateFingerprint(state: ParameterFormState): string {
  return JSON.stringify({
    displayName: state.displayName.trim(),
    description: normalizeOptionalString(state.description),
    categoryId: comparableCategory(state.categoryId),
    unit: normalizeOptionalString(state.unit),
    minValue: comparableDecimal(state.minValue),
    maxValue: comparableDecimal(state.maxValue),
    required: state.required,
    pattern: state.valueType === 'text' ? emptyPatternToNull(state.pattern) : null,
    patternHint:
      state.valueType === 'text' ? normalizeOptionalString(state.patternHint) : null,
  })
}

function originalFingerprint(original: ParameterOut): string {
  return JSON.stringify({
    displayName: original.display_name.trim(),
    description: normalizeOptionalString(original.description),
    categoryId: original.category_id,
    unit: normalizeOptionalString(original.unit),
    minValue: original.min_value,
    maxValue: original.max_value,
    required: original.required,
    pattern: original.pattern,
    patternHint: original.pattern_hint,
  })
}

function comparableDecimal(value: string): string | null {
  const parsed = parseOptionalDecimal(value)
  return parsed.kind === 'valid' ? parsed.value : `invalid:${parsed.raw}`
}

function comparableCategory(value: string): number | string | null {
  const parsed = parseOptionalCategoryId(value)
  return parsed.kind === 'valid' ? parsed.value : `invalid:${parsed.raw}`
}

function canonicalDecimalOrNull(value: string): string | null {
  const result = normalizeDecimalInput(value)
  return result.kind === 'invalid' ? null : result.value
}

function normalizeChoiceSetCode(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function emptyToNull(value: string): string | null {
  return normalizeOptionalString(value)
}

function emptyPatternToNull(value: string): string | null {
  return value === '' ? null : value
}

function categoryIdOrNull(value: string): number | null {
  const result = parseOptionalCategoryId(value)
  return result.kind === 'valid' ? result.value : null
}

const EMPTY_CODES: ReadonlySet<string> = new Set()
