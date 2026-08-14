import { useCallback, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'

import { getApiErrorMessage } from '@/api/client'
import {
  getHistoryBatchDetail,
  getHistoryCellHistory,
  getHistoryTimeline,
  type HistoryCellHistoryOut,
  type HistoryCoverageOut,
  type HistoryDetailOut,
  type HistoryTimelineItemOut,
  type HistoryTimelineOut,
} from '@/api/history'
import type { HistoryTimelineFilterInput } from '@/api/historyQuery'
import { useIsomorphicLayoutEffect } from '@/shared/lib/useIsomorphicLayoutEffect'

import {
  createHistoryWorkbenchState,
  getHistoryTimelineItemKey,
  historyWorkbenchBatchDetailKey,
  historyWorkbenchCellHistoryKey,
  historyWorkbenchTimelineKey,
  invalidateHistoryBatchDetailsForMutation,
  rememberHistoryCellScope,
  replaceHistoryLayerScope,
  storeHistoryBatchDetail,
  toggleHistoryBatchDetail,
  updateHistoryWorkbenchFilters,
  type HistoryCellScope,
  type HistoryWorkbenchMode,
  type HistoryWorkbenchState,
} from './historyWorkbenchState'
import type { HistoryTimelinePage } from './historyState'

const EMPTY_HISTORY_COVERAGE: HistoryCoverageOut = {
  legacy_unresolved_layer_count: 0,
  legacy_detail_unavailable_count: 0,
}

type HistoryQueryStatus = 'idle' | 'loading' | 'ready' | 'error'
type HistoryDetailStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface HistoryWorkbenchController {
  state: HistoryWorkbenchState
  coverage: HistoryCoverageOut
  timelineStatus: HistoryQueryStatus
  timelineError: string | null
  nextPageError: string | null
  cellHistory: HistoryCellHistoryOut | null
  cellStatus: HistoryQueryStatus
  cellError: string | null
  cellNextPageError: string | null
  batchDetailStatus: HistoryDetailStatus
  batchDetailError: string | null
  batchDetailIsFetchingNextPage: boolean
  batchDetailNextPageError: string | null
  onFiltersChange: (filters: HistoryTimelineFilterInput) => void
  onModeChange: (mode: HistoryWorkbenchMode) => void
  onLayerScopeChange: (layerKey: string) => void
  onSelectedCellChange: (
    target: { conditionId: string; parameterCode: string } | null,
  ) => boolean
  onScopeChange: (mode: HistoryWorkbenchMode) => boolean
  onBatchToggle: (item: HistoryTimelineItemOut, shouldRequestDetail: boolean) => void
  onRetryBatchDetail: (item: HistoryTimelineItemOut) => void
  onLoadMoreBatchDetail: (item: HistoryTimelineItemOut, cursor: string | null) => void
  onCellHistoryRequest: (target: {
    conditionId: string
    parameterCode: string
  }) => boolean
  onLoadMoreTimeline: (cursor: string | null) => void
  onLoadMoreCell: (cursor: string | null) => void
  onRetryTimeline: () => void
  onRetryCell: () => void
}

export interface HistoryQueryPresentationInput {
  readonly enabled: boolean
  readonly isPending: boolean
  readonly isError: boolean
  readonly isFetchNextPageError: boolean
  readonly error: unknown
}

export interface HistoryQueryPresentation {
  readonly status: HistoryQueryStatus
  readonly rootError: string | null
  readonly nextPageError: string | null
}

export interface HistoryDetailAuthority {
  readonly enabled: boolean
  readonly outerGeneration: number
  readonly revision: number
  readonly mode: HistoryWorkbenchMode
  readonly detailKey: string | null
  readonly cellScopeKey: string | null
}

interface HistoryDetailRequestState {
  readonly key: string | null
  readonly status: HistoryDetailStatus
  readonly error: string | null
  readonly phase: 'root' | 'next' | null
  readonly cursor: string | null
}

interface HistoryBatchDetailRequest {
  readonly key: string
  readonly scope: string
  readonly batchId: string
}

export function historyTimelineQueryEnabled(
  outerHistoryEnabled: boolean,
  mode: HistoryWorkbenchMode,
): boolean {
  return outerHistoryEnabled && mode === 'timeline'
}

export function historyCellHistoryQueryEnabled(
  outerHistoryEnabled: boolean,
  mode: HistoryWorkbenchMode,
  scope: HistoryCellScope | null,
): boolean {
  return outerHistoryEnabled && mode === 'cell' && scope !== null
}

export function parseHistoryCellScope(target: {
  conditionId: string
  parameterCode: string
}): HistoryCellScope | null {
  const conditionIdText = target.conditionId.trim()
  const parameterCode = target.parameterCode.trim()
  if (!/^[1-9]\d*$/.test(conditionIdText)) return null
  const conditionId = Number(conditionIdText)
  if (!Number.isSafeInteger(conditionId) || conditionId < 1) return null
  if (parameterCode.length === 0 || parameterCode.length > 64) return null
  return { conditionId, parameterCode }
}

export function mergeHistoryTimelinePages(
  pages: readonly HistoryTimelineOut[],
): {
  readonly pages: readonly HistoryTimelinePage[]
  readonly items: readonly HistoryTimelineItemOut[]
  readonly nextCursor: string | null
  readonly coverage: HistoryCoverageOut
} {
  const currentPages = pages.map((page) => ({
    items: page.items,
    nextCursor: page.next_cursor,
  }))
  return {
    pages: currentPages,
    items: currentPages.flatMap((page) => page.items),
    nextCursor: pages[pages.length - 1]?.next_cursor ?? null,
    coverage: pages[0]?.coverage ?? EMPTY_HISTORY_COVERAGE,
  }
}

export function mergeHistoryCellHistoryPages(
  pages: readonly HistoryCellHistoryOut[],
): HistoryCellHistoryOut | null {
  const first = pages[0]
  if (first === undefined) return null
  return {
    items: pages.flatMap((page) => page.items),
    baseline_entry: first.baseline_entry,
    initial_entry: first.initial_entry,
    initial_state_unavailable: first.initial_state_unavailable,
    next_cursor: pages[pages.length - 1]?.next_cursor ?? null,
  }
}

export function mergeHistoryBatchDetailPage(
  current: HistoryDetailOut,
  page: HistoryDetailOut,
): HistoryDetailOut {
  return {
    ...current,
    items: [...current.items, ...page.items],
    next_cursor: page.next_cursor,
  }
}

export function historyQueryPresentation(
  input: HistoryQueryPresentationInput,
): HistoryQueryPresentation {
  if (!input.enabled) {
    return { status: 'idle', rootError: null, nextPageError: null }
  }
  if (input.isPending) {
    return { status: 'loading', rootError: null, nextPageError: null }
  }
  if (input.isFetchNextPageError) {
    return {
      status: 'ready',
      rootError: null,
      nextPageError: getApiErrorMessage(input.error),
    }
  }
  if (input.isError) {
    return {
      status: 'error',
      rootError: getApiErrorMessage(input.error),
      nextPageError: null,
    }
  }
  return { status: 'ready', rootError: null, nextPageError: null }
}

export function isCurrentHistoryDetailAuthority(
  expected: HistoryDetailAuthority,
  current: HistoryDetailAuthority,
): boolean {
  return (
    expected.enabled &&
    current.enabled &&
    expected.outerGeneration === current.outerGeneration &&
    expected.revision === current.revision &&
    expected.mode === 'timeline' &&
    current.mode === 'timeline' &&
    expected.detailKey === current.detailKey &&
    expected.cellScopeKey === current.cellScopeKey
  )
}

export function useHistoryWorkbenchController(
  projectId: number,
  enabled: boolean,
  historyMutationRevision = 0,
): HistoryWorkbenchController {
  const queryClient = useQueryClient()
  const [state, setState] = useState(() => createHistoryWorkbenchState())
  const stateRef = useRef(state)
  const enabledRef = useRef(enabled)
  const previousEnabledRef = useRef(enabled)
  const previousMutationRevisionRef = useRef(historyMutationRevision)
  const outerGenerationRef = useRef(0)
  const detailRequestTokenRef = useRef(0)
  const initialDetailRequest: HistoryDetailRequestState = {
    key: null,
    status: 'idle',
    error: null,
    phase: null,
    cursor: null,
  }
  const detailRequestRef = useRef(initialDetailRequest)
  const [detailRequest, setDetailRequest] = useState<HistoryDetailRequestState>(
    initialDetailRequest,
  )

  useIsomorphicLayoutEffect(() => {
    stateRef.current = state
  }, [state])

  const commitState = useCallback(
    (update: (current: HistoryWorkbenchState) => HistoryWorkbenchState) => {
      const current = stateRef.current
      const next = update(current)
      if (next === current) return current
      stateRef.current = next
      setState(next)
      return next
    },
    [],
  )

  const commitDetailRequest = useCallback((next: HistoryDetailRequestState) => {
    detailRequestRef.current = next
    setDetailRequest(next)
  }, [])

  useIsomorphicLayoutEffect(() => {
    const enabledChanged = previousEnabledRef.current !== enabled
    const mutationRevisionChanged =
      previousMutationRevisionRef.current !== historyMutationRevision

    previousEnabledRef.current = enabled
    previousMutationRevisionRef.current = historyMutationRevision

    if (enabledChanged || mutationRevisionChanged) {
      outerGenerationRef.current += 1
      detailRequestTokenRef.current += 1
      commitDetailRequest({
        key: null,
        status: 'idle',
        error: null,
        phase: null,
        cursor: null,
      })
      if (mutationRevisionChanged) {
        commitState((current) => invalidateHistoryBatchDetailsForMutation(current))
      } else if (!enabled) {
        commitState((current) =>
          current.expandedBatchKey === null
            ? current
            : { ...current, expandedBatchKey: null },
        )
      }
    }
    enabledRef.current = enabled
  }, [commitDetailRequest, commitState, enabled, historyMutationRevision])

  const timelineEnabled = historyTimelineQueryEnabled(enabled, state.mode)
  const timelineQuery = useInfiniteQuery({
    queryKey: historyWorkbenchTimelineKey(projectId, state.filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      getHistoryTimeline(projectId, state.filters, { cursor: pageParam }),
    getNextPageParam: (page) => page.next_cursor,
    enabled: timelineEnabled,
  })

  const cellScope = state.cellScope
  const cellEnabled = historyCellHistoryQueryEnabled(enabled, state.mode, cellScope)
  const cellHistoryQuery = useInfiniteQuery({
    queryKey:
      cellScope === null
        ? ['history', projectId, 'cell-history', 'idle']
        : historyWorkbenchCellHistoryKey(
            projectId,
            cellScope.conditionId,
            cellScope.parameterCode,
          ),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      if (cellScope === null) throw new TypeError('Cell history scope is unavailable')
      return getHistoryCellHistory(projectId, cellScope.conditionId, cellScope.parameterCode, {
        cursor: pageParam,
      })
    },
    getNextPageParam: (page) => page.next_cursor,
    enabled: cellEnabled,
  })

  const timeline = useMemo(
    () => mergeHistoryTimelinePages(timelineQuery.data?.pages ?? []),
    [timelineQuery.data?.pages],
  )
  const cellHistory = useMemo(
    () => mergeHistoryCellHistoryPages(cellHistoryQuery.data?.pages ?? []),
    [cellHistoryQuery.data?.pages],
  )
  const historyState = useMemo<HistoryWorkbenchState>(
    () => ({
      ...state,
      pages: timeline.pages,
      nextCursor: timeline.nextCursor,
    }),
    [state, timeline.nextCursor, timeline.pages],
  )

  const timelinePresentation = historyQueryPresentation({
    enabled: timelineEnabled,
    isPending: timelineQuery.isPending,
    isError: timelineQuery.isError,
    isFetchNextPageError: timelineQuery.isFetchNextPageError,
    error: timelineQuery.error,
  })
  const cellPresentation = historyQueryPresentation({
    enabled: cellEnabled,
    isPending: cellHistoryQuery.isPending,
    isError: cellHistoryQuery.isError,
    isFetchNextPageError: cellHistoryQuery.isFetchNextPageError,
    error: cellHistoryQuery.error,
  })

  const requestBatchDetail = useCallback(
    async (item: HistoryTimelineItemOut, cursor: string | null): Promise<void> => {
      const request = historyBatchDetailRequest(item)
      if (request === null) return
      const phase = cursor === null ? 'root' : 'next'
      const cachedDetail = stateRef.current.batchDetailCache[request.key]
      if (phase === 'root' && cachedDetail !== undefined) return
      if (phase === 'next' && cachedDetail?.next_cursor !== cursor) return
      if (
        detailRequestRef.current.key === request.key &&
        detailRequestRef.current.status === 'loading'
      ) {
        return
      }
      const expected = historyDetailAuthority(
        enabledRef.current,
        stateRef.current,
        request.key,
        outerGenerationRef.current,
      )
      if (
        !expected.enabled ||
        expected.mode !== 'timeline' ||
        expected.detailKey !== request.key
      ) {
        return
      }

      const token = ++detailRequestTokenRef.current
      commitDetailRequest({
        key: request.key,
        status: 'loading',
        error: null,
        phase,
        cursor,
      })
      try {
        const detailQueryKey = historyWorkbenchBatchDetailKey(
          projectId,
          request.scope,
          request.batchId,
        )
        const detail = await queryClient.fetchQuery({
          queryKey:
            phase === 'root'
              ? detailQueryKey
              : [...detailQueryKey, 'detail-page', cursor],
          queryFn: () =>
            getHistoryBatchDetail(projectId, request.scope, request.batchId, { cursor }),
          retry: false,
        })
        const current = historyDetailAuthority(
          enabledRef.current,
          stateRef.current,
          stateRef.current.expandedBatchKey,
          outerGenerationRef.current,
        )
        if (
          token !== detailRequestTokenRef.current ||
          !isCurrentHistoryDetailAuthority(expected, current)
        ) {
          return
        }
        if (phase === 'next') {
          const currentDetail = stateRef.current.batchDetailCache[request.key]
          if (currentDetail === undefined || currentDetail.next_cursor !== cursor) return
          commitState((latest) =>
            storeHistoryBatchDetail(
              latest,
              request.key,
              mergeHistoryBatchDetailPage(currentDetail, detail),
            ),
          )
        } else {
          commitState((latest) => storeHistoryBatchDetail(latest, request.key, detail))
        }
        commitDetailRequest({
          key: request.key,
          status: 'ready',
          error: null,
          phase,
          cursor,
        })
      } catch (error) {
        const current = historyDetailAuthority(
          enabledRef.current,
          stateRef.current,
          stateRef.current.expandedBatchKey,
          outerGenerationRef.current,
        )
        if (
          token !== detailRequestTokenRef.current ||
          !isCurrentHistoryDetailAuthority(expected, current)
        ) {
          return
        }
        commitDetailRequest({
          key: request.key,
          status: 'error',
          error: getApiErrorMessage(error),
          phase,
          cursor,
        })
      }
    },
    [commitDetailRequest, commitState, projectId, queryClient],
  )

  const onFiltersChange = useCallback(
    (filters: HistoryTimelineFilterInput) => {
      const current = stateRef.current
      const next = updateHistoryWorkbenchFilters(current, filters)
      if (next === current) return
      detailRequestTokenRef.current += 1
      commitDetailRequest({
        key: null,
        status: 'idle',
        error: null,
        phase: null,
        cursor: null,
      })
      commitState(() => next)
    },
    [commitDetailRequest, commitState],
  )

  const onScopeChange = useCallback(
    (mode: HistoryWorkbenchMode): boolean => {
      if (mode === 'cell' && stateRef.current.cellScope === null) return false
      if (stateRef.current.mode === mode) return true
      detailRequestTokenRef.current += 1
      commitDetailRequest({
        key: null,
        status: 'idle',
        error: null,
        phase: null,
        cursor: null,
      })
      commitState((current) => ({
        ...current,
        mode,
        expandedBatchKey: mode === 'cell' ? null : current.expandedBatchKey,
      }))
      return true
    },
    [commitDetailRequest, commitState],
  )

  const onModeChange = useCallback(
    (mode: HistoryWorkbenchMode) => {
      onScopeChange(mode)
    },
    [onScopeChange],
  )

  const onLayerScopeChange = useCallback(
    (layerKey: string) => {
      const normalizedLayerKey = layerKey.trim()
      if (normalizedLayerKey.length === 0) return
      detailRequestTokenRef.current += 1
      commitDetailRequest({
        key: null,
        status: 'idle',
        error: null,
        phase: null,
        cursor: null,
      })
      commitState((current) => replaceHistoryLayerScope(current, normalizedLayerKey))
    },
    [commitDetailRequest, commitState],
  )

  const onSelectedCellChange = useCallback(
    (target: { conditionId: string; parameterCode: string } | null): boolean => {
      const scope = target === null ? null : parseHistoryCellScope(target)
      if (target !== null && scope === null) return false
      detailRequestTokenRef.current += 1
      commitDetailRequest({
        key: null,
        status: 'idle',
        error: null,
        phase: null,
        cursor: null,
      })
      commitState((current) => rememberHistoryCellScope(current, scope))
      return true
    },
    [commitDetailRequest, commitState],
  )

  const onBatchToggle = useCallback(
    (item: HistoryTimelineItemOut, shouldRequestDetail: boolean) => {
      if (!enabledRef.current || stateRef.current.mode !== 'timeline') return
      const request = historyBatchDetailRequest(item)
      if (request === null) return
      const opening = stateRef.current.expandedBatchKey !== request.key
      const next = commitState((current) => toggleHistoryBatchDetail(current, request.key))
      if (!opening) {
        detailRequestTokenRef.current += 1
        commitDetailRequest({
          key: null,
          status: 'idle',
          error: null,
          phase: null,
          cursor: null,
        })
        return
      }
      if (next.batchDetailCache[request.key] !== undefined) {
        commitDetailRequest({
          key: request.key,
          status: 'ready',
          error: null,
          phase: 'root',
          cursor: null,
        })
        return
      }
      if (shouldRequestDetail) void requestBatchDetail(item, null)
    },
    [commitDetailRequest, commitState, requestBatchDetail],
  )

  const onRetryBatchDetail = useCallback(
    (item: HistoryTimelineItemOut) => {
      const request = historyBatchDetailRequest(item)
      if (
        request === null ||
        !enabledRef.current ||
        stateRef.current.mode !== 'timeline' ||
        stateRef.current.expandedBatchKey !== request.key
      ) {
        return
      }
      void requestBatchDetail(item, null)
    },
    [requestBatchDetail],
  )

  const onLoadMoreBatchDetail = useCallback(
    (item: HistoryTimelineItemOut, cursor: string | null) => {
      const request = historyBatchDetailRequest(item)
      if (
        request === null ||
        cursor === null ||
        !enabledRef.current ||
        stateRef.current.mode !== 'timeline' ||
        stateRef.current.expandedBatchKey !== request.key ||
        stateRef.current.batchDetailCache[request.key]?.next_cursor !== cursor
      ) {
        return
      }
      void requestBatchDetail(item, cursor)
    },
    [requestBatchDetail],
  )

  const onCellHistoryRequest = useCallback(
    (target: { conditionId: string; parameterCode: string }): boolean => {
      if (!onSelectedCellChange(target)) return false
      return onScopeChange('cell')
    },
    [onScopeChange, onSelectedCellChange],
  )

  const onLoadMoreTimeline = useCallback(
    (_cursor: string | null) => {
      if (!timelineEnabled || !timelineQuery.hasNextPage || timelineQuery.isFetchingNextPage) return
      void timelineQuery.fetchNextPage()
    },
    [
      timelineEnabled,
      timelineQuery.fetchNextPage,
      timelineQuery.hasNextPage,
      timelineQuery.isFetchingNextPage,
    ],
  )
  const onLoadMoreCell = useCallback(
    (_cursor: string | null) => {
      if (!cellEnabled || !cellHistoryQuery.hasNextPage || cellHistoryQuery.isFetchingNextPage) return
      void cellHistoryQuery.fetchNextPage()
    },
    [
      cellEnabled,
      cellHistoryQuery.fetchNextPage,
      cellHistoryQuery.hasNextPage,
      cellHistoryQuery.isFetchingNextPage,
    ],
  )
  const onRetryTimeline = useCallback(() => {
    if (timelineEnabled) void timelineQuery.refetch()
  }, [timelineEnabled, timelineQuery.refetch])
  const onRetryCell = useCallback(() => {
    if (cellEnabled) void cellHistoryQuery.refetch()
  }, [cellEnabled, cellHistoryQuery.refetch])

  const expandedKey = historyState.expandedBatchKey
  const cachedDetail = expandedKey === null ? undefined : historyState.batchDetailCache[expandedKey]
  const batchDetailStatus: HistoryDetailStatus =
    cachedDetail !== undefined
      ? 'ready'
      : detailRequest.key === expandedKey
        ? detailRequest.status
        : 'idle'
  const batchDetailError =
    cachedDetail === undefined &&
    batchDetailStatus === 'error' &&
    detailRequest.key === expandedKey &&
    detailRequest.phase === 'root'
      ? detailRequest.error
      : null
  const batchDetailIsFetchingNextPage =
    cachedDetail !== undefined &&
    detailRequest.key === expandedKey &&
    detailRequest.phase === 'next' &&
    detailRequest.status === 'loading'
  const batchDetailNextPageError =
    cachedDetail !== undefined &&
    detailRequest.key === expandedKey &&
    detailRequest.phase === 'next' &&
    detailRequest.status === 'error'
      ? detailRequest.error
      : null

  return {
    state: historyState,
    coverage: timeline.coverage,
    timelineStatus: timelinePresentation.status,
    timelineError: timelinePresentation.rootError,
    nextPageError: timelinePresentation.nextPageError,
    cellHistory,
    cellStatus: cellPresentation.status,
    cellError: cellPresentation.rootError,
    cellNextPageError: cellPresentation.nextPageError,
    batchDetailStatus,
    batchDetailError,
    batchDetailIsFetchingNextPage,
    batchDetailNextPageError,
    onFiltersChange,
    onModeChange,
    onLayerScopeChange,
    onSelectedCellChange,
    onScopeChange,
    onBatchToggle,
    onRetryBatchDetail,
    onLoadMoreBatchDetail,
    onCellHistoryRequest,
    onLoadMoreTimeline,
    onLoadMoreCell,
    onRetryTimeline,
    onRetryCell,
  }
}

function historyBatchDetailRequest(
  item: HistoryTimelineItemOut,
): HistoryBatchDetailRequest | null {
  if (
    item.kind !== 'batch' ||
    item.detail_status !== 'available' ||
    item.detail_scope === null ||
    item.batch_id === null
  ) {
    return null
  }
  return {
    key: getHistoryTimelineItemKey(item),
    scope: item.detail_scope,
    batchId: item.batch_id,
  }
}

function historyDetailAuthority(
  enabled: boolean,
  state: HistoryWorkbenchState,
  detailKey: string | null,
  outerGeneration: number,
): HistoryDetailAuthority {
  return {
    enabled,
    outerGeneration,
    revision: state.revision,
    mode: state.mode,
    detailKey,
    cellScopeKey:
      state.cellScope === null
        ? null
        : `${state.cellScope.conditionId}::${state.cellScope.parameterCode}`,
  }
}
