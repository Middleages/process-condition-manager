export type ChoiceActiveFilter = 'active' | 'inactive' | 'all'

export interface ChoiceSetSearchState {
  query: string
  active: ChoiceActiveFilter
}

const ACTIVE_FILTERS = new Set<ChoiceActiveFilter>(['active', 'inactive', 'all'])

export function parseChoiceSetListSearch(
  search: URLSearchParams,
): ChoiceSetSearchState {
  return parseSearch(search, 'active')
}

export function parseChoiceSetDetailSearch(
  search: URLSearchParams,
): ChoiceSetSearchState {
  return parseSearch(search, 'all')
}

export function serializeChoiceSetListSearch(
  state: ChoiceSetSearchState,
): URLSearchParams {
  return serializeSearch(state, 'active')
}

export function serializeChoiceSetDetailSearch(
  state: ChoiceSetSearchState,
): URLSearchParams {
  return serializeSearch(state, 'all')
}

function parseSearch(
  search: URLSearchParams,
  defaultActive: ChoiceActiveFilter,
): ChoiceSetSearchState {
  const rawActive = search.get('active') as ChoiceActiveFilter | null
  return {
    query: search.get('q')?.trim() ?? '',
    active:
      rawActive !== null && ACTIVE_FILTERS.has(rawActive)
        ? rawActive
        : defaultActive,
  }
}

function serializeSearch(
  state: ChoiceSetSearchState,
  defaultActive: ChoiceActiveFilter,
): URLSearchParams {
  const search = new URLSearchParams()
  const query = state.query.trim()
  if (query !== '') search.set('q', query)
  if (state.active !== defaultActive && ACTIVE_FILTERS.has(state.active)) {
    search.set('active', state.active)
  }
  return search
}
