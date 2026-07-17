import {
  buildHistoryCellHistoryQueryString,
  buildHistoryDetailQueryString,
  createHistoryTimelineFilters,
  historyCellHistoryQueryKey,
  historyDetailQueryKey,
  historyTimelineQueryKey,
  normalizeHistoryTimelineFilters,
  type HistoryCellHistoryItemOut,
  type HistoryCellHistoryOut,
  type HistoryCoverageOut,
  type HistoryDetailOut,
  type HistoryDetailQueryOptions,
  type HistoryJumpTargetOut,
  type HistoryOrigin,
  type HistoryTimelineFilterInput,
  type HistoryTimelineFilters,
  type HistoryTimelineItemOut,
  type HistoryTimelineOut,
  type HistoryTimelineQueryOptions,
  type HistoryStateEntryOut,
  type HistoryDomainCoordinateOut,
} from '@/api/history'

export type {
  HistoryCellHistoryItemOut,
  HistoryCellHistoryOut,
  HistoryCoverageOut,
  HistoryDetailOut,
  HistoryJumpTargetOut,
  HistoryOrigin,
  HistoryTimelineFilterInput,
  HistoryTimelineFilters,
  HistoryTimelineItemOut,
  HistoryTimelineOut,
  HistoryStateEntryOut,
  HistoryDomainCoordinateOut,
} from '@/api/history'

export { buildHistoryCellHistoryQueryString, buildHistoryDetailQueryString }
export { historyCellHistoryQueryKey, historyDetailQueryKey, historyTimelineQueryKey }
export { createHistoryTimelineFilters, normalizeHistoryTimelineFilters }

export interface HistoryWorkbenchState {
  readonly filters: HistoryTimelineFilters
  readonly timelinePages: readonly HistoryTimelineOut[]
}

export type HistoryWorkbenchAction =
  | {
      readonly type: 'change-filter'
      readonly field: keyof HistoryTimelineFilterInput
      readonly value: string
    }
  | {
      readonly type: 'change-origin'
      readonly value: HistoryOrigin | ''
    }
  | { readonly type: 'append-page'; readonly page: HistoryTimelineOut }
  | { readonly type: 'replace-pages'; readonly pages: readonly HistoryTimelineOut[] }

export function createHistoryWorkbenchState(
  filters: HistoryTimelineFilterInput = {},
): HistoryWorkbenchState {
  return {
    filters: createHistoryTimelineFilters(filters),
    timelinePages: [],
  }
}

export function reduceHistoryWorkbenchState(
  state: HistoryWorkbenchState,
  action: HistoryWorkbenchAction,
): HistoryWorkbenchState {
  if (action.type === 'append-page') {
    return { ...state, timelinePages: [...state.timelinePages, action.page] }
  }

  if (action.type === 'replace-pages') {
    return { ...state, timelinePages: [...action.pages] }
  }

  if (action.type === 'change-filter') {
    const nextFilters = normalizeHistoryTimelineFilters({
      ...state.filters,
      [action.field]: normalizeFilterValue(action.value),
    })
    return { filters: nextFilters, timelinePages: [] }
  }

  if (action.type === 'change-origin') {
    const nextFilters = normalizeHistoryTimelineFilters({
      ...state.filters,
      origin: action.value === '' ? null : action.value,
    })
    return { filters: nextFilters, timelinePages: [] }
  }

  return state
}

export function flattenHistoryTimelinePages(
  pages: readonly HistoryTimelineOut[],
): readonly HistoryTimelineItemOut[] {
  return pages.flatMap((page) => page.items)
}

export function historyTimelineQueryKeyForState(
  projectId: number,
  filters: HistoryTimelineFilters,
): readonly unknown[] {
  return historyTimelineQueryKey(projectId, filters)
}

export function historyCellHistoryQueryKeyForScope(
  projectId: number,
  conditionId: number,
  parameterCode: string,
): readonly unknown[] {
  return historyCellHistoryQueryKey(projectId, conditionId, parameterCode)
}

export function historyDetailQueryKeyForBatch(
  projectId: number,
  scope: string,
  batchId: string,
): readonly unknown[] {
  return historyDetailQueryKey(projectId, scope, batchId)
}

export function formatHistoryActorLabel(actor: string | null | undefined): string {
  const normalized = actor?.trim() ?? ''
  if (normalized === '') return '알 수 없음'
  return normalized
}

export function historyItemDisplayKey(item: Pick<HistoryTimelineItemOut, 'kind' | 'batch_id' | 'cursor_id'>): string {
  return item.batch_id ?? `${item.kind}:${item.cursor_id}`
}

export type HistoryItemNavigation =
  | { readonly kind: 'available'; readonly target: HistoryJumpTargetOut }
  | { readonly kind: 'deleted'; readonly announcement: string }
  | { readonly kind: 'missing-target'; readonly announcement: string }

export function resolveHistoryItemNavigation(
  item: Pick<HistoryTimelineItemOut, 'jump_target' | 'summary'>,
): HistoryItemNavigation {
  if (item.jump_target === null) {
    return {
      kind: 'missing-target',
      announcement: '이동할 대상이 없는 이력입니다.',
    }
  }
  if (item.jump_target.jump_status === 'deleted') {
    return {
      kind: 'deleted',
      announcement: '삭제된 대상이라 이동할 수 없습니다.',
    }
  }
  return { kind: 'available', target: item.jump_target }
}

export function resolveCellHistoryNavigation(
  scope: HistoryDomainCoordinateOut,
  item: Pick<HistoryCellHistoryItemOut, 'jump_status'>,
): HistoryItemNavigation {
  if (item.jump_status === 'deleted') {
    return {
      kind: 'deleted',
      announcement: '삭제된 대상이라 이동할 수 없습니다.',
    }
  }
  return {
    kind: 'available',
    target: {
      layer_key: scope.layer_key,
      condition_id: scope.condition_id,
      parameter_code: scope.parameter_code,
      cell_ref: scope.cell_ref,
      jump_status: 'available',
    },
  }
}

export function historyLegacyCoverageMessage(coverage: HistoryCoverageOut): string | null {
  const parts: string[] = []
  if (coverage.legacy_unresolved_layer_count > 0) {
    parts.push(
      `필터에서 위치를 확인할 수 없는 과거 항목 ${coverage.legacy_unresolved_layer_count}개`,
    )
  }
  if (coverage.legacy_detail_unavailable_count > 0) {
    parts.push(`상세 이력을 아직 제공할 수 없는 항목 ${coverage.legacy_detail_unavailable_count}개`)
  }
  return parts.length === 0 ? null : parts.join(' · ')
}

export function historyDetailStatusMessage(
  detailStatus: HistoryDetailOut['detail_status'],
): string {
  if (detailStatus === 'legacy_unavailable') {
    return '상세 이력은 아직 제공되지 않습니다.'
  }
  if (detailStatus === 'not_applicable') {
    return '이 항목은 상세 이력이 없습니다.'
  }
  return '상세 이력을 불러올 수 있습니다.'
}

export function isHistoryTileActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' '
}

export function handleHistoryTileActivationKey(
  key: string,
  repeat: boolean,
  preventDefault: () => void,
  activate: () => void,
): void {
  if (!isHistoryTileActivationKey(key)) return
  preventDefault()
  if (repeat) return
  activate()
}

function normalizeFilterValue(value: string): string | null | readonly string[] {
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
  }
  return trimmed
}
