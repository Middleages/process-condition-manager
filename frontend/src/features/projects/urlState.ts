export interface ProjectListRouteState {
  query: string
  status: 'all' | 'draft'
}

export function parseProjectListSearch(params: URLSearchParams): ProjectListRouteState {
  return {
    query: params.get('query') ?? '',
    status: params.get('status') === 'draft' ? 'draft' : 'all',
  }
}

export function serializeProjectListSearch(state: ProjectListRouteState): URLSearchParams {
  const params = new URLSearchParams()

  if (state.query !== '') params.set('query', state.query)
  if (state.status !== 'all') params.set('status', state.status)

  return params
}

export function toProjectListHref(state: ProjectListRouteState): string {
  const search = serializeProjectListSearch(state).toString()
  return search === '' ? '/projects' : `/projects?${search}`
}
