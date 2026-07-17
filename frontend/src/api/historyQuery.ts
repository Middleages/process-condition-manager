export type HistoryOrigin = 'manual' | 'paste' | 'backbone' | 'system'

export type HistoryEventType =
  | 'project_create'
  | 'project_profile_update'
  | 'backbone_copy'
  | 'backbone_layer_replace'
  | 'cell_update'
  | 'condition_add'
  | 'condition_remove'
  | 'por_change'

export interface HistoryTimelineFilterInput {
  createdFrom?: string | null
  createdTo?: string | null
  layerKey?: string | null
  eventTypes?: readonly string[]
  actor?: string | null
  origin?: HistoryOrigin | null
  sourceProjectId?: number | null
}

export interface HistoryTimelineFilters {
  createdFrom: string | null
  createdTo: string | null
  layerKey: string | null
  eventTypes: readonly HistoryEventType[]
  actor: string | null
  origin: HistoryOrigin | null
  sourceProjectId: number | null
}

export interface HistoryTimelineQueryOptions {
  cursor?: string | null
  limit?: number
}

export interface HistoryDetailQueryOptions {
  cursor?: string | null
  limit?: number
}

export interface HistoryCellHistoryQueryOptions {
  cursor?: string | null
  limit?: number
}

const DEFAULT_TIMELINE_LIMIT = 50
const DEFAULT_DETAIL_LIMIT = 100
const DEFAULT_CELL_HISTORY_LIMIT = 50

const HISTORY_ORIGINS: readonly HistoryOrigin[] = ['manual', 'paste', 'backbone', 'system']
const HISTORY_EVENT_TYPES: readonly HistoryEventType[] = [
  'project_create',
  'project_profile_update',
  'backbone_copy',
  'backbone_layer_replace',
  'cell_update',
  'condition_add',
  'condition_remove',
  'por_change',
]

export function createHistoryTimelineFilters(
  overrides: HistoryTimelineFilterInput = {},
): HistoryTimelineFilters {
  return normalizeHistoryTimelineFilters({
    createdFrom: null,
    createdTo: null,
    layerKey: null,
    eventTypes: [],
    actor: null,
    origin: null,
    sourceProjectId: null,
    ...overrides,
  })
}

export function normalizeHistoryTimelineFilters(
  filters: HistoryTimelineFilterInput,
): HistoryTimelineFilters {
  return {
    createdFrom: normalizeOptionalText(filters.createdFrom ?? null),
    createdTo: normalizeOptionalText(filters.createdTo ?? null),
    layerKey: normalizeOptionalText(filters.layerKey ?? null),
    eventTypes: normalizeUniqueSortedEventTypes(filters.eventTypes ?? []),
    actor: normalizeOptionalText(filters.actor ?? null),
    origin: normalizeHistoryOrigin(filters.origin ?? null),
    sourceProjectId: normalizePositiveInteger(filters.sourceProjectId ?? null),
  }
}

export function historyTimelineQueryKey(
  projectId: number,
  filters: HistoryTimelineFilterInput,
): readonly unknown[] {
  return ['history', projectId, 'timeline', normalizeHistoryTimelineFilters(filters)]
}

export function historyDetailQueryKey(
  projectId: number,
  scope: string,
  batchId: string,
): readonly unknown[] {
  return ['history', projectId, 'detail', normalizeOpaqueToken(scope), normalizePathToken(batchId)]
}

export function historyCellHistoryQueryKey(
  projectId: number,
  conditionId: number,
  parameterCode: string,
): readonly unknown[] {
  return ['history', projectId, 'cell-history', conditionId, normalizePathToken(parameterCode)]
}

export function buildHistoryTimelineQueryString(
  filters: HistoryTimelineFilterInput,
  options: HistoryTimelineQueryOptions = {},
): string {
  const query = new URLSearchParams()
  const normalized = normalizeHistoryTimelineFilters(filters)
  appendOptionalText(query, 'created_from', normalized.createdFrom)
  appendOptionalText(query, 'created_to', normalized.createdTo)
  appendOptionalText(query, 'layer_key', normalized.layerKey)
  normalized.eventTypes.forEach((eventType) => {
    query.append('event_type', eventType)
  })
  appendOptionalText(query, 'actor', normalized.actor)
  appendOptionalText(query, 'origin', normalized.origin)
  appendOptionalNumber(query, 'source_project_id', normalized.sourceProjectId)
  appendOptionalText(query, 'cursor', normalizeOptionalText(options.cursor ?? null))
  query.set('limit', String(options.limit ?? DEFAULT_TIMELINE_LIMIT))
  return query.toString()
}

export function buildHistoryDetailQueryString(
  scope: string,
  options: HistoryDetailQueryOptions = {},
): string {
  const query = new URLSearchParams()
  appendOptionalText(query, 'scope', normalizeOpaqueToken(scope))
  appendOptionalText(query, 'cursor', normalizeOptionalText(options.cursor ?? null))
  query.set('limit', String(options.limit ?? DEFAULT_DETAIL_LIMIT))
  return query.toString()
}

export function buildHistoryCellHistoryQueryString(
  conditionId: number,
  parameterCode: string,
  options: HistoryCellHistoryQueryOptions = {},
): string {
  const query = new URLSearchParams()
  query.set('condition_id', String(conditionId))
  query.set('parameter_code', normalizePathToken(parameterCode))
  appendOptionalText(query, 'cursor', normalizeOptionalText(options.cursor ?? null))
  query.set('limit', String(options.limit ?? DEFAULT_CELL_HISTORY_LIMIT))
  return query.toString()
}

export function normalizeOpaqueToken(value: string): string {
  const normalized = normalizeRequiredText(value, 'scope')
  if (normalized.length > 4096) {
    throw new TypeError('History scope token is too long')
  }
  return normalized
}

export function normalizePathToken(value: string): string {
  return normalizeRequiredText(value, 'path token')
}

function normalizeOptionalText(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized === '') {
    throw new TypeError(`${label} must be non-empty`)
  }
  return normalized
}

function normalizeUniqueSortedEventTypes(
  values: readonly string[],
): readonly HistoryEventType[] {
  const seen = new Set<HistoryEventType>()
  const normalized: HistoryEventType[] = []
  for (const value of values) {
    const item = value.trim()
    if (!isHistoryEventType(item) || seen.has(item)) continue
    seen.add(item)
    normalized.push(item)
  }
  normalized.sort()
  return normalized
}

function isHistoryEventType(value: string): value is HistoryEventType {
  return (HISTORY_EVENT_TYPES as readonly string[]).includes(value)
}

function normalizeHistoryOrigin(origin: HistoryOrigin | null): HistoryOrigin | null {
  if (origin === null) return null
  const normalized = origin.trim() as HistoryOrigin
  return HISTORY_ORIGINS.includes(normalized) ? normalized : null
}

function normalizePositiveInteger(value: number | null): number | null {
  if (value === null) return null
  return Number.isInteger(value) && value > 0 ? value : null
}

function appendOptionalText(
  query: URLSearchParams,
  key: string,
  value: string | null,
): void {
  if (value !== null) query.set(key, value)
}

function appendOptionalNumber(
  query: URLSearchParams,
  key: string,
  value: number | null,
): void {
  if (value !== null) query.set(key, String(value))
}
