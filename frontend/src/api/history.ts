import { apiClient } from './client'
import {
  buildHistoryCellHistoryQueryString,
  buildHistoryDetailQueryString,
  buildHistoryTimelineQueryString,
  historyCellHistoryQueryKey,
  historyDetailQueryKey,
  historyTimelineQueryKey,
  type HistoryCellHistoryQueryOptions,
  type HistoryDetailQueryOptions,
  type HistoryOrigin,
  type HistoryTimelineFilters,
  type HistoryTimelineQueryOptions,
} from '@/features/sheets/historyQuery'

export type {
  HistoryCellHistoryQueryOptions,
  HistoryDetailQueryOptions,
  HistoryOrigin,
  HistoryTimelineFilters,
  HistoryTimelineQueryOptions,
} from '@/features/sheets/historyQuery'

export interface HistoryCoverageOut {
  legacy_unresolved_layer_count: number
  legacy_detail_unavailable_count: number
}

export interface HistoryJumpTargetOut {
  layer_key: string | null
  condition_id: number | null
  parameter_code: string | null
  cell_ref: string | null
  jump_status: 'available' | 'deleted'
}

export interface HistoryTimelineItemOut {
  kind: 'event' | 'batch'
  cursor_id: number
  event_types: string[]
  actors: string[]
  origins: HistoryOrigin[]
  started_at: string
  occurred_at: string
  layer_keys: string[]
  source_project_id: number | null
  batch_id: string | null
  matched_event_count: number
  total_event_count: number
  summary: string
  jump_target: HistoryJumpTargetOut | null
  detail_status: 'available' | 'not_applicable' | 'legacy_unavailable'
  detail_scope: string | null
  metadata_status: 'complete' | 'legacy_partial'
}

export interface HistoryTimelineOut {
  items: HistoryTimelineItemOut[]
  coverage: HistoryCoverageOut
  next_cursor: string | null
}

export interface HistoryStateEntryOut {
  code: string | null
  label: string | null
}

export interface HistoryDetailCaptureTupleOut {
  target_layer_sort: number
  target_layer_key: string
  source_condition_index: number
  source_condition_id: number
  parameter_sort: number
  parameter_code: string
  event_id: number | null
}

export interface HistoryDomainCoordinateOut {
  layer_key: string
  condition_id: number | null
  parameter_code: string | null
  cell_ref: string | null
}

export interface HistoryDetailItemOut {
  event_id: number
  old_code: string | null
  new_code: string | null
  copied_value: string | null
  choice_label: string | null
  actor: string | null
  origin: HistoryOrigin
  created_at: string
  layer_key: string | null
  jump_target: HistoryJumpTargetOut | null
  domain_coordinate: HistoryDomainCoordinateOut | null
  capture_tuple: HistoryDetailCaptureTupleOut | null
  metadata_status: 'complete' | 'legacy_partial'
}

export interface HistoryDetailOut {
  order_kind: 'event_desc' | 'capture_asc'
  detail_status: 'available' | 'not_applicable' | 'legacy_unavailable'
  items: HistoryDetailItemOut[]
  reason: string | null
  next_cursor: string | null
}

export interface HistoryCellHistoryItemOut {
  event_id: number
  old_code: string | null
  new_code: string | null
  choice_label: string | null
  actor: string | null
  origin: HistoryOrigin
  created_at: string
  layer_key: string | null
  jump_status: 'available' | 'deleted'
  metadata_status: 'complete' | 'legacy_partial'
}

export interface HistoryCellHistoryOut {
  items: HistoryCellHistoryItemOut[]
  baseline_entry: HistoryStateEntryOut | null
  initial_entry: HistoryStateEntryOut | null
  initial_state_unavailable: boolean
  next_cursor: string | null
}

export async function getHistoryTimeline(
  projectId: number,
  filters: HistoryTimelineFilters,
  options: HistoryTimelineQueryOptions = {},
): Promise<HistoryTimelineOut> {
  const response = await apiClient.get<HistoryTimelineOut>(
    `/projects/${projectId}/events?${buildHistoryTimelineQueryString(filters, options)}`,
  )
  return response.data
}

export async function getHistoryBatchDetail(
  projectId: number,
  scope: string,
  batchId: string,
  options: HistoryDetailQueryOptions = {},
): Promise<HistoryDetailOut> {
  const response = await apiClient.get<HistoryDetailOut>(
    `/projects/${projectId}/event-batches/${encodeHistoryPathSegment(batchId, 64)}?${buildHistoryDetailQueryString(scope, options)}`,
  )
  return response.data
}

export async function getHistoryCellHistory(
  projectId: number,
  conditionId: number,
  parameterCode: string,
  options: HistoryCellHistoryQueryOptions = {},
): Promise<HistoryCellHistoryOut> {
  const response = await apiClient.get<HistoryCellHistoryOut>(
    `/projects/${projectId}/cell-history?${buildHistoryCellHistoryQueryString(conditionId, parameterCode, options)}`,
  )
  return response.data
}

export { historyCellHistoryQueryKey, historyDetailQueryKey, historyTimelineQueryKey }

function encodeHistoryPathSegment(value: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new TypeError('History path segment must be non-empty and within length bounds')
  }
  return encodeURIComponent(normalized)
}
