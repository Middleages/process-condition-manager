import type { CategoryOut, ImportResultOut, OptionIn, ParameterOut } from '@/api/types'

import {
  initialParameterFormState,
  stateFromParameter,
  type ParameterFormState,
} from './form'
import {
  canonicalizeParameterRegistryState,
  parseParameterRegistrySearch,
  serializeParameterRegistrySearch,
  type EditTarget,
  type ParameterRegistryState,
} from './registryState'

export interface DerivedParameterRegistryRoute {
  state: ParameterRegistryState
  repair: URLSearchParams | null
}

export function deriveParameterRegistryRoute(
  current: URLSearchParams,
  categories: readonly CategoryOut[] | null,
): DerivedParameterRegistryRoute {
  const parsed = parseParameterRegistrySearch(current)
  if (categories === null) return { state: parsed, repair: null }

  const state = canonicalizeParameterRegistryState(
    parsed,
    new Set(categories.map((category) => category.code)),
  )
  const serialized = serializeParameterRegistrySearch(state)

  return {
    state,
    repair: serialized.toString() === current.toString() ? null : serialized,
  }
}

export interface ParameterOptionsRetryState {
  draft: OptionIn[]
  error: unknown
}

export interface ParameterEditorSession {
  target: EditTarget
  original: ParameterOut | null
  form: ParameterFormState
  hydrated: boolean
  optionsRetry: ParameterOptionsRetryState | null
}

export interface ParameterDetailHydrationSnapshot {
  data: ParameterOut | undefined
  isFetchedAfterMount: boolean
  isSuccess: boolean
}

export type ExistingParameterDetailPresentation =
  | { kind: 'loading' }
  | { kind: 'fatal-error' }
  | { kind: 'editor'; refetchError: boolean }

export type ParameterEditorSessionAction =
  | { type: 'hydrate'; parameter: ParameterOut }
  | {
      type: 'change-field'
      field: keyof ParameterFormState
      value: ParameterFormState[keyof ParameterFormState]
    }
  | {
      type: 'options-partial-failure'
      baseParameter: ParameterOut
      optionsDraft: OptionIn[]
      error: unknown
    }
  | { type: 'options-retry-failed'; error: unknown }

export function startParameterEditorSession(target: EditTarget): ParameterEditorSession {
  return {
    target,
    original: null,
    form: initialParameterFormState,
    hydrated: target.kind !== 'existing',
    optionsRetry: null,
  }
}

export function selectFreshParameterForHydration(
  target: EditTarget,
  snapshot: ParameterDetailHydrationSnapshot,
): ParameterOut | null {
  if (
    target.kind !== 'existing' ||
    !snapshot.isFetchedAfterMount ||
    !snapshot.isSuccess ||
    snapshot.data?.id !== target.id
  ) {
    return null
  }

  return snapshot.data
}

export function getExistingParameterDetailPresentation(
  session: Pick<ParameterEditorSession, 'hydrated'>,
  isError: boolean,
): ExistingParameterDetailPresentation {
  if (session.hydrated) return { kind: 'editor', refetchError: isError }
  return isError ? { kind: 'fatal-error' } : { kind: 'loading' }
}

export function parameterEditorSessionReducer(
  state: ParameterEditorSession,
  action: ParameterEditorSessionAction,
): ParameterEditorSession {
  if (action.type === 'hydrate') {
    if (state.hydrated || state.target.kind !== 'existing') return state
    if (state.target.id !== action.parameter.id) return state

    return {
      ...state,
      original: action.parameter,
      form: stateFromParameter(action.parameter),
      hydrated: true,
    }
  }

  if (action.type === 'change-field') {
    return {
      ...state,
      form: { ...state.form, [action.field]: action.value } as ParameterFormState,
    }
  }

  if (action.type === 'options-partial-failure') {
    return {
      ...state,
      original: action.baseParameter,
      optionsRetry: {
        draft: action.optionsDraft.map((option) => ({ ...option })),
        error: action.error,
      },
    }
  }

  if (state.optionsRetry === null) return state
  return {
    ...state,
    optionsRetry: { ...state.optionsRetry, error: action.error },
  }
}

export interface CsvImportState {
  csvText: string
  preview: ImportResultOut | null
  previewCsvText: string | null
  applied: boolean
}

export const initialCsvImportState: CsvImportState = {
  csvText: '',
  preview: null,
  previewCsvText: null,
  applied: false,
}

export type CsvImportAction =
  | { type: 'edit'; csvText: string }
  | { type: 'preview-succeeded'; submittedCsvText: string; result: ImportResultOut }
  | { type: 'apply-succeeded'; submittedCsvText: string; result: ImportResultOut }
  | { type: 'reset' }

export function csvImportReducer(
  state: CsvImportState,
  action: CsvImportAction,
): CsvImportState {
  if (action.type === 'edit') {
    return {
      csvText: action.csvText,
      preview: null,
      previewCsvText: null,
      applied: false,
    }
  }
  if (action.type === 'preview-succeeded') {
    if (action.submittedCsvText !== state.csvText) return state
    return {
      ...state,
      preview: action.result,
      previewCsvText: action.submittedCsvText,
      applied: false,
    }
  }
  if (action.type === 'apply-succeeded') {
    if (
      action.submittedCsvText !== state.csvText ||
      action.submittedCsvText !== state.previewCsvText
    ) {
      return state
    }
    return { ...state, preview: action.result, applied: true }
  }
  return initialCsvImportState
}

export function canApplyCsvImport(state: CsvImportState): boolean {
  return (
    state.preview !== null &&
    state.previewCsvText === state.csvText &&
    state.preview.created_count + state.preview.updated_count > 0
  )
}
