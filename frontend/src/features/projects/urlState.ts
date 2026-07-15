import { parsePositiveInt } from '@/shared/navigation/routeState'

export interface ProjectListRouteState {
  query: string
  status: 'all' | 'draft'
}

export interface ProjectCreateRouteState {
  step: 1 | 2 | 3
  processKey: string | null
  backboneId: number | null
}

export function parseProjectCreateSearch(params: URLSearchParams): ProjectCreateRouteState {
  const rawStep = params.get('step')
  const step = rawStep === '2' ? 2 : rawStep === '3' ? 3 : 1
  const processKey = params.get('process')

  return {
    step,
    processKey: processKey === null || processKey === '' ? null : processKey,
    backboneId: parsePositiveInt(params.get('backbone')),
  }
}

export function serializeProjectCreateSearch(state: ProjectCreateRouteState): URLSearchParams {
  const params = new URLSearchParams()

  params.set('step', String(state.step))
  if (state.processKey !== null && state.processKey !== '') {
    params.set('process', state.processKey)
  }
  if (state.backboneId !== null) params.set('backbone', String(state.backboneId))

  return params
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
