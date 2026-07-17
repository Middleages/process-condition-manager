import { QueryClient, onlineManager } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  backboneDiffBranchQueryKey,
  backboneDiffCellQueryKey,
  backboneDiffRootQueryKey,
  type BackboneDiffRootQueryOptions,
} from '@/api/backboneDiffQuery'
import type {
  BackboneDiffConditionPageOut,
  BackboneDiffCellPageOut,
  BackboneDiffRootOut,
} from '@/api/backboneDiff'

import {
  backboneDiffBranchAuthority,
  backboneDiffBranchQueryEnabled,
  backboneDiffCellAuthority,
  backboneDiffCellQueryEnabled,
  backboneDiffQueryFingerprint,
  backboneDiffQueryPresentation,
  backboneDiffRootAuthority,
  backboneDiffRootQueryEnabled,
  createBackboneDiffWorkbenchBranchQueryKey,
  createBackboneDiffWorkbenchCellQueryKey,
  createBackboneDiffWorkbenchRootQueryKey,
  isCurrentBackboneDiffBranchAuthority,
  isCurrentBackboneDiffCellAuthority,
  isCurrentBackboneDiffRootAuthority,
  isBackboneDiffQueryPageCurrent,
  mergeBackboneDiffConditionPages,
  mergeBackboneDiffCellPages,
  mergeBackboneDiffRootPages,
  clearBackboneDiffBranchAndCellQueries,
  parseBackboneDiffWorkbenchBranchQueryKey,
  parseBackboneDiffWorkbenchCellQueryKey,
  parseBackboneDiffWorkbenchRootQueryKey,
  shouldHandleDiffBasisChangedQueryError,
  shouldHandleDiffBasisChangedQueryErrorWithAuthority,
} from './useBackboneDiffWorkbenchController'
import {
  announceBackboneDiffNavigation,
  createBackboneDiffWorkbenchState,
  type BackboneDiffWorkbenchMode,
  type BackboneDiffWorkbenchState,
} from './backboneDiffState'

describe('useBackboneDiffWorkbenchController seams', () => {
  it('gates root/branch/cell queries by mode and outer enabled flag', () => {
    expect(backboneDiffRootQueryEnabled(false)).toBe(false)
    expect(backboneDiffRootQueryEnabled(true)).toBe(true)

    expect(backboneDiffBranchQueryEnabled(false, 'root', 'r', 'b', 's')).toBe(false)
    expect(backboneDiffBranchQueryEnabled(true, 'root', 'r', 'b', 's')).toBe(false)
    expect(backboneDiffBranchQueryEnabled(true, 'branch', 'r', 'b', 's')).toBe(true)
    expect(backboneDiffBranchQueryEnabled(true, 'cell', 'r', 'b', 's')).toBe(true)

    expect(backboneDiffCellQueryEnabled(false, 'cell', 'r', 'b', 's', 'r')).toBe(false)
    expect(backboneDiffCellQueryEnabled(true, 'branch', 'r', 'b', 's', 'r')).toBe(false)
    expect(backboneDiffCellQueryEnabled(true, 'cell', 'r', 'b', 's', 'r')).toBe(true)
  })

  it('merges paginated payloads while preserving page order', () => {
    const root = mergeBackboneDiffRootPages([
      createRootOut('scope-a', 'hash-a', [{
        item_kind: 'cell',
        classification: 'added',
        layer_key: 'L1',
        effective_condition_index: 1,
        item_sort_key: [1],
        status_rank: 1,
        row_ref: 'R1',
        cell_scope: null,
        row_status: 'added',
        parameter_code: null,
      }]),
      createRootOut('scope-b', 'hash-b', [{
        item_kind: 'cell',
        classification: 'added',
        layer_key: 'L2',
        effective_condition_index: 2,
        item_sort_key: [2],
        status_rank: 2,
        row_ref: 'R2',
        cell_scope: null,
        row_status: 'added',
        parameter_code: null,
      }]),
    ])
    const branch = mergeBackboneDiffConditionPages([createConditionPage('R1'), createConditionPage('R2')])
    const cell = mergeBackboneDiffCellPages([createCellPage('P1'), createCellPage('P2')])

    expect(root.rootItems).toHaveLength(1)
    expect(root.rootItems[0]?.row_ref).toBe('R1')
    expect(root.nextCursor).toBeNull()
    expect(branch.pages).toHaveLength(2)
    expect(branch.items.map((item) => item.row_ref)).toEqual(['R1', 'R2'])
    expect(branch.nextCursor).toBeNull()
    expect(cell.pages).toHaveLength(2)
    expect(cell.items.map((item) => item.parameter_code)).toEqual(['P1', 'P2'])
    expect(cell.nextCursor).toBeNull()
  })

  it('enriches branch/cell query keys with full root basis/filter identity', () => {
    const filters: BackboneDiffRootQueryOptions = {
      classification: ['added'],
      layerKey: 'L1::10::ETCH',
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
      previewLimit: 20,
    }
    const branchKey = createBackboneDiffWorkbenchBranchQueryKey(
      7,
      'root-s',
      'hash-1',
      filters,
      'L1::10::ETCH',
      'scope-x',
    )
    const cellKey = createBackboneDiffWorkbenchCellQueryKey(
      7,
      'root-s',
      'hash-1',
      filters,
      'L1::10::ETCH',
      'R1',
      'scope-x',
    )

    expect((branchKey[4] as { scope: string }).scope).toBe('scope-x')
    expect((branchKey[5] as { rootScope: string }).rootScope).toBe('root-s')
    expect((cellKey[6] as { filters: string }).filters).toBe(backboneDiffQueryFingerprint(filters))

    const rootKey = createBackboneDiffWorkbenchRootQueryKey(7, filters)
    expect(rootKey[3]).toEqual({
      classification: ['added'],
      layerKey: 'L1::10::ETCH',
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
      previewLimit: 20,
    })
  })

  it('rejects stale authorities when revision/generation/token/context changes', () => {
    const baseState = makeWorkbenchState({
      mode: 'branch',
      rootBasisHash: 'hash-1',
      rootScope: 'root-s',
      openLayerKey: 'L1::10::ETCH',
      branchScope: 'scope-x',
      openCellScope: null,
      openCellRowRef: null,
      revision: 3,
    })

    const branchAuthority = makeBranchAuthority(baseState, 7, 1)
    const cellState = makeWorkbenchState({
      ...baseState,
      mode: 'cell',
      openCellScope: 'scope-x',
      openCellRowRef: 'R1',
    })
    const cellAuthority = makeCellAuthority(cellState, 7, 1)
    const rootAuthority = makeRootAuthority(baseState, 7, 1)

    expect(isCurrentBackboneDiffBranchAuthority(branchAuthority, branchAuthority)).toBe(true)
    expect(isCurrentBackboneDiffBranchAuthority(branchAuthority, { ...branchAuthority, revision: 4 })).toBe(false)

    const cellModeBranchAuthority = makeBranchAuthority(
      makeWorkbenchState({
        ...baseState,
        mode: 'cell',
        openCellScope: 'scope-x',
        openCellRowRef: 'R1',
      }),
      7,
      1,
    )

    expect(isCurrentBackboneDiffBranchAuthority(cellModeBranchAuthority, cellModeBranchAuthority)).toBe(true)

    expect(isCurrentBackboneDiffCellAuthority(cellAuthority, cellAuthority)).toBe(true)
    expect(isCurrentBackboneDiffCellAuthority(cellAuthority, { ...cellAuthority, rootBasisToken: 2 })).toBe(false)

    expect(isCurrentBackboneDiffRootAuthority(rootAuthority, rootAuthority)).toBe(true)
    expect(isCurrentBackboneDiffRootAuthority(rootAuthority, { ...rootAuthority, rootBasisToken: 2 })).toBe(false)
  })

  it('maps loading/error/next-page transitions for query presentation', () => {
    expect(
      backboneDiffQueryPresentation({
        enabled: true,
        isPending: true,
        isError: false,
        isFetchNextPageError: false,
        error: null,
      }),
    ).toEqual({ status: 'loading', rootError: null, nextPageError: null })
    expect(
      backboneDiffQueryPresentation({
        enabled: true,
        isPending: false,
        isError: true,
        isFetchNextPageError: false,
        error: new Error('failed'),
      }),
    ).toEqual({ status: 'error', rootError: 'failed', nextPageError: null })
    expect(
      backboneDiffQueryPresentation({
        enabled: true,
        isPending: false,
        isError: false,
        isFetchNextPageError: true,
        error: new Error('next-failed'),
      }),
    ).toEqual({ status: 'ready', rootError: null, nextPageError: 'next-failed' })
    expect(
      backboneDiffQueryPresentation({
        enabled: false,
        isPending: true,
        isError: false,
        isFetchNextPageError: false,
        error: null,
      }),
    ).toEqual({ status: 'idle', rootError: null, nextPageError: null })
  })

  it('keeps root query pages per-key and fences stale data while allowing A-B-A cache reuse', () => {
    const rootA = createBackboneDiffWorkbenchRootQueryKey(7, {
      previewLimit: 20,
      classification: ['added'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })
    const rootB = createBackboneDiffWorkbenchRootQueryKey(7, {
      previewLimit: 20,
      classification: ['removed'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })
    const latestTokenByKey: Record<string, number> = {
      [JSON.stringify(rootA)]: 0,
      [JSON.stringify(rootB)]: 0,
    }

    expect(
      isBackboneDiffQueryPageCurrent({
        dataToken: 3,
        latestToken: latestTokenByKey[JSON.stringify(rootA)] ?? 0,
      }),
    ).toBe(true)
    latestTokenByKey[JSON.stringify(rootA)] = 3

    expect(
      isBackboneDiffQueryPageCurrent({
        dataToken: 4,
        latestToken: latestTokenByKey[JSON.stringify(rootB)] ?? 0,
      }),
    ).toBe(true)
    latestTokenByKey[JSON.stringify(rootB)] = 4

    expect(
      isBackboneDiffQueryPageCurrent({
        dataToken: 3,
        latestToken: latestTokenByKey[JSON.stringify(rootA)] ?? 0,
      }),
    ).toBe(true)

    latestTokenByKey[JSON.stringify(rootA)] = 6
    expect(
      isBackboneDiffQueryPageCurrent({
        dataToken: 3,
        latestToken: latestTokenByKey[JSON.stringify(rootA)] ?? 0,
      }),
    ).toBe(false)
    expect(
      isBackboneDiffQueryPageCurrent({
        dataToken: 7,
        latestToken: latestTokenByKey[JSON.stringify(rootA)] ?? 0,
      }),
    ).toBe(true)

    latestTokenByKey[JSON.stringify(rootA)] += 1
    expect(
      isBackboneDiffQueryPageCurrent({
        dataToken: latestTokenByKey[JSON.stringify(rootA)] - 1,
        latestToken: latestTokenByKey[JSON.stringify(rootA)] ?? 0,
      }),
    ).toBe(false)
    expect(
      isBackboneDiffQueryPageCurrent({
        dataToken: latestTokenByKey[JSON.stringify(rootA)] + 1,
        latestToken: latestTokenByKey[JSON.stringify(rootA)] ?? 0,
      }),
    ).toBe(true)
  })

  it('seeds remount root token authority from cached root token so first fresh response is accepted', () => {
    const projectId = 7
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 30_000 },
      },
    })

    const rootKey = createBackboneDiffWorkbenchRootQueryKey(projectId, {
      previewLimit: 20,
      classification: ['added'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })
    const queryFingerprint = JSON.stringify(rootKey)

    const cachedToken = 7
    queryClient.setQueryData(rootKey, {
      pages: [
        {
          token: cachedToken,
          result: createRootOut('scope-cached', 'hash-cached'),
        },
      ],
      pageParams: [null],
    })

    const acceptedByKey: Record<string, number> = {}

    // Simulate initial remount: controller-local token refs start from zero even though cache is warm.
    let localToken = 0
    const cachedQueryData =
      (queryClient.getQueryData(rootKey) as {
        pages: { token: number; result: BackboneDiffRootOut }[]
      } | undefined) ?? { pages: [] }
    const tokenFromCache = cachedQueryData.pages[cachedQueryData.pages.length - 1]?.token ?? 0
    expect(isBackboneDiffQueryPageCurrent({ dataToken: tokenFromCache, latestToken: 0 })).toBe(true)
    acceptedByKey[queryFingerprint] = tokenFromCache

    // Old logic after remount (token ref reset to 0) would reject the first fresh token.
    expect(
      isBackboneDiffQueryPageCurrent({
        dataToken: 1,
        latestToken: acceptedByKey[queryFingerprint] ?? 0,
      }),
    ).toBe(false)

    // A same-QueryClient remount should treat cached token as authoritative state.
    const seededToken = Math.max(acceptedByKey[queryFingerprint] ?? 0, tokenFromCache)
    localToken = Math.max(localToken, seededToken)
    const freshToken = ++localToken

    expect(seededToken).toBe(7)
    expect(freshToken).toBe(8)

    queryClient.setQueryData(rootKey, {
      pages: [{ token: freshToken, result: createRootOut('scope-fresh', 'hash-fresh') }],
      pageParams: [null],
    })

    const latestFromCache =
      queryClient.getQueryData(rootKey) as { pages: { token: number }[] } | undefined
    const latestFromCacheToken = latestFromCache?.pages[latestFromCache?.pages.length - 1]?.token ?? 0

    expect(
      isBackboneDiffQueryPageCurrent({
        dataToken: latestFromCacheToken,
        latestToken: acceptedByKey[queryFingerprint] ?? 0,
      }),
    ).toBe(true)

    const latestToken = latestFromCacheToken
    acceptedByKey[queryFingerprint] = latestToken

    expect(acceptedByKey[queryFingerprint]).toBeGreaterThan(tokenFromCache)
    expect(acceptedByKey[queryFingerprint]).toBe( freshToken)
  })

  it('binds root/branch/cell requests to immutable query-key descriptors after offline resume', async () => {
    const projectId = 7
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    })
    queryClient.mount()

    const rootA = createBackboneDiffWorkbenchRootQueryKey(projectId, {
      previewLimit: 20,
      classification: ['added'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })
    const rootB = createBackboneDiffWorkbenchRootQueryKey(projectId, {
      previewLimit: 20,
      classification: ['removed'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })
    const branchA = createBackboneDiffWorkbenchBranchQueryKey(
      projectId,
      'root-a',
      'hash-a',
      {
        classification: ['added'],
        layerKey: null,
        categoryCode: null,
        parameterCode: null,
        includeUnchanged: false,
        previewLimit: 20,
      },
      'L1::10::ETCH',
      'scope-a',
    )
    const branchB = createBackboneDiffWorkbenchBranchQueryKey(
      projectId,
      'root-b',
      'hash-b',
      {
        classification: ['removed'],
        layerKey: null,
        categoryCode: null,
        parameterCode: null,
        includeUnchanged: false,
        previewLimit: 20,
      },
      'L1::10::ETCH',
      'scope-b',
    )
    const cellA = createBackboneDiffWorkbenchCellQueryKey(
      projectId,
      'root-a',
      'hash-a',
      {
        classification: ['added'],
        layerKey: null,
        categoryCode: null,
        parameterCode: null,
        includeUnchanged: false,
        previewLimit: 20,
      },
      'L1::10::ETCH',
      'R-1',
      'scope-a',
    )
    const cellB = createBackboneDiffWorkbenchCellQueryKey(
      projectId,
      'root-b',
      'hash-b',
      {
        classification: ['removed'],
        layerKey: null,
        categoryCode: null,
        parameterCode: null,
        includeUnchanged: false,
        previewLimit: 20,
      },
      'L1::10::ETCH',
      'R-2',
      'scope-b',
    )
    const rootAResult = deferred<BackboneDiffRootOut>()
    const rootBResult = deferred<BackboneDiffRootOut>()
    const branchAResult = deferred<BackboneDiffConditionPageOut>()
    const branchBResult = deferred<BackboneDiffConditionPageOut>()
    const cellAResult = deferred<BackboneDiffCellPageOut>()
    const cellBResult = deferred<BackboneDiffCellPageOut>()
    const onlineState = onlineManager.isOnline()
    const rootCalls: string[] = []
    const branchCalls: string[] = []
    const cellCalls: string[] = []

    const rootQueryFn = vi.fn(async ({ queryKey }) => {
      const descriptor = parseBackboneDiffWorkbenchRootQueryKey(queryKey)
      const branch = descriptor.queryOptions.classification.join(',')
      rootCalls.push(branch)
      if (branch === 'added') {
        const result = await rootAResult.promise
        return { token: rootCalls.filter((value) => value === 'added').length, result }
      }
      if (branch === 'removed') {
        const result = await rootBResult.promise
        return { token: rootCalls.filter((value) => value === 'removed').length, result }
      }
      throw new Error(`Unexpected root classification ${branch}`)
    })
    const branchQueryFn = vi.fn(async ({ queryKey }) => {
      const descriptor = parseBackboneDiffWorkbenchBranchQueryKey(queryKey)
      branchCalls.push(descriptor.scope)
      if (descriptor.scope === 'scope-a') {
        const result = await branchAResult.promise
        return { token: branchCalls.filter((value) => value === 'scope-a').length, result }
      }
      if (descriptor.scope === 'scope-b') {
        const result = await branchBResult.promise
        return { token: branchCalls.filter((value) => value === 'scope-b').length, result }
      }
      throw new Error(`Unexpected branch scope ${descriptor.scope}`)
    })
    const cellQueryFn = vi.fn(async ({ queryKey }) => {
      const descriptor = parseBackboneDiffWorkbenchCellQueryKey(queryKey)
      cellCalls.push(`${descriptor.rowRef}/${descriptor.scope}`)
      if (descriptor.rowRef === 'R-1' && descriptor.scope === 'scope-a') {
        const result = await cellAResult.promise
        return { token: cellCalls.filter((value) => value === 'R-1/scope-a').length, result }
      }
      if (descriptor.rowRef === 'R-2' && descriptor.scope === 'scope-b') {
        const result = await cellBResult.promise
        return { token: cellCalls.filter((value) => value === 'R-2/scope-b').length, result }
      }
      throw new Error(`Unexpected cell descriptor ${descriptor.rowRef}/${descriptor.scope}`)
    })

    try {
      onlineManager.setOnline(false)

      const rootRequestA = queryClient.fetchInfiniteQuery({
        queryKey: rootA,
        queryFn: rootQueryFn,
        initialPageParam: null as string | null,
      })
      const rootRequestB = queryClient.fetchInfiniteQuery({
        queryKey: rootB,
        queryFn: rootQueryFn,
        initialPageParam: null as string | null,
      })
      const branchRequestA = queryClient.fetchInfiniteQuery({
        queryKey: branchA,
        queryFn: branchQueryFn,
        initialPageParam: null as string | null,
      })
      const branchRequestB = queryClient.fetchInfiniteQuery({
        queryKey: branchB,
        queryFn: branchQueryFn,
        initialPageParam: null as string | null,
      })
      const cellRequestA = queryClient.fetchInfiniteQuery({
        queryKey: cellA,
        queryFn: cellQueryFn,
        initialPageParam: null as string | null,
      })
      const cellRequestB = queryClient.fetchInfiniteQuery({
        queryKey: cellB,
        queryFn: cellQueryFn,
        initialPageParam: null as string | null,
      })

      await Promise.resolve()

      expect(rootQueryFn).toHaveBeenCalledTimes(0)
      expect(branchQueryFn).toHaveBeenCalledTimes(0)
      expect(cellQueryFn).toHaveBeenCalledTimes(0)

      onlineManager.setOnline(true)

      await Promise.resolve()

      await vi.waitFor(() => {
        expect(rootCalls).toEqual(expect.arrayContaining(['added', 'removed']))
        expect(branchCalls).toEqual(expect.arrayContaining(['scope-a', 'scope-b']))
        expect(cellCalls).toEqual(expect.arrayContaining(['R-1/scope-a', 'R-2/scope-b']))
      })

      rootAResult.resolve(createRootOut('scope-a', 'hash-a'))
      rootBResult.resolve(createRootOut('scope-b', 'hash-b'))
      branchAResult.resolve(createConditionPage('R-a-1'))
      branchBResult.resolve(createConditionPage('R-b-1'))
      cellAResult.resolve(createCellPage('P-a-1'))
      cellBResult.resolve(createCellPage('P-b-1'))

      const rootAData = await rootRequestA
      const rootBData = await rootRequestB
      const branchAData = await branchRequestA
      const branchBData = await branchRequestB
      const cellAData = await cellRequestA
      const cellBData = await cellRequestB

      expect(rootAData.pages[0]?.result.scope).toBe('scope-a')
      expect(rootBData.pages[0]?.result.scope).toBe('scope-b')
      expect(branchAData.pages[0]?.result.scope).toBe('scope-x')
      expect(branchBData.pages[0]?.result.scope).toBe('scope-x')
      expect(cellAData.pages[0]?.result.row_ref).toBe('R1')
      expect(cellBData.pages[0]?.result.row_ref).toBe('R1')

      expect(queryClient.getQueryData(rootA)).toEqual(rootAData)
      expect(queryClient.getQueryData(rootB)).toEqual(rootBData)
      expect(queryClient.getQueryData(branchA)).toEqual(branchAData)
      expect(queryClient.getQueryData(branchB)).toEqual(branchBData)
      expect(queryClient.getQueryData(cellA)).toEqual(cellAData)
      expect(queryClient.getQueryData(cellB)).toEqual(cellBData)
    } finally {
      onlineManager.setOnline(onlineState)
      queryClient.clear()
      queryClient.unmount()
    }
  })

  it('requires explicit announcement clear before emitting the same refresh message again', () => {
    const baseline = createBackboneDiffWorkbenchState()
    const announced = announceBackboneDiffNavigation(baseline, '백본 비교 기준이 변경되어 새로고침합니다.')
    const unchanged = announceBackboneDiffNavigation(
      announced,
      '백본 비교 기준이 변경되어 새로고침합니다.',
    )
    expect(unchanged).toBe(announced)

    const cleared = announceBackboneDiffNavigation(announced, null)
    const reannounced = announceBackboneDiffNavigation(
      cleared,
      '백본 비교 기준이 변경되어 새로고침합니다.',
    )
    expect(reannounced.navigationAnnouncement).toBe('백본 비교 기준이 변경되어 새로고침합니다.')
  })

  it('only handles basis-change errors once per observed failure count and only after reset', () => {
    const basisError = {
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          code: 'diff_basis_changed',
        },
      },
    } as const

    expect(
      shouldHandleDiffBasisChangedQueryError({
        error: basisError,
        isError: true,
        failureCount: 1,
        previousFailureCount: 0,
      }),
    ).toBe(true)

    expect(
      shouldHandleDiffBasisChangedQueryError({
        error: basisError,
        isError: true,
        failureCount: 1,
        previousFailureCount: 1,
      }),
    ).toBe(false)

    const nonBasisError = {
      isAxiosError: true,
      response: { status: 409, data: { code: 'other' } },
    } as const
    expect(
      shouldHandleDiffBasisChangedQueryError({
        error: nonBasisError,
        isError: true,
        failureCount: 1,
        previousFailureCount: 0,
      }),
    ).toBe(false)
  })

  it('handles basis-change failure counts independently per query key and only when authoritative', () => {
    const basisError = {
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          code: 'diff_basis_changed',
        },
      },
    } as const

    let branchFailureCount = 0
    let cellFailureCount = 0

    expect(
      shouldHandleDiffBasisChangedQueryErrorWithAuthority({
        error: basisError,
        isError: true,
        failureCount: 1,
        previousFailureCount: branchFailureCount,
        isAuthoritative: true,
      }),
    ).toBe(true)
    branchFailureCount = 1

    expect(
      shouldHandleDiffBasisChangedQueryErrorWithAuthority({
        error: basisError,
        isError: true,
        failureCount: 1,
        previousFailureCount: cellFailureCount,
        isAuthoritative: false,
      }),
    ).toBe(false)

    expect(
      shouldHandleDiffBasisChangedQueryErrorWithAuthority({
        error: basisError,
        isError: true,
        failureCount: 1,
        previousFailureCount: cellFailureCount,
        isAuthoritative: true,
      }),
    ).toBe(true)
    cellFailureCount = 1

    expect(
      shouldHandleDiffBasisChangedQueryErrorWithAuthority({
        error: basisError,
        isError: true,
        failureCount: 1,
        previousFailureCount: branchFailureCount,
        isAuthoritative: false,
      }),
    ).toBe(false)

    expect(
      shouldHandleDiffBasisChangedQueryErrorWithAuthority({
        error: basisError,
        isError: true,
        failureCount: 1,
        previousFailureCount: cellFailureCount,
        isAuthoritative: true,
      }),
    ).toBe(false)
  })

  it('clears branch/cell cache families on basis-change and keeps root cache intact', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const branchKey = createBackboneDiffWorkbenchBranchQueryKey(
      7,
      'root-s',
      'hash-1',
      {
        classification: [],
        layerKey: null,
        categoryCode: null,
        parameterCode: null,
        includeUnchanged: false,
        previewLimit: 20,
      },
      'L1::10::ETCH',
      'scope-x',
    )
    const cellKey = createBackboneDiffWorkbenchCellQueryKey(
      7,
      'root-s',
      'hash-1',
      {
        classification: [],
        layerKey: null,
        categoryCode: null,
        parameterCode: null,
        includeUnchanged: false,
        previewLimit: 20,
      },
      'L1::10::ETCH',
      'R1',
      'scope-x',
    )
    const rootKey = createBackboneDiffWorkbenchRootQueryKey(7, { previewLimit: 20 })

    queryClient.setQueryData(branchKey, { pages: [] })
    queryClient.setQueryData(cellKey, { pages: [] })
    queryClient.setQueryData(rootKey, { pages: [] })

    clearBackboneDiffBranchAndCellQueries(queryClient, 7)

    expect(queryClient.getQueryData(branchKey)).toBeUndefined()
    expect(queryClient.getQueryData(cellKey)).toBeUndefined()
    expect(queryClient.getQueryData(rootKey)).toEqual({ pages: [] })
  })

  it('clears stale in-flight branch/cell query work when filters are replaced', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    const branchRequest = deferred<BackboneDiffConditionPageOut[]>()
    const cellRequest = deferred<BackboneDiffCellPageOut[]>()
    const branchKey = createBackboneDiffWorkbenchBranchQueryKey(
      7,
      'root-s',
      'hash-1',
      {
        classification: [],
        layerKey: null,
        categoryCode: null,
        parameterCode: null,
        includeUnchanged: false,
        previewLimit: 20,
      },
      'L1::10::ETCH',
      'scope-x',
    )
    const cellKey = createBackboneDiffWorkbenchCellQueryKey(
      7,
      'root-s',
      'hash-1',
      {
        classification: [],
        layerKey: null,
        categoryCode: null,
        parameterCode: null,
        includeUnchanged: false,
        previewLimit: 20,
      },
      'L1::10::ETCH',
      'R1',
      'scope-x',
    )
    const rootKey = createBackboneDiffWorkbenchRootQueryKey(7, { previewLimit: 20 })

    void queryClient
      .fetchQuery({
        queryKey: branchKey,
        queryFn: () => branchRequest.promise,
      })
      .catch(() => undefined)
    void queryClient
      .fetchQuery({
        queryKey: cellKey,
        queryFn: () => cellRequest.promise,
      })
      .catch(() => undefined)
    queryClient.setQueryData(rootKey, { pages: [] })

    expect(queryClient.getQueryState(branchKey)?.status).toBe('pending')
    expect(queryClient.getQueryState(cellKey)?.status).toBe('pending')

    clearBackboneDiffBranchAndCellQueries(queryClient, 7)

    expect(queryClient.getQueryState(branchKey)).toBeUndefined()
    expect(queryClient.getQueryState(cellKey)).toBeUndefined()
    expect(queryClient.getQueryData(rootKey)).toEqual({ pages: [] })

    branchRequest.resolve([])
    cellRequest.resolve([])
    await Promise.resolve()

    expect(queryClient.getQueryState(branchKey)).toBeUndefined()
    expect(queryClient.getQueryState(cellKey)).toBeUndefined()
    expect(queryClient.getQueryData(rootKey)).toBeDefined()
  })

  it('keeps query-key contracts for branch/cell key generation', () => {
    expect(backboneDiffBranchQueryKey(7, 'L1::10::ETCH', { scope: 'scope-x' })).toEqual([
      'backboneDiff',
      7,
      'branch',
      'L1::10::ETCH',
      { scope: 'scope-x', cursor: null, limit: 50 },
    ])
    expect(backboneDiffCellQueryKey(7, 'L1::10::ETCH', 'R1', { scope: 'scope-x' })).toEqual([
      'backboneDiff',
      7,
      'cell',
      'L1::10::ETCH',
      'R1',
      { scope: 'scope-x', cursor: null, limit: 100 },
    ])
    expect(backboneDiffRootQueryKey(7, { previewLimit: 20 })).toHaveLength(4)
  })
})

function makeRootAuthority(
  state: BackboneDiffWorkbenchState,
  outerGeneration: number,
  rootBasisToken: number,
): ReturnType<typeof backboneDiffRootAuthority> {
  return backboneDiffRootAuthority({
    enabled: true,
    outerGeneration,
    state,
    rootBasisToken,
  })
}

function makeBranchAuthority(
  state: BackboneDiffWorkbenchState,
  outerGeneration: number,
  rootBasisToken: number,
): ReturnType<typeof backboneDiffBranchAuthority> {
  return backboneDiffBranchAuthority({
    enabled: true,
    outerGeneration,
    state,
    rootBasisToken,
  })
}

function makeCellAuthority(
  state: BackboneDiffWorkbenchState,
  outerGeneration: number,
  rootBasisToken: number,
): ReturnType<typeof backboneDiffCellAuthority> {
  return backboneDiffCellAuthority({
    enabled: true,
    outerGeneration,
    state,
    rootBasisToken,
  })
}

function makeWorkbenchState(
  partial: Partial<BackboneDiffWorkbenchState> & {
    mode: BackboneDiffWorkbenchMode
    rootBasisHash: string | null
    rootScope: string | null
    openLayerKey: string | null
    branchScope: string | null
    openCellScope: string | null
    openCellRowRef: string | null
    revision: number
  },
): BackboneDiffWorkbenchState {
  return {
    filters: {
      classification: ['added'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
      previewLimit: 20,
    },
    revision: partial.revision,
    rootScope: partial.rootScope,
    rootBasisHash: partial.rootBasisHash,
    rootCounts: {
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
    },
    layerSummaries: [],
    previewItems: [],
    mode: partial.mode,
    openLayerKey: partial.openLayerKey,
    branchScope: partial.branchScope,
    branchPages: [],
    branchNextCursor: null,
    openCellLayerKey: partial.mode === 'cell' ? partial.openLayerKey : null,
    openCellRowRef: partial.mode === 'cell' ? partial.openCellRowRef : null,
    openCellScope: partial.mode === 'cell' ? partial.openCellScope : null,
    cellPages: [],
    cellNextCursor: null,
    navigationAnnouncement: null,
  }
}

function createRootOut(
  scope: string,
  basis_hash: string,
  changed_preview: Array<BackboneDiffRootOut['changed_preview'][number]> = [],
): BackboneDiffRootOut {
  return {
    scope,
    basis_hash,
    counts: {
      layer_count: 1,
      available_layer_count: 1,
      unavailable_layer_count: 0,
      row_count: 1,
      cell_count: 1,
      full_row_count: 1,
      full_cell_count: 1,
      ambiguous_lineage_count: 0,
      added_count: 0,
      changed_count: 1,
      cleared_count: 0,
      removed_count: 0,
      unchanged_count: 0,
    },
    layer_summaries: [],
    changed_preview,
  }
}

function createConditionPage(rowRef: string): BackboneDiffConditionPageOut {
  return {
    scope: 'scope-x',
    basis_hash: 'hash-x',
    items: [
      {
        row_ref: rowRef,
        row_status: 'added',
        effective_condition_index: 1,
        identity: 1,
        baseline_condition: null,
        current_condition: null,
        row_metadata: {
          label_changed: false,
          index_changed: false,
          por_changed: false,
        },
        filtered_cell_count: 0,
        full_cell_count: 0,
        jump_status: 'available',
        cell_scope: null,
      },
    ],
    next_cursor: null,
  }
}

function createCellPage(parameterCode: string): BackboneDiffCellPageOut {
  return {
    scope: 'scope-x',
    basis_hash: 'hash-x',
    row_ref: 'R1',
    items: [
      {
        classification: 'added',
        reason: 'init',
        parameter_code: parameterCode,
        parameter_sort: 1,
        baseline_value: null,
        current_value: 'X',
        baseline_metadata: null,
        current_metadata: null,
        jump_status: 'available',
      },
    ],
    next_cursor: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn
    reject = rejectFn
  })
  return { promise, resolve, reject }
}
