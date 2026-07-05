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
