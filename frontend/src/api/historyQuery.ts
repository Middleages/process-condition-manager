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
  eventTypes?: readonly HistoryEventType[]
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
const MAX_OPAQUE_TOKEN_LENGTH = 4096
const MAX_LAYER_KEY_LENGTH = 256
const MAX_ACTOR_LENGTH = 128
const MAX_PARAMETER_CODE_LENGTH = 64

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
  const createdFrom = normalizeIsoDatetimeText(filters.createdFrom ?? null, 'createdFrom')
  const createdTo = normalizeIsoDatetimeText(filters.createdTo ?? null, 'createdTo')
  if (
    createdFrom !== null &&
    createdTo !== null &&
    compareIsoDatetimes(createdFrom, createdTo) >= 0
  ) {
    throw new TypeError('createdFrom must be earlier than createdTo')
  }
  return {
    createdFrom,
    createdTo,
    layerKey: normalizeOptionalText(filters.layerKey ?? null, 'layerKey', MAX_LAYER_KEY_LENGTH),
    eventTypes: normalizeUniqueSortedEventTypes(filters.eventTypes ?? []),
    actor: normalizeOptionalText(filters.actor ?? null, 'actor', MAX_ACTOR_LENGTH),
    origin: normalizeHistoryOrigin(filters.origin ?? null),
    sourceProjectId: normalizePositiveInteger(filters.sourceProjectId ?? null),
  }
}

/** Prefix shared by every history view owned by one project. */
export function historyProjectQueryKey(projectId: number): readonly ['history', number] {
  return ['history', projectId]
}

/** Prefix shared by root and paginated batch-detail queries for one project. */
export function historyProjectDetailQueryKey(
  projectId: number,
): readonly ['history', number, 'detail'] {
  return [...historyProjectQueryKey(projectId), 'detail']
}

export function historyTimelineQueryKey(
  projectId: number,
  filters: HistoryTimelineFilterInput,
): readonly unknown[] {
  return [
    ...historyProjectQueryKey(projectId),
    'timeline',
    normalizeHistoryTimelineFilters(filters),
  ]
}

export function historyDetailQueryKey(
  projectId: number,
  scope: string,
  batchId: string,
): readonly unknown[] {
  return [
    ...historyProjectDetailQueryKey(projectId),
    normalizeOpaqueToken(scope),
    normalizePathToken(batchId),
  ]
}

export function historyCellHistoryQueryKey(
  projectId: number,
  conditionId: number,
  parameterCode: string,
): readonly unknown[] {
  return [
    ...historyProjectQueryKey(projectId),
    'cell-history',
    conditionId,
    normalizePathToken(parameterCode),
  ]
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
  appendOptionalText(query, 'cursor', normalizeOptionalText(options.cursor ?? null, 'cursor', MAX_OPAQUE_TOKEN_LENGTH))
  query.set('limit', String(normalizeLimit(options.limit ?? DEFAULT_TIMELINE_LIMIT, 1, 100, 'timeline limit')))
  return query.toString()
}

export function buildHistoryDetailQueryString(
  scope: string,
  options: HistoryDetailQueryOptions = {},
): string {
  const query = new URLSearchParams()
  appendOptionalText(query, 'scope', normalizeOpaqueToken(scope))
  appendOptionalText(query, 'cursor', normalizeOptionalText(options.cursor ?? null, 'cursor', MAX_OPAQUE_TOKEN_LENGTH))
  query.set('limit', String(normalizeLimit(options.limit ?? DEFAULT_DETAIL_LIMIT, 1, 200, 'detail limit')))
  return query.toString()
}

export function buildHistoryCellHistoryQueryString(
  conditionId: number,
  parameterCode: string,
  options: HistoryCellHistoryQueryOptions = {},
): string {
  const query = new URLSearchParams()
  query.set('condition_id', String(normalizeConditionId(conditionId)))
  query.set('parameter_code', normalizePathToken(parameterCode))
  appendOptionalText(query, 'cursor', normalizeOptionalText(options.cursor ?? null, 'cursor', MAX_OPAQUE_TOKEN_LENGTH))
  query.set('limit', String(normalizeLimit(options.limit ?? DEFAULT_CELL_HISTORY_LIMIT, 1, 100, 'cell history limit')))
  return query.toString()
}

export function normalizeOpaqueToken(value: string): string {
  const normalized = normalizeRequiredText(value, 'scope', MAX_OPAQUE_TOKEN_LENGTH)
  return normalized
}

export function normalizePathToken(value: string): string {
  return normalizeRequiredText(value, 'path token', MAX_PARAMETER_CODE_LENGTH)
}

function normalizeIsoDatetimeText(value: string | null, label: string): string | null {
  if (value === null) return null
  const normalized = value.trim()
  if (normalized === '') return null
  parseStrictIsoDatetime(normalized, label)
  return normalized
}

function normalizeOptionalText(value: string | null, label: string, maxLength: number): string | null {
  if (value === null) return null
  const normalized = value.trim()
  if (normalized === '') return null
  if (normalized.length > maxLength) {
    throw new TypeError(`${label} is too long`)
  }
  return normalized
}

function normalizeRequiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized === '') {
    throw new TypeError(`${label} must be non-empty`)
  }
  if (normalized.length > maxLength) {
    throw new TypeError(`${label} is too long`)
  }
  return normalized
}

function normalizeUniqueSortedEventTypes(
  values: readonly HistoryEventType[],
): readonly HistoryEventType[] {
  const seen = new Set<HistoryEventType>()
  const normalized: HistoryEventType[] = []
  for (const value of values) {
    const item = validateHistoryEventType(value)
    if (seen.has(item)) continue
    seen.add(item)
    normalized.push(item)
  }
  normalized.sort()
  return normalized
}

function isHistoryEventType(value: string): value is HistoryEventType {
  return (HISTORY_EVENT_TYPES as readonly string[]).includes(value)
}

function validateHistoryEventType(value: HistoryEventType): HistoryEventType {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!isHistoryEventType(normalized)) {
    throw new TypeError('History event type must be one of the exact backend values')
  }
  return normalized
}

function normalizeHistoryOrigin(origin: HistoryOrigin | null): HistoryOrigin | null {
  if (origin === null) return null
  if (typeof origin !== 'string') {
    throw new TypeError('History origin must be one of the exact backend values')
  }
  const normalized = origin.trim()
  if (!HISTORY_ORIGINS.includes(normalized as HistoryOrigin)) {
    throw new TypeError('History origin must be one of the exact backend values')
  }
  return normalized as HistoryOrigin
}

function normalizePositiveInteger(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError('sourceProjectId must be a positive integer')
  }
  return value
}

function compareIsoDatetimes(left: string, right: string): number {
  return strictIsoDatetimeToEpochMillis(parseStrictIsoDatetime(left, 'createdFrom')) -
    strictIsoDatetimeToEpochMillis(parseStrictIsoDatetime(right, 'createdTo'))
}

interface StrictIsoDatetimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millisecond: number
  offsetMinutes: number
}

function parseStrictIsoDatetime(value: string, label: string): StrictIsoDatetimeParts {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/,
  )
  if (match === null) {
    throw new TypeError(`${label} must be a valid ISO datetime`)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = match[6] === undefined ? 0 : Number(match[6])
  const millisecond = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0'))
  const timezone = match[8] ?? null

  if (year < 1) {
    throw new TypeError(`${label} must be a valid ISO datetime`)
  }
  if (month < 1 || month > 12) {
    throw new TypeError(`${label} must be a valid ISO datetime`)
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new TypeError(`${label} must be a valid ISO datetime`)
  }
  if (hour > 23 || minute > 59 || second > 59 || millisecond > 999) {
    throw new TypeError(`${label} must be a valid ISO datetime`)
  }

  const offsetMinutes = parseTimezoneOffsetMinutes(timezone, label)
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond,
    offsetMinutes,
  }
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31
    case 4:
    case 6:
    case 9:
    case 11:
      return 30
    case 2:
      return isLeapYear(year) ? 29 : 28
    default:
      return 0
  }
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function parseTimezoneOffsetMinutes(timezone: string | null, label: string): number {
  if (timezone === null || timezone === 'Z') {
    return 0
  }

  const sign = timezone.startsWith('-') ? -1 : 1
  const offsetHours = Number(timezone.slice(1, 3))
  const offsetMinutes = Number(timezone.slice(4, 6))
  if (!Number.isInteger(offsetHours) || !Number.isInteger(offsetMinutes)) {
    throw new TypeError(`${label} must be a valid ISO datetime`)
  }
  if (offsetHours > 23 || offsetMinutes > 59) {
    throw new TypeError(`${label} must be a valid ISO datetime`)
  }
  return sign * (offsetHours * 60 + offsetMinutes)
}

function strictIsoDatetimeToEpochMillis(value: StrictIsoDatetimeParts): number {
  const daysSinceEpoch =
    civilDateToDaysSinceEpoch(value.year, value.month, value.day)
  return (
    (((daysSinceEpoch * 24 + value.hour) * 60 + value.minute - value.offsetMinutes) * 60 +
      value.second) *
      1000 +
    value.millisecond
  )
}

function civilDateToDaysSinceEpoch(year: number, month: number, day: number): number {
  const adjustedYear = month <= 2 ? year - 1 : year
  const era = Math.floor(adjustedYear / 400)
  const yearOfEra = adjustedYear - era * 400
  const adjustedMonth = month + (month > 2 ? -3 : 9)
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    Math.floor(yearOfEra / 400) +
    dayOfYear
  return era * 146097 + dayOfEra - 719468
}

function normalizeConditionId(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError('condition_id must be a positive integer')
  }
  return value
}

function normalizeLimit(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be between ${minimum} and ${maximum}`)
  }
  return value
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
