import type {
  HistoryCellHistoryItemOut,
  HistoryCoverageOut,
  HistoryDetailOut,
  HistoryJumpTargetOut,
  HistoryTimelineItemOut,
} from '@/api/history'
import {
  historyCellHistoryQueryKey,
  historyDetailQueryKey,
  historyTimelineQueryKey,
  normalizeHistoryTimelineFilters,
  type HistoryEventType,
  type HistoryTimelineFilterInput,
  type HistoryTimelineFilters,
} from '@/api/historyQuery'

import {
  appendHistoryTimelinePage,
  createHistoryTimelineState,
  resetHistoryTimelinePages,
  updateHistoryTimelineFilters,
  type HistoryTimelinePage,
  type HistoryTimelineState,
} from './historyState'

export interface HistoryCellScope {
  readonly conditionId: number
  readonly parameterCode: string
}

export type HistoryWorkbenchMode = 'timeline' | 'cell'

export interface HistoryWorkbenchState extends HistoryTimelineState {
  readonly mode: HistoryWorkbenchMode
  readonly expandedBatchKey: string | null
  readonly batchDetailCache: Readonly<Record<string, HistoryDetailOut>>
  readonly cellScope: HistoryCellScope | null
  readonly navigationAnnouncement: string | null
}

export type HistoryWorkbenchAction =
  | { readonly type: 'replace-filters'; readonly filters: HistoryTimelineFilterInput }
  | { readonly type: 'append-page'; readonly page: HistoryTimelinePage }
  | { readonly type: 'reset-pages' }
  | { readonly type: 'toggle-batch-detail'; readonly key: string }
  | {
      readonly type: 'store-batch-detail'
      readonly key: string
      readonly detail: HistoryDetailOut
    }
  | { readonly type: 'open-cell-scope'; readonly scope: HistoryCellScope }
  | { readonly type: 'close-cell-scope' }
  | { readonly type: 'announce-navigation'; readonly message: string | null }

export const HISTORY_EVENT_TYPES: readonly HistoryEventType[] = [
  'project_create',
  'project_profile_update',
  'backbone_copy',
  'backbone_layer_replace',
  'cell_update',
  'condition_add',
  'condition_remove',
  'por_change',
]

const HISTORY_EVENT_TYPE_LABELS: Readonly<Record<HistoryEventType, string>> = {
  project_create: '프로젝트 생성',
  project_profile_update: '프로젝트 정보 변경',
  backbone_copy: 'backbone 복사',
  backbone_layer_replace: 'backbone 레이어 교체',
  cell_update: '셀 수정',
  condition_add: '조건 추가',
  condition_remove: '조건 삭제',
  por_change: 'POR 변경',
}

export function createHistoryWorkbenchState(
  filters: HistoryTimelineFilterInput = {},
  cellScope: HistoryCellScope | null = null,
): HistoryWorkbenchState {
  return {
    ...createHistoryTimelineState(filters),
    mode: cellScope === null ? 'timeline' : 'cell',
    expandedBatchKey: null,
    batchDetailCache: {},
    cellScope,
    navigationAnnouncement: null,
  }
}

export function reduceHistoryWorkbenchState(
  state: HistoryWorkbenchState,
  action: HistoryWorkbenchAction,
): HistoryWorkbenchState {
  switch (action.type) {
    case 'replace-filters': {
      const timeline = updateHistoryTimelineFilters(state, action.filters)
      return {
        ...timeline,
        mode: state.mode,
        expandedBatchKey: null,
        batchDetailCache: {},
        cellScope: state.cellScope,
        navigationAnnouncement: null,
      }
    }
    case 'append-page':
      return appendHistoryWorkbenchPage(state, action.page)
    case 'reset-pages':
      return resetHistoryWorkbenchPages(state)
    case 'toggle-batch-detail':
      return state.expandedBatchKey === action.key
        ? { ...state, expandedBatchKey: null }
        : { ...state, expandedBatchKey: action.key, mode: 'timeline' }
    case 'store-batch-detail':
      return {
        ...state,
        batchDetailCache: {
          ...state.batchDetailCache,
          [action.key]: action.detail,
        },
      }
    case 'open-cell-scope':
      return {
        ...state,
        mode: 'cell',
        cellScope: action.scope,
        expandedBatchKey: null,
        navigationAnnouncement: null,
      }
    case 'close-cell-scope':
      return {
        ...state,
        mode: 'timeline',
        cellScope: null,
      }
    case 'announce-navigation':
      return {
        ...state,
        navigationAnnouncement: action.message,
      }
  }
}

export function appendHistoryWorkbenchPage(
  state: HistoryWorkbenchState,
  page: HistoryTimelinePage,
): HistoryWorkbenchState {
  const timeline = appendHistoryTimelinePage(state, page)
  return {
    ...timeline,
    mode: state.mode,
    expandedBatchKey: state.expandedBatchKey,
    batchDetailCache: state.batchDetailCache,
    cellScope: state.cellScope,
    navigationAnnouncement: state.navigationAnnouncement,
  }
}

export function resetHistoryWorkbenchPages(state: HistoryWorkbenchState): HistoryWorkbenchState {
  const timeline = resetHistoryTimelinePages(state)
  return {
    ...timeline,
    mode: state.mode,
    expandedBatchKey: state.expandedBatchKey,
    batchDetailCache: state.batchDetailCache,
    cellScope: state.cellScope,
    navigationAnnouncement: state.navigationAnnouncement,
  }
}

export function updateHistoryWorkbenchFilters(
  state: HistoryWorkbenchState,
  filters: HistoryTimelineFilterInput,
): HistoryWorkbenchState {
  return reduceHistoryWorkbenchState(state, { type: 'replace-filters', filters })
}

export function normalizeHistoryWorkbenchFilters(
  filters: HistoryTimelineFilterInput,
): HistoryTimelineFilters {
  return normalizeHistoryTimelineFilters(filters)
}

export function openHistoryCellScope(
  state: HistoryWorkbenchState,
  scope: HistoryCellScope,
): HistoryWorkbenchState {
  return reduceHistoryWorkbenchState(state, { type: 'open-cell-scope', scope })
}

export function closeHistoryCellScope(state: HistoryWorkbenchState): HistoryWorkbenchState {
  return reduceHistoryWorkbenchState(state, { type: 'close-cell-scope' })
}

export function toggleHistoryBatchDetail(
  state: HistoryWorkbenchState,
  key: string,
): HistoryWorkbenchState {
  return reduceHistoryWorkbenchState(state, { type: 'toggle-batch-detail', key })
}

export function storeHistoryBatchDetail(
  state: HistoryWorkbenchState,
  key: string,
  detail: HistoryDetailOut,
): HistoryWorkbenchState {
  return reduceHistoryWorkbenchState(state, { type: 'store-batch-detail', key, detail })
}

export function historyWorkbenchTimelineKey(
  projectId: number,
  filters: HistoryTimelineFilterInput,
): readonly unknown[] {
  return historyTimelineQueryKey(projectId, filters)
}

export function historyWorkbenchBatchDetailKey(
  projectId: number,
  scope: string,
  batchId: string,
): readonly unknown[] {
  return historyDetailQueryKey(projectId, scope, batchId)
}

export function historyWorkbenchCellHistoryKey(
  projectId: number,
  conditionId: number,
  parameterCode: string,
): readonly unknown[] {
  return historyCellHistoryQueryKey(projectId, conditionId, parameterCode)
}

export function getHistoryBatchDetailCacheKey(scope: string, batchId: string): string {
  return `${scope}::${batchId}`
}

export function getHistoryTimelineItemKey(item: HistoryTimelineItemOut): string {
  return item.kind === 'batch'
    ? getHistoryBatchDetailCacheKey(
        item.detail_scope ?? 'detail',
        item.batch_id ?? String(item.cursor_id),
      )
    : `event::${item.cursor_id}`
}

export function hasHistoryBatchDetailCache(
  state: HistoryWorkbenchState,
  item: HistoryTimelineItemOut,
): boolean {
  if (item.kind !== 'batch') return false
  return state.batchDetailCache[getHistoryTimelineItemKey(item)] !== undefined
}

export function shouldRequestHistoryBatchDetailOnOpen(
  state: HistoryWorkbenchState,
  item: HistoryTimelineItemOut,
): boolean {
  return item.kind === 'batch' && item.detail_status === 'available' && !hasHistoryBatchDetailCache(state, item)
}

export function resolveHistoryActorLabel(
  actors: readonly string[],
  displayNames: Readonly<Record<string, string>> = {},
): string {
  const actor = actors[0]
  if (actor === undefined || actor.trim() === '') return '알 수 없음'
  return displayNames[actor] ?? actor
}

export function describeHistoryLegacyCoverage(coverage: HistoryCoverageOut): string | null {
  const unresolved = coverage.legacy_unresolved_layer_count
  const unavailable = coverage.legacy_detail_unavailable_count
  if (unresolved === 0 && unavailable === 0) return null

  const parts = [
    unresolved > 0 ? `필터에서 위치를 확인할 수 없는 과거 항목 ${unresolved}개` : null,
    unavailable > 0 ? `상세를 불러올 수 없는 레거시 항목 ${unavailable}개` : null,
  ].filter((value): value is string => value !== null)

  return `레거시 이력 일부가 남아 있습니다: ${parts.join(' · ')}`
}

export function describeHistoryDetailStatus(item: HistoryTimelineItemOut): string | null {
  switch (item.detail_status) {
    case 'legacy_unavailable':
      return '이 항목은 레거시 상세 형식이라 상세 내용을 불러올 수 없습니다.'
    case 'not_applicable':
      return '이 항목은 상세 이력이 없는 요약입니다.'
    case 'available':
      return null
  }
}

export function describeHistoryJumpTarget(target: HistoryJumpTargetOut | null): string | null {
  if (target === null) return null
  if (target.jump_status === 'deleted') {
    return '삭제된 대상이라 위치로 이동할 수 없습니다.'
  }
  return null
}

export function buildHistoryCellActivationTarget(
  scope: HistoryCellScope,
  item: HistoryCellHistoryItemOut,
): HistoryJumpTargetOut {
  return {
    layer_key: item.layer_key,
    condition_id: scope.conditionId,
    parameter_code: scope.parameterCode,
    cell_ref: null,
    jump_status: item.jump_status,
  }
}

export function handleHistoryWorkbenchItemActivationKey(
  key: string,
  repeat: boolean,
  preventDefault: () => void,
  onActivate: () => void,
): void {
  if (repeat) return
  if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return
  preventDefault()
  onActivate()
}

export function historyEventTypeLabel(eventType: HistoryEventType): string {
  return HISTORY_EVENT_TYPE_LABELS[eventType]
}
