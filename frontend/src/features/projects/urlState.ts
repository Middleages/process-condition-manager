import { parsePositiveInt } from '@/shared/navigation/routeState'

export type ProjectListStatus = 'all' | 'draft' | 'review' | 'approved' | 'rejected'

export interface ProjectListRouteState {
  query: string
  status: ProjectListStatus
  deviceTypeCode: string | null
  projectCategoryCode: string | null
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
    status: parseProjectListStatus(params.get('status')),
    deviceTypeCode: normalizedChoiceFilter(params.get('device_type')),
    projectCategoryCode: normalizedChoiceFilter(params.get('project_category')),
  }
}

export function serializeProjectListSearch(state: ProjectListRouteState): URLSearchParams {
  const params = new URLSearchParams()

  if (state.query !== '') params.set('query', state.query)
  if (state.status !== 'all') params.set('status', state.status)
  if (state.deviceTypeCode !== null && state.deviceTypeCode !== '') {
    params.set('device_type', state.deviceTypeCode)
  }
  if (state.projectCategoryCode !== null && state.projectCategoryCode !== '') {
    params.set('project_category', state.projectCategoryCode)
  }

  return params
}

export function toProjectListHref(state: ProjectListRouteState): string {
  const search = serializeProjectListSearch(state).toString()
  return search === '' ? '/projects' : `/projects?${search}`
}

function normalizedChoiceFilter(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function parseProjectListStatus(value: string | null): ProjectListStatus {
  if (value === 'draft' || value === 'review' || value === 'approved' || value === 'rejected') {
    return value
  }
  return 'all'
}
