import type { OptionIn, ParameterCreate, ParameterOut, ParameterUpdate, ValueType } from '@/api/types'

export interface ParameterFormState {
  code: string
  displayName: string
  valueType: ValueType
  description: string
  categoryId: string
  unit: string
  minValue: string
  maxValue: string
  optionsText: string
}

export type ClearLimitedField =
  | 'description'
  | 'categoryId'
  | 'unit'
  | 'minValue'
  | 'maxValue'

export type ParameterFieldErrors = Partial<Record<keyof ParameterFormState, string>>

export interface ParameterCreatePlan {
  payload: ParameterCreate
  fieldErrors: ParameterFieldErrors
  dirty: boolean
}

export interface ParameterUpdatePlan {
  payload: ParameterUpdate
  fieldErrors: ParameterFieldErrors
  unsupportedClears: ClearLimitedField[]
  options: OptionIn[]
  optionsDirty: boolean
  dirty: boolean
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
  optionsText: '',
}

export function stateFromParameter(parameter: ParameterOut): ParameterFormState {
  return {
    code: parameter.code,
    displayName: parameter.display_name,
    valueType: parameter.value_type,
    description: parameter.description ?? '',
    categoryId: parameter.category_id?.toString() ?? '',
    unit: parameter.unit ?? '',
    minValue: parameter.min_value?.toString() ?? '',
    maxValue: parameter.max_value?.toString() ?? '',
    optionsText: parameter.options.map((option) => option.value).join(', '),
  }
}

export function toCreatePayload(state: ParameterFormState): ParameterCreate {
  return {
    code: state.code.trim(),
    display_name: state.displayName.trim(),
    value_type: state.valueType,
    description: emptyToNull(state.description),
    category_id: idOrNull(state.categoryId),
    unit: emptyToNull(state.unit),
    min_value: numberOrNull(state.minValue),
    max_value: numberOrNull(state.maxValue),
    options: state.valueType === 'choice' ? parseOptions(state.optionsText) : [],
  }
}

export function toUpdatePayload(state: ParameterFormState): ParameterUpdate {
  return {
    display_name: state.displayName.trim(),
    description: emptyToNull(state.description),
    category_id: idOrNull(state.categoryId),
    unit: emptyToNull(state.unit),
    min_value: numberOrNull(state.minValue),
    max_value: numberOrNull(state.maxValue),
  }
}

export function parseOptions(optionsText: string): OptionIn[] {
  return optionsText
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) => ({ value, display_name: value, sort_order: index }))
}

export function buildParameterCreatePlan(state: ParameterFormState): ParameterCreatePlan {
  return {
    payload: toCreatePayload(state),
    fieldErrors: validateForm(state, state.valueType, true),
    dirty: createFingerprint(state) !== createFingerprint(initialParameterFormState),
  }
}

export function buildParameterUpdatePlan(
  original: ParameterOut,
  state: ParameterFormState,
): ParameterUpdatePlan {
  const payload: ParameterUpdate = {}
  const optionPlan = buildUpdateOptions(original, state.optionsText)
  const fieldErrors = validateForm(state, original.value_type, false, optionPlan.options)
  if (optionPlan.ambiguous) {
    fieldErrors.optionsText =
      '쉼표나 바깥 공백이 포함된 기존 선택지는 이 입력 방식에서 안전하게 변경할 수 없습니다.'
  }
  const unsupportedClears: ClearLimitedField[] = []

  const displayName = state.displayName.trim()
  if (displayName !== '' && displayName !== original.display_name.trim()) {
    payload.display_name = displayName
  }

  addOptionalStringChange({
    field: 'description',
    payloadKey: 'description',
    original: normalizeOptionalString(original.description),
    current: normalizeOptionalString(state.description),
    payload,
    fieldErrors,
    unsupportedClears,
  })
  addCategoryChange(original, state, payload, fieldErrors, unsupportedClears)
  addOptionalStringChange({
    field: 'unit',
    payloadKey: 'unit',
    original: normalizeOptionalString(original.unit),
    current: normalizeOptionalString(state.unit),
    payload,
    fieldErrors,
    unsupportedClears,
  })
  addNumberChange({
    field: 'minValue',
    payloadKey: 'min_value',
    original: original.min_value,
    current: parseOptionalNumber(state.minValue),
    payload,
    fieldErrors,
    unsupportedClears,
  })
  addNumberChange({
    field: 'maxValue',
    payloadKey: 'max_value',
    original: original.max_value,
    current: parseOptionalNumber(state.maxValue),
    payload,
    fieldErrors,
    unsupportedClears,
  })

  return {
    payload,
    fieldErrors,
    unsupportedClears,
    options: optionPlan.options,
    optionsDirty: optionPlan.dirty,
    dirty:
      optionPlan.dirty ||
      updateFingerprint(state, original.value_type, optionPlan.options) !==
        originalFingerprint(original),
  }
}

interface OptionalStringChange {
  field: Extract<ClearLimitedField, 'description' | 'unit'>
  payloadKey: Extract<keyof ParameterUpdate, 'description' | 'unit'>
  original: string | null
  current: string | null
  payload: ParameterUpdate
  fieldErrors: ParameterFieldErrors
  unsupportedClears: ClearLimitedField[]
}

function addOptionalStringChange(change: OptionalStringChange): void {
  if (change.current === change.original) return
  if (change.current === null && change.original !== null) {
    addUnsupportedClear(change.field, change.fieldErrors, change.unsupportedClears)
    return
  }
  if (change.current !== null) change.payload[change.payloadKey] = change.current
}

function addCategoryChange(
  original: ParameterOut,
  state: ParameterFormState,
  payload: ParameterUpdate,
  fieldErrors: ParameterFieldErrors,
  unsupportedClears: ClearLimitedField[],
): void {
  const current = parseOptionalCategoryId(state.categoryId)
  if (current.kind === 'invalid' || current.value === original.category_id) return
  if (current.value === null && original.category_id !== null) {
    addUnsupportedClear('categoryId', fieldErrors, unsupportedClears)
    return
  }
  if (current.value !== null) payload.category_id = current.value
}

interface NumberChange {
  field: Extract<ClearLimitedField, 'minValue' | 'maxValue'>
  payloadKey: Extract<keyof ParameterUpdate, 'min_value' | 'max_value'>
  original: number | null
  current: ParsedOptionalNumber
  payload: ParameterUpdate
  fieldErrors: ParameterFieldErrors
  unsupportedClears: ClearLimitedField[]
}

function addNumberChange(change: NumberChange): void {
  if (change.current.kind === 'invalid' || change.current.value === change.original) return
  if (change.current.value === null && change.original !== null) {
    addUnsupportedClear(change.field, change.fieldErrors, change.unsupportedClears)
    return
  }
  if (change.current.value !== null) change.payload[change.payloadKey] = change.current.value
}

function addUnsupportedClear(
  field: ClearLimitedField,
  fieldErrors: ParameterFieldErrors,
  unsupportedClears: ClearLimitedField[],
): void {
  unsupportedClears.push(field)
  fieldErrors[field] = '현재 API에서는 기존 값을 비울 수 없습니다.'
}

function validateForm(
  state: ParameterFormState,
  valueType: ValueType,
  validateCode: boolean,
  normalizedOptions = parseOptions(state.optionsText),
): ParameterFieldErrors {
  const errors: ParameterFieldErrors = {}

  if (validateCode && state.code.trim() === '') errors.code = 'Code를 입력해 주세요.'
  if (state.displayName.trim() === '') errors.displayName = '표시명을 입력해 주세요.'

  const categoryId = parseOptionalCategoryId(state.categoryId)
  if (categoryId.kind === 'invalid') {
    errors.categoryId = '유효한 카테고리를 선택해 주세요.'
  }

  const minValue = parseOptionalNumber(state.minValue)
  const maxValue = parseOptionalNumber(state.maxValue)
  if (minValue.kind === 'invalid') errors.minValue = '유효한 숫자를 입력해 주세요.'
  if (maxValue.kind === 'invalid') errors.maxValue = '유효한 숫자를 입력해 주세요.'
  if (
    minValue.kind === 'valid' &&
    maxValue.kind === 'valid' &&
    minValue.value !== null &&
    maxValue.value !== null &&
    minValue.value > maxValue.value
  ) {
    errors.maxValue = '최대값은 최소값보다 작을 수 없습니다.'
  }

  if (valueType === 'choice') {
    if (normalizedOptions.length === 0) {
      errors.optionsText = 'Choice 타입에는 선택지가 하나 이상 필요합니다.'
    } else if (
      new Set(normalizedOptions.map((option) => option.value)).size !== normalizedOptions.length
    ) {
      errors.optionsText = '선택지 값은 중복될 수 없습니다.'
    }
  }

  return errors
}

type ParsedOptionalNumber =
  | { kind: 'valid'; value: number | null }
  | { kind: 'invalid'; raw: string }

function parseOptionalNumber(value: string): ParsedOptionalNumber {
  const trimmed = value.trim()
  if (trimmed === '') return { kind: 'valid', value: null }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed)
    ? { kind: 'valid', value: parsed }
    : { kind: 'invalid', raw: trimmed }
}

type ParsedOptionalCategory =
  | { kind: 'valid'; value: number | null }
  | { kind: 'invalid'; raw: string }

function parseOptionalCategoryId(value: string): ParsedOptionalCategory {
  const trimmed = value.trim()
  if (trimmed === '') return { kind: 'valid', value: null }
  const parsed = Number(trimmed)
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
    minValue: comparableNumber(state.minValue),
    maxValue: comparableNumber(state.maxValue),
    options: state.valueType === 'choice' ? optionValues(parseOptions(state.optionsText)) : [],
  })
}

function updateFingerprint(
  state: ParameterFormState,
  valueType: ValueType,
  options: OptionIn[],
): string {
  return JSON.stringify({
    displayName: state.displayName.trim(),
    description: normalizeOptionalString(state.description),
    categoryId: comparableCategory(state.categoryId),
    unit: normalizeOptionalString(state.unit),
    minValue: comparableNumber(state.minValue),
    maxValue: comparableNumber(state.maxValue),
    options: valueType === 'choice' ? optionValues(options) : [],
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
    options:
      original.value_type === 'choice'
        ? original.options.map((option) => option.value)
        : [],
  })
}

function comparableNumber(value: string): number | string | null {
  const parsed = parseOptionalNumber(value)
  return parsed.kind === 'valid' ? parsed.value : `invalid:${parsed.raw}`
}

function comparableCategory(value: string): number | string | null {
  const parsed = parseOptionalCategoryId(value)
  return parsed.kind === 'valid' ? parsed.value : `invalid:${parsed.raw}`
}

function optionValues(options: OptionIn[]): string[] {
  return options.map((option) => option.value)
}

interface UpdateOptionsPlan {
  options: OptionIn[]
  dirty: boolean
  ambiguous: boolean
}

function buildUpdateOptions(original: ParameterOut, optionsText: string): UpdateOptionsPlan {
  if (original.value_type !== 'choice') {
    return { options: [], dirty: false, ambiguous: false }
  }

  const originalValues = original.options.map((option) => option.value)
  const sourceText = originalValues.join(', ')
  const originalDraft = original.options.map((option) => ({
    value: option.value,
    display_name: option.display_name,
    sort_order: option.sort_order,
  }))

  if (optionsText === sourceText) {
    return { options: originalDraft, dirty: false, ambiguous: false }
  }

  if (originalValues.some(isAmbiguousDelimitedValue)) {
    return { options: originalDraft, dirty: true, ambiguous: true }
  }

  const parsed = parseOptions(optionsText)
  const parsedValues = optionValues(parsed)
  if (arraysEqual(parsedValues, originalValues)) {
    return { options: originalDraft, dirty: false, ambiguous: false }
  }

  const originalByValue = new Map(
    original.options.map((option) => [option.value, option] as const),
  )
  const merged = parsed.map((option, index) => {
    const retained = originalByValue.get(option.value)
    return {
      value: option.value,
      display_name: retained?.display_name ?? option.value,
      sort_order: index,
    }
  })

  return { options: merged, dirty: true, ambiguous: false }
}

function isAmbiguousDelimitedValue(value: string): boolean {
  return value.includes(',') || value.trim() !== value
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  return Number(trimmed)
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function idOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  return Number(trimmed)
}
