import { parsePositiveInt } from '@/shared/navigation/routeState'

export type ProjectListStatus = 'all' | 'draft' | 'review' | 'approved' | 'rejected'

export interface ProjectListRouteState {
  // Optional for legacy links that enter the list without a selected LINE.
  lineId?: string | null
  cursor?: number | null
  cursorTrail?: (number | null)[]
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
  const lineId = normalizedChoiceFilter(params.get('line'))
  const cursor = lineId ? parseCursor(params.get('cursor')) : null
  return {
    lineId,
    cursor,
    cursorTrail: parseCursorTrail(params.get('trail'), cursor),
    query: params.get('query') ?? '',
    status: parseProjectListStatus(params.get('status')),
    deviceTypeCode: normalizedChoiceFilter(params.get('device_type')),
    projectCategoryCode: normalizedChoiceFilter(params.get('project_category')),
  }
}

export function serializeProjectListSearch(state: ProjectListRouteState): URLSearchParams {
  const params = new URLSearchParams()

  if (state.lineId) params.set('line', state.lineId)
  if (state.lineId && state.cursor) {
    params.set('cursor', String(state.cursor))
    if (state.cursorTrail?.length) {
      params.set('trail', state.cursorTrail.map(cursor => cursor ?? 0).join(','))
    }
  }
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

function parseCursor(raw: string | null): number | null {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

function parseCursorTrail(raw: string | null, cursor: number | null): (number | null)[] {
  if (!raw || cursor === null) return []
  const entries = raw.split(',')
  if (entries[0] !== '0') return []
  const trail: (number | null)[] = [null]
  let previous = Infinity
  for (const entry of entries.slice(1)) {
    const value = parseCursor(entry)
    if (value === null || value >= previous || value <= cursor) return []
    trail.push(value)
    previous = value
  }
  return trail
}
