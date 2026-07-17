import { QueryClient, onlineManager } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import * as backboneDiffApi from '@/api/backboneDiff'
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
  createBackboneDiffWorkbenchBranchQueryFn,
  createBackboneDiffWorkbenchCellQueryFn,
  createBackboneDiffWorkbenchRootQueryFn,
  useBackboneDiffWorkbenchController,
  acceptBackboneDiffQueryPage,
  shouldAcceptBackboneDiffQueryPage,
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

  it('separates branch/cell issued and accepted authority gates', () => {
    expect(
      shouldAcceptBackboneDiffQueryPage({
        dataToken: 1,
        issuedToken: 2,
        acceptedToken: 1,
      }),
    ).toBe(true)
    expect(
      shouldAcceptBackboneDiffQueryPage({
        dataToken: 2,
        issuedToken: 2,
        acceptedToken: 0,
      }),
    ).toBe(true)
    expect(
      shouldAcceptBackboneDiffQueryPage({
        dataToken: 1,
        issuedToken: 2,
        acceptedToken: 0,
      }),
    ).toBe(false)
    expect(
      shouldAcceptBackboneDiffQueryPage({
        dataToken: 2,
        issuedToken: 2,
        acceptedToken: 1,
      }),
    ).toBe(true)
    expect(
      shouldAcceptBackboneDiffQueryPage({
        dataToken: 3,
        issuedToken: 2,
        acceptedToken: 1,
      }),
    ).toBe(true)
  })

  it('applies accepted updates through the exported production acceptance helper', () => {
    const acceptedTokenByKeyRef = { current: {} as Record<string, number> }
    const key = '["backboneDiff",7,"branch","L1::10::ETCH",{"scope":"scope-a","cursor":null,"limit":50}]'

    expect(
      acceptBackboneDiffQueryPage({
        dataToken: 1,
        issuedToken: 2,
        acceptedToken: 0,
        acceptedTokenByKeyRef,
        key,
      }),
    ).toBe(false)
    expect(acceptedTokenByKeyRef.current[key]).toBeUndefined()

    expect(
      acceptBackboneDiffQueryPage({
        dataToken: 2,
        issuedToken: 2,
        acceptedToken: 1,
        acceptedTokenByKeyRef,
        key,
      }),
    ).toBe(true)
    expect(acceptedTokenByKeyRef.current[key]).toBe(2)
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

  it('uses the production root query seam through QueryClient so remount seeding accepts fresh cache', async () => {
    const projectId = 7
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    })
    queryClient.mount()

    const rootKey = createBackboneDiffWorkbenchRootQueryKey(projectId, {
      previewLimit: 20,
      classification: ['added'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })
    const rootTokenRef = { current: 0 }
    const rootTokenByKeyRef = { current: {} as Record<string, number> }
    const rootDeferredFirst = deferred<BackboneDiffRootOut>()
    const rootDeferredSecond = deferred<BackboneDiffRootOut>()
    const rootSpy = vi
      .spyOn(backboneDiffApi, 'getBackboneDiffRoot')
      .mockImplementationOnce(async () => rootDeferredFirst.promise)
      .mockImplementationOnce(async () => rootDeferredSecond.promise)

    queryClient.setQueryData(rootKey, {
      pages: [
        {
          token: 7,
          result: createRootOut('scope-cached', 'hash-cached'),
        },
      ],
      pageParams: [null],
    })

    const rootQueryFn = createBackboneDiffWorkbenchRootQueryFn(queryClient, rootTokenRef, rootTokenByKeyRef)

    try {
      const firstRequest = queryClient.fetchInfiniteQuery({
        queryKey: rootKey,
        queryFn: rootQueryFn,
        initialPageParam: null as string | null,
      })
      await vi.waitFor(() => expect(rootSpy).toHaveBeenCalledTimes(1))
      rootDeferredFirst.resolve(createRootOut('scope-fresh-1', 'hash-fresh-1'))
      const firstData = await firstRequest
      expect(firstData.pages[0]?.token).toBe(8)
      expect(queryClient.getQueryData(rootKey)).toEqual(firstData)

      queryClient.unmount()
      queryClient.mount()
      rootTokenRef.current = 0
      rootTokenByKeyRef.current = {}
      queryClient.invalidateQueries({ queryKey: rootKey, exact: true })

      const secondRequest = queryClient.fetchInfiniteQuery({
        queryKey: rootKey,
        queryFn: rootQueryFn,
        initialPageParam: null as string | null,
      })
      await vi.waitFor(() => expect(rootSpy).toHaveBeenCalledTimes(2))
      rootDeferredSecond.resolve(createRootOut('scope-fresh-2', 'hash-fresh-2'))
      const secondData = await secondRequest
      expect(secondData.pages[0]?.token).toBe(9)
      expect(queryClient.getQueryData(rootKey)).toEqual(secondData)
    } finally {
      rootSpy.mockRestore()
      queryClient.clear()
      queryClient.unmount()
    }
  })

  it('uses the production branch/cell query seams with separate issued and accepted authority', async () => {
    const projectId = 7
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    })
    queryClient.mount()

    const onlineState = onlineManager.isOnline()
    const branchIssuedTokenByKeyRef = { current: {} as Record<string, number> }
    const branchAcceptedTokenByKeyRef = { current: {} as Record<string, number> }
    const cellIssuedTokenByKeyRef = { current: {} as Record<string, number> }
    const cellAcceptedTokenByKeyRef = { current: {} as Record<string, number> }
    const branchQueryFn = createBackboneDiffWorkbenchBranchQueryFn(queryClient, branchIssuedTokenByKeyRef)
    const cellQueryFn = createBackboneDiffWorkbenchCellQueryFn(queryClient, cellIssuedTokenByKeyRef)

    const branchAKey = createBackboneDiffWorkbenchBranchQueryKey(
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
    const branchBKey = createBackboneDiffWorkbenchBranchQueryKey(
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
    const cellAKey = createBackboneDiffWorkbenchCellQueryKey(
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
    const cellBKey = createBackboneDiffWorkbenchCellQueryKey(
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

    const branchDeferredA1 = deferred<BackboneDiffConditionPageOut>()
    const branchDeferredB = deferred<BackboneDiffConditionPageOut>()
    const branchDeferredA2 = deferred<BackboneDiffConditionPageOut>()
    const branchDeferredA3 = deferred<BackboneDiffConditionPageOut>()
    const cellDeferredA1 = deferred<BackboneDiffCellPageOut>()
    const cellDeferredB = deferred<BackboneDiffCellPageOut>()
    const cellDeferredA2 = deferred<BackboneDiffCellPageOut>()
    const cellDeferredA3 = deferred<BackboneDiffCellPageOut>()
    const branchScopeCalls: Record<string, number> = { 'scope-a': 0, 'scope-b': 0 }
    const cellScopeCalls: Record<string, number> = { 'scope-a': 0, 'scope-b': 0 }

    const branchSpy = vi.spyOn(backboneDiffApi, 'getBackboneDiffConditions').mockImplementation(
      async (projectIdArg, layerKey, query) => {
        expect(projectIdArg).toBe(projectId)
        expect(layerKey).toBe('L1::10::ETCH')
        expect(query.cursor).toBeNull()
        const scope = query.scope
        if (scope !== 'scope-a' && scope !== 'scope-b') {
          throw new Error(`Unexpected branch scope ${scope}`)
        }
        branchScopeCalls[scope] = (branchScopeCalls[scope] ?? 0) + 1
        if (scope === 'scope-a' && branchScopeCalls[scope] === 1) return branchDeferredA1.promise
        if (scope === 'scope-b') return branchDeferredB.promise
        if (scope === 'scope-a' && branchScopeCalls[scope] === 2) return branchDeferredA2.promise
        if (scope === 'scope-a' && branchScopeCalls[scope] === 3) return branchDeferredA3.promise
        throw new Error(`Unexpected branch scope ${scope}`)
      },
    )
    const cellSpy = vi.spyOn(backboneDiffApi, 'getBackboneDiffCells').mockImplementation(
      async (projectIdArg, layerKey, rowRef, query) => {
        expect(projectIdArg).toBe(projectId)
        expect(layerKey).toBe('L1::10::ETCH')
        expect(query.cursor).toBeNull()
        const scope = query.scope
        if (scope !== 'scope-a' && scope !== 'scope-b') {
          throw new Error(`Unexpected cell descriptor ${rowRef}/${scope}`)
        }
        cellScopeCalls[scope] = (cellScopeCalls[scope] ?? 0) + 1
        if (rowRef === 'R-1' && scope === 'scope-a' && cellScopeCalls[scope] === 1) return cellDeferredA1.promise
        if (rowRef === 'R-2' && scope === 'scope-b') return cellDeferredB.promise
        if (rowRef === 'R-1' && scope === 'scope-a' && cellScopeCalls[scope] === 2) return cellDeferredA2.promise
        if (rowRef === 'R-1' && scope === 'scope-a' && cellScopeCalls[scope] === 3) return cellDeferredA3.promise
        throw new Error(`Unexpected cell descriptor ${rowRef}/${scope}`)
      },
    )

    try {
      onlineManager.setOnline(false)

      const branchRequestA = queryClient.fetchInfiniteQuery({
        queryKey: branchAKey,
        queryFn: branchQueryFn,
        initialPageParam: null as string | null,
      })
      const branchRequestB = queryClient.fetchInfiniteQuery({
        queryKey: branchBKey,
        queryFn: branchQueryFn,
        initialPageParam: null as string | null,
      })
      const cellRequestA = queryClient.fetchInfiniteQuery({
        queryKey: cellAKey,
        queryFn: cellQueryFn,
        initialPageParam: null as string | null,
      })
      const cellRequestB = queryClient.fetchInfiniteQuery({
        queryKey: cellBKey,
        queryFn: cellQueryFn,
        initialPageParam: null as string | null,
      })

      await Promise.resolve()
      expect(branchSpy).toHaveBeenCalledTimes(0)
      expect(cellSpy).toHaveBeenCalledTimes(0)

      onlineManager.setOnline(true)

      await vi.waitFor(() => {
        expect(branchSpy).toHaveBeenCalledTimes(2)
        expect(cellSpy).toHaveBeenCalledTimes(2)
      })

      branchDeferredA1.resolve(createConditionPage('R-a-1'))
      branchDeferredB.resolve(createConditionPage('R-b-1'))
      cellDeferredA1.resolve(createCellPage('P-a-1'))
      cellDeferredB.resolve(createCellPage('P-b-1'))

      const [branchAData, branchBData, cellAData, cellBData] = await Promise.all([
        branchRequestA,
        branchRequestB,
        cellRequestA,
        cellRequestB,
      ])

      expect(branchAData.pages[0]?.token).toBe(1)
      expect(branchBData.pages[0]?.token).toBe(1)
      expect(cellAData.pages[0]?.token).toBe(1)
      expect(cellBData.pages[0]?.token).toBe(1)

      const branchAKeyFingerprint = JSON.stringify(branchAKey)
      const branchBKeyFingerprint = JSON.stringify(branchBKey)
      const cellAKeyFingerprint = JSON.stringify(cellAKey)
      const cellBKeyFingerprint = JSON.stringify(cellBKey)

      expect(
        acceptBackboneDiffQueryPage({
          dataToken: branchAData.pages[0]?.token ?? 0,
          issuedToken: branchIssuedTokenByKeyRef.current[branchAKeyFingerprint] ?? 0,
          acceptedToken: branchAcceptedTokenByKeyRef.current[branchAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: branchAcceptedTokenByKeyRef,
          key: branchAKeyFingerprint,
        }),
      ).toBe(true)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: branchBData.pages[0]?.token ?? 0,
          issuedToken: branchIssuedTokenByKeyRef.current[branchBKeyFingerprint] ?? 0,
          acceptedToken: branchAcceptedTokenByKeyRef.current[branchBKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: branchAcceptedTokenByKeyRef,
          key: branchBKeyFingerprint,
        }),
      ).toBe(true)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: cellAData.pages[0]?.token ?? 0,
          issuedToken: cellIssuedTokenByKeyRef.current[cellAKeyFingerprint] ?? 0,
          acceptedToken: cellAcceptedTokenByKeyRef.current[cellAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: cellAcceptedTokenByKeyRef,
          key: cellAKeyFingerprint,
        }),
      ).toBe(true)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: cellBData.pages[0]?.token ?? 0,
          issuedToken: cellIssuedTokenByKeyRef.current[cellBKeyFingerprint] ?? 0,
          acceptedToken: cellAcceptedTokenByKeyRef.current[cellBKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: cellAcceptedTokenByKeyRef,
          key: cellBKeyFingerprint,
        }),
      ).toBe(true)

      const branchARefresh = queryClient.fetchInfiniteQuery({
        queryKey: branchAKey,
        queryFn: branchQueryFn,
        initialPageParam: null as string | null,
      })
      const cellARefresh = queryClient.fetchInfiniteQuery({
        queryKey: cellAKey,
        queryFn: cellQueryFn,
        initialPageParam: null as string | null,
      })

      await vi.waitFor(() => {
        expect(branchSpy).toHaveBeenCalledTimes(3)
        expect(cellSpy).toHaveBeenCalledTimes(3)
      })
      expect(
        shouldAcceptBackboneDiffQueryPage({
          dataToken: 1,
          issuedToken: branchIssuedTokenByKeyRef.current[branchAKeyFingerprint] ?? 0,
          acceptedToken: 0,
        }),
      ).toBe(false)
      expect(
        shouldAcceptBackboneDiffQueryPage({
          dataToken: 1,
          issuedToken: cellIssuedTokenByKeyRef.current[cellAKeyFingerprint] ?? 0,
          acceptedToken: 0,
        }),
      ).toBe(false)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: 1,
          issuedToken: branchIssuedTokenByKeyRef.current[branchAKeyFingerprint] ?? 0,
          acceptedToken: branchAcceptedTokenByKeyRef.current[branchAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: branchAcceptedTokenByKeyRef,
          key: branchAKeyFingerprint,
        }),
      ).toBe(true)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: 1,
          issuedToken: cellIssuedTokenByKeyRef.current[cellAKeyFingerprint] ?? 0,
          acceptedToken: cellAcceptedTokenByKeyRef.current[cellAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: cellAcceptedTokenByKeyRef,
          key: cellAKeyFingerprint,
        }),
      ).toBe(true)

      const branchAReplayCache = queryClient.getQueryData(branchAKey) as
        | { pages?: Array<{ token?: number }> }
        | undefined
      const cellAReplayCache = queryClient.getQueryData(cellAKey) as
        | { pages?: Array<{ token?: number }> }
        | undefined
      const branchAReplayPage = branchAReplayCache?.pages?.[branchAReplayCache.pages.length - 1]
      const cellAReplayPage = cellAReplayCache?.pages?.[cellAReplayCache.pages.length - 1]
      expect(branchAReplayPage?.token).toBe(1)
      expect(cellAReplayPage?.token).toBe(1)

      branchDeferredA2.reject(new Error('branch-a-2-failed'))
      cellDeferredA2.reject(new Error('cell-a-2-failed'))
      await expect(branchARefresh).rejects.toThrow('branch-a-2-failed')
      await expect(cellARefresh).rejects.toThrow('cell-a-2-failed')

      expect(branchAcceptedTokenByKeyRef.current[branchAKeyFingerprint]).toBe(1)
      expect(branchAcceptedTokenByKeyRef.current[branchBKeyFingerprint]).toBe(1)
      expect(cellAcceptedTokenByKeyRef.current[cellAKeyFingerprint]).toBe(1)
      expect(cellAcceptedTokenByKeyRef.current[cellBKeyFingerprint]).toBe(1)

      branchDeferredA3.resolve(createConditionPage('R-a-3'))
      cellDeferredA3.resolve(createCellPage('P-a-3'))
      const branchAAdvance = queryClient.fetchInfiniteQuery({
        queryKey: branchAKey,
        queryFn: branchQueryFn,
        initialPageParam: null as string | null,
      })
      const cellAAdvance = queryClient.fetchInfiniteQuery({
        queryKey: cellAKey,
        queryFn: cellQueryFn,
        initialPageParam: null as string | null,
      })
      await vi.waitFor(() => {
        expect(branchSpy).toHaveBeenCalledTimes(4)
        expect(cellSpy).toHaveBeenCalledTimes(4)
      })
      const [branchAAdvanceData, cellAAdvanceData] = await Promise.all([branchAAdvance, cellAAdvance])
      expect(branchAAdvanceData.pages[0]?.token).toBe(3)
      expect(cellAAdvanceData.pages[0]?.token).toBe(3)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: branchAAdvanceData.pages[0]?.token ?? 0,
          issuedToken: branchIssuedTokenByKeyRef.current[branchAKeyFingerprint] ?? 0,
          acceptedToken: branchAcceptedTokenByKeyRef.current[branchAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: branchAcceptedTokenByKeyRef,
          key: branchAKeyFingerprint,
        }),
      ).toBe(true)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: cellAAdvanceData.pages[0]?.token ?? 0,
          issuedToken: cellIssuedTokenByKeyRef.current[cellAKeyFingerprint] ?? 0,
          acceptedToken: cellAcceptedTokenByKeyRef.current[cellAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: cellAcceptedTokenByKeyRef,
          key: cellAKeyFingerprint,
        }),
      ).toBe(true)
      expect(branchAcceptedTokenByKeyRef.current[branchAKeyFingerprint]).toBe(3)
      expect(cellAcceptedTokenByKeyRef.current[cellAKeyFingerprint]).toBe(3)
    } finally {
      onlineManager.setOnline(onlineState)
      branchSpy.mockRestore()
      cellSpy.mockRestore()
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

  it('keeps the controller source wired to the exported production query factories', () => {
    const source = String(useBackboneDiffWorkbenchController)
    expect(source).toContain('createBackboneDiffWorkbenchRootQueryFn')
    expect(source).toContain('createBackboneDiffWorkbenchBranchQueryFn')
    expect(source).toContain('createBackboneDiffWorkbenchCellQueryFn')
    expect(source).toContain('acceptBackboneDiffQueryPage')
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
