import { useCallback, useMemo, useRef, useState } from 'react'
import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import { getApiErrorMessage } from '@/api/client'
import {
  getBackboneDiffCells,
  getBackboneDiffConditions,
  getBackboneDiffRoot,
  isDiffBasisChanged,
  type BackboneDiffCellPageOut,
  type BackboneDiffConditionPageOut,
  type BackboneDiffRootOut,
  type BackboneDiffRootQueryInput,
} from '@/api/backboneDiff'
import {
  backboneDiffBranchQueryKey,
  backboneDiffCellQueryKey,
  backboneDiffRootQueryKey,
  createBackboneDiffCellQueryOptions,
  createBackboneDiffRootQueryOptions,
  createBackboneDiffBranchQueryOptions,
  type BackboneDiffRootQueryOptions,
} from '@/api/backboneDiffQuery'
import { useIsomorphicLayoutEffect } from '@/shared/lib/useIsomorphicLayoutEffect'

import {
  announceBackboneDiffNavigation,
  clearBackboneDiffOpenScopes,
  createBackboneDiffWorkbenchState,
  openBackboneDiffBranch,
  openBackboneDiffCell,
  reduceBackboneDiffWorkbenchState,
  replaceBackboneDiffFilters,
  setBackboneDiffBranchPages,
  setBackboneDiffCellPages,
  setBackboneDiffRootResult,
  type BackboneDiffCellPage,
  type BackboneDiffConditionPage,
  type BackboneDiffWorkbenchMode,
  type BackboneDiffWorkbenchState,
} from './backboneDiffState'

export interface BackboneDiffRootPage {
  readonly items: readonly BackboneDiffRootOut['changed_preview'][number][]
  readonly nextCursor: string | null
}

export interface BackboneDiffWorkbenchController {
  state: BackboneDiffWorkbenchState
  rootStatus: BackboneDiffQueryStatus
  rootError: string | null
  rootNextPageError: string | null
  branchStatus: BackboneDiffQueryStatus
  branchError: string | null
  branchNextPageError: string | null
  cellStatus: BackboneDiffQueryStatus
  cellError: string | null
  cellNextPageError: string | null
  onFiltersChange: (filters: BackboneDiffRootQueryInput) => void
  onOpenBranch: (layerKey: string, scope: string) => void
  onCloseBranch: () => void
  onOpenCell: (layerKey: string, rowRef: string, scope: string) => void
  onCloseCell: () => void
  onModeChange: (mode: BackboneDiffWorkbenchMode) => void
  onLoadMoreConditions: (_cursor: string | null) => void
  onLoadMoreCells: (_cursor: string | null) => void
  onRetryRoot: () => void
  onRetryBranch: () => void
  onRetryCell: () => void
}

export interface BackboneDiffMergedRoot {
  readonly rootItems: readonly BackboneDiffRootOut['changed_preview'][number][]
  readonly counts: BackboneDiffRootOut['counts']
  readonly layerSummaries: BackboneDiffRootOut['layer_summaries']
  readonly nextCursor: string | null
}

export interface BackboneDiffMergedConditionPage {
  readonly pages: readonly BackboneDiffConditionPage[]
  readonly items: readonly BackboneDiffConditionPage['items'][number][]
  readonly nextCursor: string | null
}

export interface BackboneDiffMergedCellPage {
  readonly pages: readonly BackboneDiffCellPage[]
  readonly items: readonly BackboneDiffCellPage['items'][number][]
  readonly nextCursor: string | null
}

export type BackboneDiffQueryStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface BackboneDiffQueryPresentationInput {
  readonly enabled: boolean
  readonly isPending: boolean
  readonly isError: boolean
  readonly isFetchNextPageError: boolean
  readonly error: unknown
}

export interface BackboneDiffQueryPresentation {
  readonly status: BackboneDiffQueryStatus
  readonly rootError: string | null
  readonly nextPageError: string | null
}

type BackboneDiffRootQueryPage = {
  readonly token: number
  readonly result: BackboneDiffRootOut
}

type BackboneDiffConditionQueryPage = {
  readonly token: number
  readonly result: BackboneDiffConditionPageOut
}

type BackboneDiffCellQueryPage = {
  readonly token: number
  readonly result: BackboneDiffCellPageOut
}

type BackboneDiffQueryKey = readonly unknown[]
type BackboneDiffPageParam = string | null

interface BackboneDiffRootAuthority {
  readonly enabled: boolean
  readonly outerGeneration: number
  readonly revision: number
  readonly filterFingerprint: string
  readonly rootBasisToken: number
}

interface BackboneDiffBranchAuthority {
  readonly enabled: boolean
  readonly outerGeneration: number
  readonly revision: number
  readonly mode: BackboneDiffWorkbenchMode
  readonly filterFingerprint: string
  readonly rootScope: string | null
  readonly rootBasisHash: string | null
  readonly layerKey: string | null
  readonly scope: string | null
  readonly rootBasisToken: number
}

interface BackboneDiffCellAuthority {
  readonly enabled: boolean
  readonly outerGeneration: number
  readonly revision: number
  readonly mode: BackboneDiffWorkbenchMode
  readonly filterFingerprint: string
  readonly rootScope: string | null
  readonly rootBasisHash: string | null
  readonly layerKey: string | null
  readonly scope: string | null
  readonly rowRef: string | null
  readonly rootBasisToken: number
}

const BASIS_CHANGED_MESSAGE = '백본 비교 기준이 변경되어 새로고침합니다.'
const BACKBONE_DIFF_BRANCH_QUERY_PREFIX = 'branch'
const BACKBONE_DIFF_CELL_QUERY_PREFIX = 'cell'

export function clearBackboneDiffBranchAndCellQueries(
  queryClient: QueryClient,
  projectId: number,
): void {
  const branchQueryPrefix: unknown[] = ['backboneDiff', projectId, BACKBONE_DIFF_BRANCH_QUERY_PREFIX]
  const cellQueryPrefix: unknown[] = ['backboneDiff', projectId, BACKBONE_DIFF_CELL_QUERY_PREFIX]

  queryClient.cancelQueries({ queryKey: branchQueryPrefix, exact: false })
  queryClient.cancelQueries({ queryKey: cellQueryPrefix, exact: false })
  queryClient.removeQueries({ queryKey: branchQueryPrefix, exact: false })
  queryClient.removeQueries({ queryKey: cellQueryPrefix, exact: false })
}

export function backboneDiffQueryFingerprint(filters: BackboneDiffRootQueryOptions): string {
  return JSON.stringify(filters)
}

export function backboneDiffRootQueryEnabled(enabled: boolean): boolean {
  return enabled
}

export function backboneDiffBranchQueryEnabled(
  enabled: boolean,
  mode: BackboneDiffWorkbenchMode,
  rootScope: string | null,
  rootBasisHash: string | null,
  branchScope: string | null,
): boolean {
  return enabled && mode !== 'root' && rootScope !== null && rootBasisHash !== null && branchScope !== null
}

export function backboneDiffCellQueryEnabled(
  enabled: boolean,
  mode: BackboneDiffWorkbenchMode,
  rootScope: string | null,
  rootBasisHash: string | null,
  cellScope: string | null,
  rowRef: string | null,
): boolean {
  return (
    enabled &&
    mode === 'cell' &&
    rootScope !== null &&
    rootBasisHash !== null &&
    cellScope !== null &&
    rowRef !== null
  )
}

export function mergeBackboneDiffRootPages(pages: readonly BackboneDiffRootOut[]): BackboneDiffMergedRoot {
  const first = pages[0]
  if (first === undefined) {
    return {
      rootItems: [],
      counts: EMPTY_COUNTS,
      layerSummaries: [],
      nextCursor: null,
    }
  }

  return {
    rootItems: first.changed_preview,
    counts: first.counts,
    layerSummaries: first.layer_summaries,
    nextCursor: null,
  }
}

export function mergeBackboneDiffConditionPages(
  pages: readonly BackboneDiffConditionPageOut[],
): BackboneDiffMergedConditionPage {
  const mergedPages = pages.map((page) => ({
    items: page.items,
    nextCursor: page.next_cursor,
  }))

  return {
    pages: mergedPages,
    items: mergedPages.flatMap((page) => page.items),
    nextCursor: mergedPages[mergedPages.length - 1]?.nextCursor ?? null,
  }
}

export function mergeBackboneDiffCellPages(
  pages: readonly BackboneDiffCellPageOut[],
): BackboneDiffMergedCellPage {
  const mergedPages = pages.map((page) => ({
    items: page.items,
    nextCursor: page.next_cursor,
  }))

  return {
    pages: mergedPages,
    items: mergedPages.flatMap((page) => page.items),
    nextCursor: mergedPages[mergedPages.length - 1]?.nextCursor ?? null,
  }
}

export function backboneDiffQueryPresentation(
  input: BackboneDiffQueryPresentationInput,
): BackboneDiffQueryPresentation {
  if (!input.enabled) {
    return { status: 'idle', rootError: null, nextPageError: null }
  }
  if (input.isPending) {
    return { status: 'loading', rootError: null, nextPageError: null }
  }
  if (input.isFetchNextPageError) {
    return { status: 'ready', rootError: null, nextPageError: getApiErrorMessage(input.error) }
  }
  if (input.isError) {
    return { status: 'error', rootError: getApiErrorMessage(input.error), nextPageError: null }
  }
  return { status: 'ready', rootError: null, nextPageError: null }
}

export function shouldHandleDiffBasisChangedQueryError(
  input: {
    error: unknown
    isError: boolean
    failureCount: number
    previousFailureCount: number
  },
): boolean {
  return (
    input.isError &&
    input.failureCount > 0 &&
    input.previousFailureCount !== input.failureCount &&
    isDiffBasisChanged(input.error)
  )
}

export function isBackboneDiffQueryPageCurrent({
  dataToken,
  latestToken,
}: {
  dataToken: number
  latestToken: number
}): boolean {
  return dataToken >= latestToken
}

export function backboneDiffRootAuthority(
  input: {
    enabled: boolean
    outerGeneration: number
    state: BackboneDiffWorkbenchState
    rootBasisToken: number
  },
): BackboneDiffRootAuthority {
  return {
    enabled: input.enabled,
    outerGeneration: input.outerGeneration,
    revision: input.state.revision,
    filterFingerprint: backboneDiffQueryFingerprint(input.state.filters),
    rootBasisToken: input.rootBasisToken,
  }
}

export function isCurrentBackboneDiffRootAuthority(
  expected: BackboneDiffRootAuthority,
  current: BackboneDiffRootAuthority,
): boolean {
  return (
    expected.enabled &&
    current.enabled &&
    expected.outerGeneration === current.outerGeneration &&
    expected.revision === current.revision &&
    expected.filterFingerprint === current.filterFingerprint &&
    expected.rootBasisToken === current.rootBasisToken
  )
}

export function backboneDiffBranchAuthority(
  input: {
    enabled: boolean
    outerGeneration: number
    state: BackboneDiffWorkbenchState
    rootBasisToken: number
  },
): BackboneDiffBranchAuthority {
  return {
    enabled: input.enabled,
    outerGeneration: input.outerGeneration,
    revision: input.state.revision,
    mode: input.state.mode,
    filterFingerprint: backboneDiffQueryFingerprint(input.state.filters),
    rootScope: input.state.rootScope,
    rootBasisHash: input.state.rootBasisHash,
    layerKey: input.state.openLayerKey,
    scope: input.state.branchScope,
    rootBasisToken: input.rootBasisToken,
  }
}

export function isCurrentBackboneDiffBranchAuthority(
  expected: BackboneDiffBranchAuthority,
  current: BackboneDiffBranchAuthority,
): boolean {
  return (
    expected.enabled &&
    current.enabled &&
    expected.outerGeneration === current.outerGeneration &&
    expected.revision === current.revision &&
    (expected.mode === 'branch' || expected.mode === 'cell') &&
    (current.mode === 'branch' || current.mode === 'cell') &&
    expected.filterFingerprint === current.filterFingerprint &&
    expected.rootBasisToken === current.rootBasisToken &&
    expected.rootScope === current.rootScope &&
    expected.rootBasisHash === current.rootBasisHash &&
    expected.layerKey === current.layerKey &&
    expected.scope === current.scope
  )
}

export function backboneDiffCellAuthority(
  input: {
    enabled: boolean
    outerGeneration: number
    state: BackboneDiffWorkbenchState
    rootBasisToken: number
  },
): BackboneDiffCellAuthority {
  return {
    enabled: input.enabled,
    outerGeneration: input.outerGeneration,
    revision: input.state.revision,
    mode: input.state.mode,
    filterFingerprint: backboneDiffQueryFingerprint(input.state.filters),
    rootScope: input.state.rootScope,
    rootBasisHash: input.state.rootBasisHash,
    layerKey: input.state.openLayerKey,
    scope: input.state.openCellScope,
    rowRef: input.state.openCellRowRef,
    rootBasisToken: input.rootBasisToken,
  }
}

export function isCurrentBackboneDiffCellAuthority(
  expected: BackboneDiffCellAuthority,
  current: BackboneDiffCellAuthority,
): boolean {
  return (
    expected.enabled &&
    current.enabled &&
    expected.outerGeneration === current.outerGeneration &&
    expected.revision === current.revision &&
    expected.mode === 'cell' &&
    current.mode === 'cell' &&
    expected.filterFingerprint === current.filterFingerprint &&
    expected.rootBasisToken === current.rootBasisToken &&
    expected.rootScope === current.rootScope &&
    expected.rootBasisHash === current.rootBasisHash &&
    expected.layerKey === current.layerKey &&
    expected.scope === current.scope &&
    expected.rowRef === current.rowRef
  )
}

export function createBackboneDiffWorkbenchRootQueryKey(
  projectId: number,
  filters: BackboneDiffRootQueryInput = {},
): readonly unknown[] {
  return backboneDiffRootQueryKey(projectId, createBackboneDiffRootQueryOptions(filters))
}

export function createBackboneDiffWorkbenchBranchQueryKey(
  projectId: number,
  rootScope: string,
  rootBasisHash: string,
  filters: BackboneDiffRootQueryOptions,
  layerKey: string,
  scope: string,
): readonly unknown[] {
  return [
    ...backboneDiffBranchQueryKey(projectId, layerKey, { scope }),
    {
      rootScope,
      rootBasisHash,
      filters: backboneDiffQueryFingerprint(filters),
    },
  ]
}

export function createBackboneDiffWorkbenchCellQueryKey(
  projectId: number,
  rootScope: string,
  rootBasisHash: string,
  filters: BackboneDiffRootQueryOptions,
  layerKey: string,
  rowRef: string,
  scope: string,
): readonly unknown[] {
  return [
    ...backboneDiffCellQueryKey(projectId, layerKey, rowRef, { scope }),
    {
      rootScope,
      rootBasisHash,
      filters: backboneDiffQueryFingerprint(filters),
    },
  ]
}

export function useBackboneDiffWorkbenchController(
  projectId: number,
  enabled: boolean,
  revision = 0,
): BackboneDiffWorkbenchController {
  const queryClient = useQueryClient()
  const [state, setState] = useState(() => createBackboneDiffWorkbenchState())
  const stateRef = useRef(state)
  const previousEnabledRef = useRef(enabled)
  const previousRevisionRef = useRef(revision)
  const [outerGeneration, setOuterGeneration] = useState(0)
  const rootQueryTokenRef = useRef(0)
  const branchQueryTokenRef = useRef(0)
  const cellQueryTokenRef = useRef(0)
  const branchQueryKeyRef = useRef('')
  const cellQueryKeyRef = useRef('')
  const rootBasisTokenRef = useRef(0)
  const branchBasisFailureCountRef = useRef(0)
  const cellBasisFailureCountRef = useRef(0)

  useIsomorphicLayoutEffect(() => {
    stateRef.current = state
  }, [state])

  const commitState = useCallback(
    (next: (current: BackboneDiffWorkbenchState) => BackboneDiffWorkbenchState) => {
      const current = stateRef.current
      const updated = next(current)
      if (updated === current) return
      stateRef.current = updated
      setState(updated)
    },
    [],
  )

  const handleBasisChanged = useCallback(() => {
    rootBasisTokenRef.current += 1
    setOuterGeneration((current) => current + 1)
    const current = stateRef.current
    const withAnnouncementCleared =
      current.navigationAnnouncement === BASIS_CHANGED_MESSAGE
        ? announceBackboneDiffNavigation(current, null)
        : current
    commitState((_) =>
      announceBackboneDiffNavigation(clearBackboneDiffOpenScopes(withAnnouncementCleared), BASIS_CHANGED_MESSAGE),
    )
    clearBackboneDiffBranchAndCellQueries(queryClient, projectId)
    void queryClient.invalidateQueries({
      queryKey: createBackboneDiffWorkbenchRootQueryKey(projectId, current.filters),
    })
    branchBasisFailureCountRef.current = 0
    cellBasisFailureCountRef.current = 0
  }, [commitState, queryClient, projectId])

  useIsomorphicLayoutEffect(() => {
    const enabledChanged = previousEnabledRef.current !== enabled
    const revisionChanged = previousRevisionRef.current !== revision

    previousEnabledRef.current = enabled
    previousRevisionRef.current = revision

    if (enabledChanged || revisionChanged) {
      setOuterGeneration((current) => current + 1)
      if (!enabled) {
        commitState((current) => {
          const previousAnnouncement = current.navigationAnnouncement
          return previousAnnouncement === null
            ? current
            : announceBackboneDiffNavigation(current, null)
        })
      }
    }

    if (revisionChanged) {
      rootQueryTokenRef.current += 1
    }
  }, [commitState, enabled, revision])

  const rootEnabled = backboneDiffRootQueryEnabled(enabled)
  const normalizedFilters = useMemo(() => createBackboneDiffRootQueryOptions(state.filters), [state.filters])
  const rootAuthority = useMemo(
    () =>
      backboneDiffRootAuthority({
        enabled: rootEnabled,
        outerGeneration: outerGeneration,
        state,
        rootBasisToken: rootBasisTokenRef.current,
      }),
    [state, rootEnabled, outerGeneration],
  )
  const rootQuery = useInfiniteQuery<
    BackboneDiffRootQueryPage,
    Error,
    InfiniteData<BackboneDiffRootQueryPage, BackboneDiffPageParam>,
    BackboneDiffQueryKey,
    BackboneDiffPageParam
  >({
    queryKey: createBackboneDiffWorkbenchRootQueryKey(projectId, normalizedFilters),
    initialPageParam: null as string | null,
    enabled: rootEnabled,
    queryFn: async () => {
      const token = ++rootQueryTokenRef.current
      const current = stateRef.current
      const result = await getBackboneDiffRoot(projectId, current.filters)
      return { token, result }
    },
    getNextPageParam: () => null,
    retry: false,
    select: (data) => {
      const page = data.pages[data.pages.length - 1]
      if (page === undefined) return data
      return {
        ...data,
        pages: [page],
      }
    },
  })

  useIsomorphicLayoutEffect(() => {
    if (!rootQuery.isSuccess || !rootAuthority.enabled) return
    const authority = backboneDiffRootAuthority({
      enabled: rootEnabled,
      outerGeneration,
      state: stateRef.current,
      rootBasisToken: rootBasisTokenRef.current,
    })
    if (!isCurrentBackboneDiffRootAuthority(rootAuthority, authority)) return
    const latest =
      rootQuery.data === undefined ? undefined : rootQuery.data.pages[rootQuery.data.pages.length - 1]
    if (latest === undefined) return
    if (latest.token !== rootQueryTokenRef.current) return

    commitState((current) =>
      setBackboneDiffRootResult(current, {
        scope: latest.result.scope,
        basis_hash: latest.result.basis_hash,
        counts: latest.result.counts,
        layer_summaries: latest.result.layer_summaries,
        changed_preview: latest.result.changed_preview,
      }),
    )
  }, [commitState, rootAuthority, rootEnabled, rootQuery.isSuccess, rootQuery.data])

  const branchEnabled = backboneDiffBranchQueryEnabled(
    enabled,
    state.mode,
    state.rootScope,
    state.rootBasisHash,
    state.branchScope,
  )
  const branchQueryKey = useMemo<readonly unknown[]>(
    () =>
      branchEnabled && state.openLayerKey !== null && state.branchScope !== null && state.rootScope !== null
        ? createBackboneDiffWorkbenchBranchQueryKey(
            projectId,
            state.rootScope,
            state.rootBasisHash ?? '',
            normalizedFilters,
            state.openLayerKey,
            state.branchScope,
          )
        : ['backbone-diff', projectId, 'branch', 'disabled'],
    [
      branchEnabled,
      state.openLayerKey,
      state.branchScope,
      state.rootScope,
      state.rootBasisHash,
      normalizedFilters,
      projectId,
    ],
  )
  const branchQuery = useInfiniteQuery<
    BackboneDiffConditionQueryPage,
    Error,
    InfiniteData<BackboneDiffConditionQueryPage, BackboneDiffPageParam>,
    BackboneDiffQueryKey,
    BackboneDiffPageParam
  >({
    queryKey: branchQueryKey,
    initialPageParam: null as string | null,
    enabled: branchEnabled,
    retry: false,
    queryFn: async ({ pageParam }) => {
      const { rootScope, openLayerKey, branchScope } = stateRef.current
      if (openLayerKey === null || branchScope === null || rootScope === null) {
        throw new TypeError('Backbone diff branch scope is unavailable')
      }
      const normalized = createBackboneDiffBranchQueryOptions({
        scope: branchScope,
        cursor: pageParam,
      })
      const result = await getBackboneDiffConditions(
        projectId,
        openLayerKey,
        normalized,
      )
      return { token: ++branchQueryTokenRef.current, result }
    },
    getNextPageParam: (page) => page.result.next_cursor,
  })

  const branchQueryKeyFingerprint = JSON.stringify(branchQueryKey)

  useIsomorphicLayoutEffect(() => {
    if (branchQueryKeyRef.current !== branchQueryKeyFingerprint) {
      branchQueryTokenRef.current = 0
      branchQueryKeyRef.current = branchQueryKeyFingerprint
    }
  }, [branchQueryKeyFingerprint])

  useIsomorphicLayoutEffect(() => {
    if (
      !shouldHandleDiffBasisChangedQueryError({
        error: branchQuery.error,
        isError: branchQuery.isError,
        failureCount: branchQuery.failureCount,
        previousFailureCount: branchBasisFailureCountRef.current,
      })
    ) {
      return
    }
    branchBasisFailureCountRef.current = branchQuery.failureCount
    const current = stateRef.current
    if (current.mode === 'branch' || current.mode === 'cell') {
      handleBasisChanged()
    }
  }, [branchQuery.error, branchQuery.failureCount, branchQuery.isError, handleBasisChanged])

  const branchAuthority = useMemo(
    () =>
      branchEnabled
        ? backboneDiffBranchAuthority({
            enabled: branchEnabled,
            outerGeneration: outerGeneration,
            state,
            rootBasisToken: rootBasisTokenRef.current,
          })
        : null,
    [branchEnabled, state, outerGeneration],
  )

  const mergedBranch = useMemo(
    () => mergeBackboneDiffConditionPages(branchQuery.data?.pages.map((entry) => entry.result) ?? []),
    [branchQuery.data?.pages],
  )

  useIsomorphicLayoutEffect(() => {
    if (!branchQuery.isSuccess || branchAuthority === null) return
    const latest = branchQuery.data?.pages[branchQuery.data.pages.length - 1]
    if (latest === undefined) return
    const authority = backboneDiffBranchAuthority({
      enabled: branchEnabled,
      outerGeneration,
      state: stateRef.current,
      rootBasisToken: rootBasisTokenRef.current,
    })
    if (!isCurrentBackboneDiffBranchAuthority(branchAuthority, authority)) return
    if (!isBackboneDiffQueryPageCurrent({
      dataToken: latest.token,
      latestToken: branchQueryTokenRef.current,
    })) return

    commitState((current) =>
      setBackboneDiffBranchPages(current, mergedBranch.pages, mergedBranch.nextCursor),
    )
  }, [branchAuthority, branchEnabled, branchQuery.data, branchQuery.isSuccess, commitState, mergedBranch])

  const cellEnabled = backboneDiffCellQueryEnabled(
    enabled,
    state.mode,
    state.rootScope,
    state.rootBasisHash,
    state.openCellScope,
    state.openCellRowRef,
  )
  const cellQueryKey = useMemo<readonly unknown[]>(
    () =>
      cellEnabled &&
      state.openLayerKey !== null &&
      state.openCellRowRef !== null &&
      state.openCellScope !== null &&
      state.rootScope !== null
        ? createBackboneDiffWorkbenchCellQueryKey(
            projectId,
            state.rootScope,
            state.rootBasisHash ?? '',
            normalizedFilters,
            state.openLayerKey,
            state.openCellRowRef,
            state.openCellScope,
          )
        : ['backbone-diff', projectId, 'cell', 'disabled'],
    [
      cellEnabled,
      state.openLayerKey,
      state.openCellRowRef,
      state.openCellScope,
      state.rootScope,
      state.rootBasisHash,
      normalizedFilters,
      projectId,
    ],
  )
  const cellQuery = useInfiniteQuery<
    BackboneDiffCellQueryPage,
    Error,
    InfiniteData<BackboneDiffCellQueryPage, BackboneDiffPageParam>,
    BackboneDiffQueryKey,
    BackboneDiffPageParam
  >({
    queryKey: cellQueryKey,
    initialPageParam: null as string | null,
    enabled: cellEnabled,
    retry: false,
    queryFn: async ({ pageParam }) => {
      const { openLayerKey, openCellRowRef, openCellScope, rootScope } = stateRef.current
      if (
        openLayerKey === null ||
        openCellRowRef === null ||
        openCellScope === null ||
        rootScope === null
      ) {
        throw new TypeError('Backbone diff cell scope is unavailable')
      }

      const normalized = createBackboneDiffCellQueryOptions({
        scope: openCellScope,
        cursor: pageParam,
      })
      const result = await getBackboneDiffCells(
        projectId,
        openLayerKey,
        openCellRowRef,
        normalized,
      )
      return { token: ++cellQueryTokenRef.current, result }
    },
    getNextPageParam: (page) => page.result.next_cursor,
  })

  const cellQueryKeyFingerprint = JSON.stringify(cellQueryKey)

  useIsomorphicLayoutEffect(() => {
    if (cellQueryKeyRef.current !== cellQueryKeyFingerprint) {
      cellQueryTokenRef.current = 0
      cellQueryKeyRef.current = cellQueryKeyFingerprint
    }
  }, [cellQueryKeyFingerprint])

  useIsomorphicLayoutEffect(() => {
    if (
      !shouldHandleDiffBasisChangedQueryError({
        error: cellQuery.error,
        isError: cellQuery.isError,
        failureCount: cellQuery.failureCount,
        previousFailureCount: cellBasisFailureCountRef.current,
      })
    ) {
      return
    }
    cellBasisFailureCountRef.current = cellQuery.failureCount
    if (stateRef.current.mode === 'cell') {
      handleBasisChanged()
    }
  }, [cellQuery.error, cellQuery.failureCount, cellQuery.isError, handleBasisChanged])

  const cellAuthority = useMemo(
    () =>
      cellEnabled
        ? backboneDiffCellAuthority({
            enabled: cellEnabled,
            outerGeneration: outerGeneration,
            state,
            rootBasisToken: rootBasisTokenRef.current,
          })
        : null,
    [cellEnabled, state, outerGeneration],
  )

  const mergedCell = useMemo(
    () => mergeBackboneDiffCellPages(cellQuery.data?.pages.map((entry) => entry.result) ?? []),
    [cellQuery.data?.pages],
  )

  useIsomorphicLayoutEffect(() => {
    if (!cellQuery.isSuccess || cellAuthority === null) return
    const latest = cellQuery.data?.pages[cellQuery.data.pages.length - 1]
    if (latest === undefined) return
    const authority = backboneDiffCellAuthority({
      enabled: cellEnabled,
      outerGeneration: outerGeneration,
      state: stateRef.current,
      rootBasisToken: rootBasisTokenRef.current,
    })
    if (!isCurrentBackboneDiffCellAuthority(cellAuthority, authority)) return
    if (!isBackboneDiffQueryPageCurrent({
      dataToken: latest.token,
      latestToken: cellQueryTokenRef.current,
    })) return

    commitState((current) => setBackboneDiffCellPages(current, mergedCell.pages, mergedCell.nextCursor))
  }, [cellAuthority, cellEnabled, cellQuery.data, cellQuery.isSuccess, commitState, mergedCell])

  const branchPresentation = backboneDiffQueryPresentation({
    enabled: branchEnabled,
    isPending: branchQuery.isPending,
    isError: branchQuery.isError,
    isFetchNextPageError: branchQuery.isFetchNextPageError,
    error: branchQuery.error,
  })
  const cellPresentation = backboneDiffQueryPresentation({
    enabled: cellEnabled,
    isPending: cellQuery.isPending,
    isError: cellQuery.isError,
    isFetchNextPageError: cellQuery.isFetchNextPageError,
    error: cellQuery.error,
  })
  const rootPresentation = backboneDiffQueryPresentation({
    enabled: rootEnabled,
    isPending: rootQuery.isPending,
    isError: rootQuery.isError,
    isFetchNextPageError: rootQuery.isFetchNextPageError,
    error: rootQuery.error,
  })

  const onFiltersChange = useCallback(
    (filters: BackboneDiffRootQueryInput) => {
      const next = replaceBackboneDiffFilters(stateRef.current, filters)
      if (next === stateRef.current) return
      commitState(() => next)
      rootQueryTokenRef.current += 1
    },
    [commitState],
  )

  const onModeChange = useCallback(
    (mode: BackboneDiffWorkbenchMode) => {
      if (mode === stateRef.current.mode) return
      commitState((current) => {
        if (mode === 'root') return clearBackboneDiffOpenScopes(current)
        return {
          ...current,
          mode,
          navigationAnnouncement: null,
        }
      })
    },
    [commitState],
  )

  const onOpenBranch = useCallback(
    (layerKey: string, scope: string) => {
      commitState((current) => openBackboneDiffBranch(current, layerKey, scope))
    },
    [commitState],
  )

  const onCloseBranch = useCallback(() => {
    commitState((current) => {
      if (current.mode !== 'branch') return current
      return reduceBackboneDiffWorkbenchState(current, { type: 'close-branch' })
    })
  }, [commitState])

  const onOpenCell = useCallback(
    (layerKey: string, rowRef: string, scope: string) => {
      commitState((current) => openBackboneDiffCell(current, layerKey, rowRef, scope))
    },
    [commitState],
  )

  const onCloseCell = useCallback(() => {
    commitState((current) => {
      if (current.mode !== 'cell') return current
      return reduceBackboneDiffWorkbenchState(current, { type: 'close-cell' })
    })
  }, [commitState])

  const onLoadMoreConditions = useCallback(
    (_cursor: string | null = null) => {
      if (
        !branchEnabled ||
        !branchQuery.hasNextPage ||
        branchQuery.isFetchingNextPage ||
        branchQuery.fetchStatus === 'fetching'
      ) {
        return
      }
      void branchQuery.fetchNextPage()
    },
    [branchEnabled, branchQuery],
  )

  const onLoadMoreCells = useCallback(
    (_cursor: string | null = null) => {
      if (
        !cellEnabled ||
        !cellQuery.hasNextPage ||
        cellQuery.isFetchingNextPage ||
        cellQuery.fetchStatus === 'fetching'
      ) {
        return
      }
      void cellQuery.fetchNextPage()
    },
    [cellEnabled, cellQuery],
  )

  const onRetryRoot = useCallback(() => {
    if (rootEnabled) {
      rootQueryTokenRef.current += 1
      void rootQuery.refetch()
    }
  }, [rootEnabled, rootQuery])

  const onRetryBranch = useCallback(() => {
    if (branchEnabled) {
      branchQueryTokenRef.current += 1
      void branchQuery.refetch()
    }
  }, [branchEnabled, branchQuery])

  const onRetryCell = useCallback(() => {
    if (cellEnabled) {
      cellQueryTokenRef.current += 1
      void cellQuery.refetch()
    }
  }, [cellEnabled, cellQuery])

  return {
    state,
    rootStatus: rootPresentation.status,
    rootError: rootPresentation.rootError,
    rootNextPageError: rootPresentation.nextPageError,
    branchStatus: branchPresentation.status,
    branchError: branchPresentation.rootError,
    branchNextPageError: branchPresentation.nextPageError,
    cellStatus: cellPresentation.status,
    cellError: cellPresentation.rootError,
    cellNextPageError: cellPresentation.nextPageError,
    onFiltersChange,
    onOpenBranch,
    onCloseBranch,
    onOpenCell,
    onCloseCell,
    onModeChange,
    onLoadMoreConditions,
    onLoadMoreCells,
    onRetryRoot,
    onRetryBranch,
    onRetryCell,
  }
}

const EMPTY_COUNTS = {
  layer_count: 0,
  available_layer_count: 0,
  unavailable_layer_count: 0,
  row_count: 0,
  cell_count: 0,
  full_row_count: 0,
  full_cell_count: 0,
  ambiguous_lineage_count: 0,
  added_count: 0,
  changed_count: 0,
  cleared_count: 0,
  removed_count: 0,
  unchanged_count: 0,
}
