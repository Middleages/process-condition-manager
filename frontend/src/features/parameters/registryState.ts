import type {
  CategoryOut,
  ChoiceSetSummaryOut,
  ParameterOut,
  ValueType,
} from '@/api/types'
import type { SearchableChoiceItem } from '@/shared/components/SearchableChoice'

export type ActiveFilter = 'active' | 'all' | 'inactive'

export type EditTarget =
  | { kind: 'closed' }
  | { kind: 'new' }
  | { kind: 'existing'; id: number }
  | { kind: 'invalid'; raw: string }

export interface ParameterRegistryState {
  query: string
  category: string | null
  type: ValueType | null
  active: ActiveFilter
  edit: EditTarget
}

const valueTypes: ReadonlySet<string> = new Set(['text', 'number', 'choice'])

export function parseParameterRegistrySearch(
  params: URLSearchParams,
): ParameterRegistryState {
  const category = params.get('category')

  return {
    query: params.get('query') ?? '',
    category: category === null || category === '' ? null : category,
    type: parseValueType(params.get('type')),
    active: parseActiveFilter(params.get('active')),
    edit: parseEditTarget(params.get('edit')),
  }
}

export function serializeParameterRegistrySearch(
  state: ParameterRegistryState,
): URLSearchParams {
  const params = new URLSearchParams()

  if (state.query !== '') params.set('query', state.query)
  if (state.category !== null && state.category !== '') {
    params.set('category', state.category)
  }
  if (state.type !== null) params.set('type', state.type)
  if (state.active !== 'active') params.set('active', state.active)

  if (state.edit.kind === 'new') params.set('edit', 'new')
  if (state.edit.kind === 'existing') params.set('edit', String(state.edit.id))
  if (state.edit.kind === 'invalid') params.set('edit', state.edit.raw)

  return params
}

export function canonicalizeParameterRegistryState(
  state: ParameterRegistryState,
  validCategoryCodes: ReadonlySet<string>,
): ParameterRegistryState {
  if (state.category === null || validCategoryCodes.has(state.category)) return state

  return { ...state, category: null }
}

export function shouldIncludeInactive(active: ActiveFilter): boolean {
  return active !== 'active'
}

export function filterParameterRegistry(
  parameters: readonly ParameterOut[],
  categories: readonly CategoryOut[],
  state: ParameterRegistryState,
): ParameterOut[] {
  const categoriesById = new Map(categories.map((category) => [category.id, category]))
  const query = state.query.trim().toLowerCase()

  return parameters.filter((parameter) => {
    const category =
      parameter.category_id === null ? undefined : categoriesById.get(parameter.category_id)

    if (state.active === 'active' && !parameter.is_active) return false
    if (state.active === 'inactive' && parameter.is_active) return false
    if (state.type !== null && parameter.value_type !== state.type) return false
    if (state.category !== null && category?.code !== state.category) return false
    if (query === '') return true

    return [
      parameter.code,
      parameter.display_name,
      category?.code,
      category?.display_name,
      parameter.unit,
      parameter.description,
      parameter.choice_set?.code,
      parameter.choice_set?.display_name,
    ].some((value) => value?.toLowerCase().includes(query) === true)
  })
}

export type ParameterChoiceSetListStatus = 'loading' | 'error' | 'success'

export interface ParameterChoiceSetPickerInput {
  rawCode: string
  authorizedCode: string | null
  sets: readonly ChoiceSetSummaryOut[]
  status: ParameterChoiceSetListStatus
  refreshing: boolean
}

export interface ParameterChoiceSetPickerState {
  rawCode: string
  options: SearchableChoiceItem[]
  activeCodes: ReadonlySet<string>
  selectedActive: boolean
  resourceReady: boolean
  selectionReady: boolean
  empty: boolean
}

export function deriveParameterChoiceSetPickerState({
  rawCode,
  authorizedCode,
  sets,
  status,
  refreshing,
}: ParameterChoiceSetPickerInput): ParameterChoiceSetPickerState {
  const activeSets = sets.filter((set) => set.is_active)
  const activeCodes = new Set(activeSets.map((set) => set.code))
  const normalizedRawCode = rawCode.trim()
  const selectedActive = normalizedRawCode !== '' && activeCodes.has(normalizedRawCode)
  const resourceReady = status === 'success' && !refreshing

  return {
    rawCode,
    options: activeSets.map((set) => ({
      code: set.code,
      label: set.display_name,
      is_active: set.is_active,
    })),
    activeCodes,
    selectedActive,
    resourceReady,
    selectionReady:
      resourceReady &&
      selectedActive &&
      authorizedCode === normalizedRawCode,
    empty: status === 'success' && !refreshing && activeSets.length === 0,
  }
}

export function authorizeParameterChoiceSet(code: string): string | null {
  const normalized = code.trim()
  return normalized === '' ? null : normalized
}

/**
 * A successful fresh list can revoke a prior selection, but can never re-authorize it. That
 * directionality keeps a deactivated draft visible while requiring a deliberate new selection
 * if the set later becomes active again.
 */
export function reconcileParameterChoiceSetAuthorization(
  authorizedCode: string | null,
  rawCode: string,
  freshSets: readonly ChoiceSetSummaryOut[],
): string | null {
  const normalizedRawCode = rawCode.trim()
  if (authorizedCode === null || authorizedCode !== normalizedRawCode) return null
  return freshSets.some((set) => set.is_active && set.code === authorizedCode)
    ? authorizedCode
    : null
}

function parseValueType(raw: string | null): ValueType | null {
  return raw !== null && valueTypes.has(raw) ? (raw as ValueType) : null
}

function parseActiveFilter(raw: string | null): ActiveFilter {
  return raw === 'all' || raw === 'inactive' ? raw : 'active'
}

function parseEditTarget(raw: string | null): EditTarget {
  if (raw === null || raw === '') return { kind: 'closed' }
  if (raw === 'new') return { kind: 'new' }
  if (/^\d+$/.test(raw)) {
    const id = Number(raw)
    if (Number.isSafeInteger(id) && id > 0) return { kind: 'existing', id }
  }

  return { kind: 'invalid', raw }
}
