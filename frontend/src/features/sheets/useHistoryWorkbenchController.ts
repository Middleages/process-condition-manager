import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { getHistoryBatchDetail, getHistoryCellHistory, getHistoryTimeline } from '@/api/history'
import type {
  HistoryCellHistoryOut,
  HistoryCoverageOut,
  HistoryTimelineItemOut,
} from '@/api/history'
import type { HistoryTimelineFilterInput } from '@/api/historyQuery'

import {
  createHistoryWorkbenchState,
  getHistoryTimelineItemKey,
  historyWorkbenchBatchDetailKey,
  historyWorkbenchCellHistoryKey,
  historyWorkbenchTimelineKey,
  openHistoryCellScope,
  storeHistoryBatchDetail,
  toggleHistoryBatchDetail,
  updateHistoryWorkbenchFilters,
  type HistoryCellScope,
  type HistoryWorkbenchMode,
  type HistoryWorkbenchState,
} from './historyWorkbenchState'

const EMPTY_HISTORY_COVERAGE: HistoryCoverageOut = {
  legacy_unresolved_layer_count: 0,
  legacy_detail_unavailable_count: 0,
}

export interface HistoryWorkbenchController {
  state: HistoryWorkbenchState
  coverage: HistoryCoverageOut
  timelineStatus: 'idle' | 'loading' | 'ready' | 'error'
  timelineError: string | null
  nextPageError: string | null
  cellHistory: HistoryCellHistoryOut | null
  cellStatus: 'idle' | 'loading' | 'ready' | 'error'
  cellError: string | null
  cellNextPageError: string | null
  onFiltersChange: (filters: HistoryTimelineFilterInput) => void
  onModeChange: (mode: HistoryWorkbenchMode) => void
  onBatchToggle: (item: HistoryTimelineItemOut, shouldRequestDetail: boolean) => void
  onCellHistoryRequest: (target: { conditionId: string; parameterCode: string }) => void
  onLoadMoreTimeline: (cursor: string | null) => void
  onLoadMoreCell: (cursor: string | null) => void
  onRetryTimeline: () => void
  onRetryCell: () => void
}

export function useHistoryWorkbenchController(projectId: number): HistoryWorkbenchController {
  const [state, setState] = useState(() => createHistoryWorkbenchState())

  const timelineQuery = useInfiniteQuery({
    queryKey: historyWorkbenchTimelineKey(projectId, state.filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      getHistoryTimeline(projectId, state.filters, {
        cursor: pageParam ?? undefined,
      }),
    getNextPageParam: (page) => page.next_cursor,
    retry: false,
  })

  const timelinePages = useMemo(
    () =>
      timelineQuery.data?.pages.map((page) => ({
        items: page.items,
        nextCursor: page.next_cursor,
      })) ?? [],
    [timelineQuery.data],
  )
  const timelineItems = useMemo(
    () => timelinePages.flatMap((page) => page.items),
    [timelinePages],
  )
  const coverage = timelineQuery.data?.pages[0]?.coverage ?? EMPTY_HISTORY_COVERAGE
  const expandedBatchItem = useMemo(() => {
    if (state.expandedBatchKey === null) return null
    return timelineItems.find((item) => getHistoryTimelineItemKey(item) === state.expandedBatchKey) ?? null
  }, [state.expandedBatchKey, timelineItems])

  const batchDetailQuery = useQuery({
    queryKey:
      expandedBatchItem?.kind === 'batch' &&
      expandedBatchItem.detail_status === 'available' &&
      expandedBatchItem.detail_scope !== null &&
      expandedBatchItem.batch_id !== null
        ? historyWorkbenchBatchDetailKey(
            projectId,
            expandedBatchItem.detail_scope,
            expandedBatchItem.batch_id,
          )
        : ['history', projectId, 'detail', 'idle', state.expandedBatchKey ?? 'none'],
    queryFn: () => {
      if (
        expandedBatchItem === null ||
        expandedBatchItem.kind !== 'batch' ||
        expandedBatchItem.detail_scope === null ||
        expandedBatchItem.batch_id === null
      ) {
        throw new TypeError('Expanded history batch detail is unavailable')
      }
      return getHistoryBatchDetail(
        projectId,
        expandedBatchItem.detail_scope,
        expandedBatchItem.batch_id,
      )
    },
    enabled:
      expandedBatchItem?.kind === 'batch' &&
      expandedBatchItem.detail_status === 'available' &&
      expandedBatchItem.detail_scope !== null &&
      expandedBatchItem.batch_id !== null,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const cellHistoryQuery = useInfiniteQuery({
    queryKey:
      state.cellScope !== null
        ? historyWorkbenchCellHistoryKey(
            projectId,
            state.cellScope.conditionId,
            state.cellScope.parameterCode,
          )
        : ['history', projectId, 'cell-history', 'idle'],
    queryFn: () => {
      if (state.cellScope === null) {
        throw new TypeError('Cell history scope is unavailable')
      }
      return getHistoryCellHistory(
        projectId,
        state.cellScope.conditionId,
        state.cellScope.parameterCode,
      )
    },
    enabled: state.cellScope !== null,
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })

  useEffect(() => {
    if (expandedBatchItem === null || batchDetailQuery.data === undefined) return
    const batchKey = getHistoryTimelineItemKey(expandedBatchItem)
    setState((current) =>
      current.batchDetailCache[batchKey] === batchDetailQuery.data
        ? current
        : storeHistoryBatchDetail(current, batchKey, batchDetailQuery.data),
    )
  }, [batchDetailQuery.data, expandedBatchItem])

  const batchDetailCache = useMemo(() => {
    if (expandedBatchItem === null || batchDetailQuery.data === undefined) {
      return state.batchDetailCache
    }
    const batchKey = getHistoryTimelineItemKey(expandedBatchItem)
    return {
      ...state.batchDetailCache,
      [batchKey]: batchDetailQuery.data,
    }
  }, [batchDetailQuery.data, expandedBatchItem, state.batchDetailCache])

  const historyState = useMemo<HistoryWorkbenchState>(
    () => ({
      ...state,
      pages: timelinePages,
      nextCursor: timelinePages.length === 0 ? null : timelinePages[timelinePages.length - 1].nextCursor,
      batchDetailCache,
    }),
    [batchDetailCache, state, timelinePages],
  )

  const timelineStatus: HistoryWorkbenchController['timelineStatus'] =
    timelineQuery.isPending && timelineQuery.data === undefined
      ? 'loading'
      : timelineQuery.isError
        ? 'error'
        : 'ready'
  const nextPageError =
    timelineQuery.isFetchNextPageError && timelineQuery.error !== null
      ? getErrorMessage(timelineQuery.error)
      : null
  const cellStatus: HistoryWorkbenchController['cellStatus'] =
    state.cellScope !== null && cellHistoryQuery.isPending && cellHistoryQuery.data === undefined
      ? 'loading'
      : cellHistoryQuery.isError
        ? 'error'
        : 'ready'
  const cellNextPageError =
    cellHistoryQuery.isFetchNextPageError && cellHistoryQuery.error !== null
      ? getErrorMessage(cellHistoryQuery.error)
      : null

  const onFiltersChange = useCallback((filters: HistoryTimelineFilterInput) => {
    setState((current) => updateHistoryWorkbenchFilters(current, filters))
  }, [])

  const onModeChange = useCallback((mode: HistoryWorkbenchMode) => {
    setState((current) => (current.mode === mode ? current : { ...current, mode }))
  }, [])

  const onBatchToggle = useCallback((item: HistoryTimelineItemOut) => {
    const batchKey = getHistoryTimelineItemKey(item)
    setState((current) => toggleHistoryBatchDetail(current, batchKey))
  }, [])

  const onCellHistoryRequest = useCallback((target: { conditionId: string; parameterCode: string }) => {
    const conditionId = Number(target.conditionId)
    if (!Number.isInteger(conditionId)) return
    const scope: HistoryCellScope = {
      conditionId,
      parameterCode: target.parameterCode,
    }
    setState((current) => openHistoryCellScope(current, scope))
  }, [])

  const onLoadMoreTimeline = useCallback(() => {
    void timelineQuery.fetchNextPage()
  }, [timelineQuery])

  const onLoadMoreCell = useCallback(() => {
    void cellHistoryQuery.fetchNextPage()
  }, [cellHistoryQuery])

  const onRetryTimeline = useCallback(() => {
    void timelineQuery.refetch()
  }, [timelineQuery])

  const onRetryCell = useCallback(() => {
    void cellHistoryQuery.refetch()
  }, [cellHistoryQuery])

  return {
    state: historyState,
    coverage,
    timelineStatus,
    timelineError: timelineQuery.isError ? getErrorMessage(timelineQuery.error) : null,
    nextPageError,
    cellHistory:
      cellHistoryQuery.data === undefined
        ? null
        : {
            items: cellHistoryQuery.data.pages.flatMap((page) => page.items),
            baseline_entry: cellHistoryQuery.data.pages[0]?.baseline_entry ?? null,
            initial_entry: cellHistoryQuery.data.pages[0]?.initial_entry ?? null,
            initial_state_unavailable:
              cellHistoryQuery.data.pages[0]?.initial_state_unavailable ?? false,
            next_cursor:
              cellHistoryQuery.data.pages[cellHistoryQuery.data.pages.length - 1]?.next_cursor ??
              null,
          },
    cellStatus,
    cellError: cellHistoryQuery.isError ? getErrorMessage(cellHistoryQuery.error) : null,
    cellNextPageError,
    onFiltersChange,
    onModeChange,
    onBatchToggle,
    onCellHistoryRequest,
    onLoadMoreTimeline,
    onLoadMoreCell,
    onRetryTimeline,
    onRetryCell,
  }
}

function getErrorMessage(error: unknown): string {
  if (error === null || error === undefined) return '알 수 없는 오류가 발생했습니다.'
  return error instanceof Error ? error.message : String(error)
}
