import { InfiniteQueryObserver, QueryClient, onlineManager } from '@tanstack/react-query'
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
import controllerSource from './useBackboneDiffWorkbenchController.ts?raw'

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
  fenceBackboneDiffRootAuthorityLedger,
  getBackboneDiffAuthorityLedger,
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
  seedBackboneDiffAuthorityFromCache,
  broadcastBackboneDiffProjectFence,
  cancelAndInvalidateBackboneDiffProjectRoots,
  isCurrentBackboneDiffProjectBasisFence,
  isCurrentBackboneDiffProjectRevisionFence,
  parseBackboneDiffWorkbenchBranchQueryKey,
  parseBackboneDiffWorkbenchCellQueryKey,
  registerBackboneDiffProjectFenceListener,
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

type BackboneDiffRootQueryPage = {
  readonly token: number
  readonly result: BackboneDiffRootOut
}

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
    ).toBe(false)
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

  it('fences all root keys for a project exactly once per revision and basis marker', () => {
    const queryClient = new QueryClient()
    const authorityLedger = getBackboneDiffAuthorityLedger(queryClient)

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
    const otherProjectRoot = createBackboneDiffWorkbenchRootQueryKey(8, {
      previewLimit: 20,
      classification: ['changed'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })

    const rootAFingerprint = JSON.stringify(rootA)
    const rootBFingerprint = JSON.stringify(rootB)
    const otherProjectFingerprint = JSON.stringify(otherProjectRoot)

    authorityLedger.root.sequence = 8
    authorityLedger.root.issuedByKey[rootAFingerprint] = 8
    authorityLedger.root.acceptedByKey[rootAFingerprint] = 8
    authorityLedger.root.issuedByKey[rootBFingerprint] = 4
    authorityLedger.root.acceptedByKey[rootBFingerprint] = 4
    authorityLedger.root.issuedByKey[otherProjectFingerprint] = 2
    authorityLedger.root.acceptedByKey[otherProjectFingerprint] = 2

    const basisMarker = new Error('basis-changed')

    expect(
      fenceBackboneDiffRootAuthorityLedger(authorityLedger, 7, {
        kind: 'revision',
        revision: 3,
      }),
    ).toBe(true)
    expect(authorityLedger.root.sequence).toBe(9)
    expect(authorityLedger.root.issuedByKey[rootAFingerprint]).toBe(9)
    expect(authorityLedger.root.issuedByKey[rootBFingerprint]).toBe(9)
    expect(authorityLedger.root.acceptedByKey[rootAFingerprint]).toBeUndefined()
    expect(authorityLedger.root.acceptedByKey[rootBFingerprint]).toBeUndefined()
    expect(authorityLedger.root.issuedByKey[otherProjectFingerprint]).toBe(2)
    expect(authorityLedger.root.acceptedByKey[otherProjectFingerprint]).toBe(2)

    expect(
      fenceBackboneDiffRootAuthorityLedger(authorityLedger, 7, {
        kind: 'revision',
        revision: 3,
      }),
    ).toBe(false)
    expect(authorityLedger.root.sequence).toBe(9)
    expect(authorityLedger.root.issuedByKey[rootAFingerprint]).toBe(9)

    expect(
      fenceBackboneDiffRootAuthorityLedger(authorityLedger, 7, {
        kind: 'basis-error',
        marker: basisMarker,
      }),
    ).toBe(true)
    expect(authorityLedger.root.sequence).toBe(10)
    expect(authorityLedger.root.issuedByKey[rootAFingerprint]).toBe(10)
    expect(authorityLedger.root.issuedByKey[rootBFingerprint]).toBe(10)

    expect(
      fenceBackboneDiffRootAuthorityLedger(authorityLedger, 7, {
        kind: 'basis-error',
        marker: basisMarker,
      }),
    ).toBe(false)
    expect(authorityLedger.root.sequence).toBe(10)
  })

  it('keeps project-specific seen fence markers isolated across project switches', () => {
    const revisionSeen = { projectId: 7, revision: 3 } as const
    const basisMarker = new Error('basis-changed')
    const basisSeen = { projectId: 7, marker: basisMarker } as const

    expect(isCurrentBackboneDiffProjectRevisionFence(null, 7, 3)).toBe(false)
    expect(isCurrentBackboneDiffProjectRevisionFence(revisionSeen, 7, 3)).toBe(true)
    expect(isCurrentBackboneDiffProjectRevisionFence(revisionSeen, 8, 3)).toBe(false)
    expect(isCurrentBackboneDiffProjectRevisionFence({ projectId: 7, revision: 4 }, 7, 3)).toBe(false)

    expect(isCurrentBackboneDiffProjectBasisFence(null, 7, basisMarker)).toBe(false)
    expect(isCurrentBackboneDiffProjectBasisFence(basisSeen, 7, basisMarker)).toBe(true)
    expect(isCurrentBackboneDiffProjectBasisFence(basisSeen, 8, basisMarker)).toBe(false)
    expect(
      isCurrentBackboneDiffProjectBasisFence({ projectId: 7, marker: new Error('basis-changed') }, 7, basisMarker),
    ).toBe(false)
  })

  it('broadcasts project root fences across mounted controllers and refetches every active filter root once', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    })
    const otherQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    })
    queryClient.mount()
    otherQueryClient.mount()

    const authorityLedger = getBackboneDiffAuthorityLedger(queryClient)
    const otherAuthorityLedger = getBackboneDiffAuthorityLedger(otherQueryClient)

    let project7Calls = 0
    let project8Calls = 0
    const rootSpy = vi.spyOn(backboneDiffApi, 'getBackboneDiffRoot').mockImplementation(async (projectId, query = {}) => {
      if (projectId === 7) project7Calls += 1
      if (projectId === 8) project8Calls += 1
      const label = query.classification?.[0] ?? 'all'
      return createRootOut(`scope-${projectId}-${label}`, `basis-${projectId}-${label}`)
    })

    const rootKeyA = createBackboneDiffWorkbenchRootQueryKey(7, {
      previewLimit: 20,
      classification: ['added'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })
    const rootKeyB = createBackboneDiffWorkbenchRootQueryKey(7, {
      previewLimit: 20,
      classification: ['removed'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })
    const otherRootKey = createBackboneDiffWorkbenchRootQueryKey(8, {
      previewLimit: 20,
      classification: ['changed'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })

    const observerA = new InfiniteQueryObserver(queryClient, {
      queryKey: rootKeyA,
      initialPageParam: null as string | null,
      enabled: true,
      queryFn: createBackboneDiffWorkbenchRootQueryFn(queryClient, authorityLedger.root),
      getNextPageParam: () => null,
      retry: false,
    })
    const observerB = new InfiniteQueryObserver(queryClient, {
      queryKey: rootKeyB,
      initialPageParam: null as string | null,
      enabled: true,
      queryFn: createBackboneDiffWorkbenchRootQueryFn(queryClient, authorityLedger.root),
      getNextPageParam: () => null,
      retry: false,
    })
    const observerOther = new InfiniteQueryObserver(otherQueryClient, {
      queryKey: otherRootKey,
      initialPageParam: null as string | null,
      enabled: true,
      queryFn: createBackboneDiffWorkbenchRootQueryFn(otherQueryClient, otherAuthorityLedger.root),
      getNextPageParam: () => null,
      retry: false,
    })

    const cleanupCounts = { a: 0, b: 0, other: 0 }
    const makeFenceListener = (slot: 'a' | 'b' | 'other') => {
      let lastRevision: number | null = null
      let lastBasisMarker: unknown = Symbol(`${slot}-initial`)
      return {
        applyFence(fence: { kind: 'revision'; revision: number } | { kind: 'basis-error'; marker: unknown }) {
          if (fence.kind === 'revision') {
            if (lastRevision === fence.revision) return false
            lastRevision = fence.revision
          } else {
            if (lastBasisMarker === fence.marker) return false
            lastBasisMarker = fence.marker
          }
          cleanupCounts[slot] += 1
          return true
        },
      }
    }

    const unregisterA = registerBackboneDiffProjectFenceListener(queryClient, 7, makeFenceListener('a'))
    const unregisterB = registerBackboneDiffProjectFenceListener(queryClient, 7, makeFenceListener('b'))
    const unregisterOther = registerBackboneDiffProjectFenceListener(otherQueryClient, 8, makeFenceListener('other'))

    const unsubscribeA = observerA.subscribe(() => {})
    const unsubscribeB = observerB.subscribe(() => {})
    const unsubscribeOther = observerOther.subscribe(() => {})

    try {
      await vi.waitFor(() => {
        expect(project7Calls).toBe(2)
        expect(project8Calls).toBe(1)
        expect(observerA.getCurrentResult().data?.pages[0]?.token).toBeGreaterThan(0)
        expect(observerB.getCurrentResult().data?.pages[0]?.token).toBeGreaterThan(0)
        expect(observerOther.getCurrentResult().data?.pages[0]?.token).toBeGreaterThan(0)
      })
      const initialTokenA = observerA.getCurrentResult().data?.pages[0]?.token ?? 0
      const initialTokenB = observerB.getCurrentResult().data?.pages[0]?.token ?? 0
      const initialTokenOther = observerOther.getCurrentResult().data?.pages[0]?.token ?? 0
      expect(cleanupCounts).toEqual({ a: 0, b: 0, other: 0 })

      const revisionFence = { kind: 'revision', revision: 5 } as const
      expect(fenceBackboneDiffRootAuthorityLedger(authorityLedger, 7, revisionFence)).toBe(true)
      expect(broadcastBackboneDiffProjectFence(queryClient, 7, revisionFence)).toBe(true)
      await queryClient.invalidateQueries({ queryKey: ['backboneDiff', 7, 'root'], exact: false })
      await vi.waitFor(() => {
        expect(project7Calls).toBe(4)
        expect(project8Calls).toBe(1)
        expect(observerA.getCurrentResult().data?.pages[0]?.token).toBeGreaterThan(initialTokenA)
        expect(observerB.getCurrentResult().data?.pages[0]?.token).toBeGreaterThan(initialTokenB)
        expect(observerOther.getCurrentResult().data?.pages[0]?.token).toBe(initialTokenOther)
      })
      const revisionTokenA = observerA.getCurrentResult().data?.pages[0]?.token ?? initialTokenA
      const revisionTokenB = observerB.getCurrentResult().data?.pages[0]?.token ?? initialTokenB
      expect(cleanupCounts).toEqual({ a: 1, b: 1, other: 0 })

      expect(fenceBackboneDiffRootAuthorityLedger(authorityLedger, 7, revisionFence)).toBe(false)
      expect(broadcastBackboneDiffProjectFence(queryClient, 7, revisionFence)).toBe(false)
      expect(cleanupCounts).toEqual({ a: 1, b: 1, other: 0 })

      const basisMarker = new Error('basis-changed')
      const basisFence = { kind: 'basis-error', marker: basisMarker } as const
      expect(fenceBackboneDiffRootAuthorityLedger(authorityLedger, 7, basisFence)).toBe(true)
      expect(broadcastBackboneDiffProjectFence(queryClient, 7, basisFence)).toBe(true)
      await queryClient.invalidateQueries({ queryKey: ['backboneDiff', 7, 'root'], exact: false })
      await vi.waitFor(() => {
        expect(project7Calls).toBe(6)
        expect(project8Calls).toBe(1)
        expect(observerA.getCurrentResult().data?.pages[0]?.token).toBeGreaterThan(revisionTokenA)
        expect(observerB.getCurrentResult().data?.pages[0]?.token).toBeGreaterThan(revisionTokenB)
      })
      const basisTokenA = observerA.getCurrentResult().data?.pages[0]?.token ?? revisionTokenA
      expect(cleanupCounts).toEqual({ a: 2, b: 2, other: 0 })

      expect(fenceBackboneDiffRootAuthorityLedger(authorityLedger, 7, basisFence)).toBe(false)
      expect(broadcastBackboneDiffProjectFence(queryClient, 7, basisFence)).toBe(false)
      expect(cleanupCounts).toEqual({ a: 2, b: 2, other: 0 })

      unregisterB()
      unsubscribeB()

      const revisionFence2 = { kind: 'revision', revision: 6 } as const
      expect(fenceBackboneDiffRootAuthorityLedger(authorityLedger, 7, revisionFence2)).toBe(true)
      expect(broadcastBackboneDiffProjectFence(queryClient, 7, revisionFence2)).toBe(true)
      await queryClient.invalidateQueries({ queryKey: ['backboneDiff', 7, 'root'], exact: false })
      await vi.waitFor(() => {
        expect(project7Calls).toBe(7)
        expect(project8Calls).toBe(1)
        expect(observerA.getCurrentResult().data?.pages[0]?.token).toBeGreaterThan(basisTokenA)
      })
      expect(cleanupCounts).toEqual({ a: 3, b: 2, other: 0 })

      const otherRevision = { kind: 'revision', revision: 1 } as const
      expect(fenceBackboneDiffRootAuthorityLedger(otherAuthorityLedger, 8, otherRevision)).toBe(true)
      expect(broadcastBackboneDiffProjectFence(otherQueryClient, 8, otherRevision)).toBe(true)
      await otherQueryClient.invalidateQueries({ queryKey: ['backboneDiff', 8, 'root'], exact: false })
      await vi.waitFor(() => {
        expect(project8Calls).toBe(2)
      })
      expect(cleanupCounts.other).toBe(1)
    } finally {
      unsubscribeA()
      unsubscribeOther()
      unregisterA()
      unregisterOther()
      rootSpy.mockRestore()
      queryClient.clear()
      otherQueryClient.clear()
      queryClient.unmount()
      otherQueryClient.unmount()
    }
  })

  it('keeps project fence broadcasts safe when a listener self-unsubscribes mid-iteration', () => {
    const queryClient = new QueryClient()
    const events: string[] = []
    let unregisterFirst: (() => void) | undefined

    unregisterFirst = registerBackboneDiffProjectFenceListener(queryClient, 7, {
      applyFence() {
        events.push('first')
        unregisterFirst?.()
        return true
      },
    })
    const unregisterSecond = registerBackboneDiffProjectFenceListener(queryClient, 7, {
      applyFence() {
        events.push('second')
        return true
      },
    })

    try {
      expect(
        broadcastBackboneDiffProjectFence(queryClient, 7, { kind: 'revision', revision: 11 }),
      ).toBe(true)
      expect(events).toEqual(['first', 'second'])
    } finally {
      unregisterSecond()
      unregisterFirst?.()
    }
  })

  it('cancels an in-flight project root request before invalidating so a newer token wins', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    })
    const rootKey = createBackboneDiffWorkbenchRootQueryKey(7, {
      previewLimit: 20,
      classification: ['added'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })
    const firstRequest = deferred<BackboneDiffRootQueryPage>()
    const secondRequest = deferred<BackboneDiffRootQueryPage>()
    const requestSignals: AbortSignal[] = []
    let requestCount = 0
    const abortableRootQueryFn = async ({ signal }: { signal: AbortSignal }) => {
      requestCount += 1
      const currentCount = requestCount
      const request = currentCount === 1 ? firstRequest : currentCount === 2 ? secondRequest : undefined
      if (request === undefined) {
        throw new Error('unexpected extra root request')
      }

      requestSignals.push(signal)
      const abortPromise = new Promise<never>((_, reject) => {
        if (signal.aborted) {
          reject(new Error('aborted'))
          return
        }

        signal.addEventListener(
          'abort',
          () => {
            reject(new Error('aborted'))
          },
          { once: true },
        )
      })

      return Promise.race([request.promise, abortPromise])
    }

    try {
      const first = queryClient.fetchInfiniteQuery({
        queryKey: rootKey,
        initialPageParam: null as string | null,
        queryFn: abortableRootQueryFn,
        getNextPageParam: () => null,
      })
      void first.catch(() => undefined)

      await vi.waitFor(() => expect(requestCount).toBe(1))
      expect(requestSignals[0]?.aborted).toBe(false)

      await cancelAndInvalidateBackboneDiffProjectRoots(queryClient, 7)

      expect(requestSignals[0]?.aborted).toBe(true)

      const second = queryClient.fetchInfiniteQuery({
        queryKey: rootKey,
        initialPageParam: null as string | null,
        queryFn: abortableRootQueryFn,
        getNextPageParam: () => null,
      })
      void second.catch(() => undefined)

      await vi.waitFor(() => expect(requestCount).toBe(2))
      expect(requestSignals[0]?.aborted).toBe(true)
      expect(requestSignals[1]?.aborted).toBe(false)

      secondRequest.resolve({ token: 2, result: createRootOut('scope-refetched', 'basis-refetched') })
      await expect(second).resolves.toMatchObject({
        pages: [{ token: 2 }],
      })

      firstRequest.resolve({ token: 1, result: createRootOut('scope-stale', 'basis-stale') })
      await Promise.resolve()
      expect(queryClient.getQueryData(rootKey)).toMatchObject({
        pages: [{ token: 2 }],
      })
    } finally {
      firstRequest.resolve({ token: 1, result: createRootOut('scope-stale-cleanup', 'basis-stale-cleanup') })
      secondRequest.resolve({ token: 2, result: createRootOut('scope-stale-cleanup', 'basis-stale-cleanup') })
      queryClient.clear()
    }
  })

  it('keeps retry handlers refetch-only and lets same-key query intents dedupe to one issuance', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    })
    queryClient.mount()
    const authorityLedger = getBackboneDiffAuthorityLedger(queryClient)

    const rootKey = createBackboneDiffWorkbenchRootQueryKey(7, {
      previewLimit: 20,
      classification: ['added'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })
    const rootFingerprint = JSON.stringify(rootKey)
    const rootRequest = deferred<BackboneDiffRootOut>()
    const rootSpy = vi
      .spyOn(backboneDiffApi, 'getBackboneDiffRoot')
      .mockImplementation(async () => rootRequest.promise)

    const rootQueryFn = createBackboneDiffWorkbenchRootQueryFn(queryClient, authorityLedger.root)

    try {
      const first = queryClient.fetchInfiniteQuery({
        queryKey: rootKey,
        queryFn: rootQueryFn,
        initialPageParam: null as string | null,
      })
      const second = queryClient.fetchInfiniteQuery({
        queryKey: rootKey,
        queryFn: rootQueryFn,
        initialPageParam: null as string | null,
      })

      await vi.waitFor(() => expect(rootSpy).toHaveBeenCalledTimes(1))
      expect(authorityLedger.root.issuedByKey[rootFingerprint]).toBe(1)
      expect(authorityLedger.root.acceptedByKey[rootFingerprint]).toBeUndefined()

      rootRequest.resolve(createRootOut('scope-dedup', 'hash-dedup'))
      const [firstData, secondData] = await Promise.all([first, second])
      expect(firstData.pages[0]?.token).toBe(1)
      expect(secondData.pages[0]?.token).toBe(1)
      expect(rootSpy).toHaveBeenCalledTimes(1)
      expect(authorityLedger.root.issuedByKey[rootFingerprint]).toBe(1)
    } finally {
      rootSpy.mockRestore()
      queryClient.clear()
      queryClient.unmount()
    }
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

  it('persists root authority across same QueryClient remounts and rejects stale replay after error', async () => {
    const projectId = 7
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    })
    queryClient.mount()
    const authorityLedger = getBackboneDiffAuthorityLedger(queryClient)

    const rootKey = createBackboneDiffWorkbenchRootQueryKey(projectId, {
      previewLimit: 20,
      classification: ['added'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })
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

    const rootQueryFn = createBackboneDiffWorkbenchRootQueryFn(queryClient, authorityLedger.root)
    const rootKeyFingerprint = JSON.stringify(rootKey)

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
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: firstData.pages[0]?.token ?? 0,
          issuedToken: authorityLedger.root.issuedByKey[rootKeyFingerprint] ?? 0,
          acceptedToken: authorityLedger.root.acceptedByKey[rootKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: { current: authorityLedger.root.acceptedByKey },
          key: rootKeyFingerprint,
        }),
      ).toBe(true)
      expect(authorityLedger.root.acceptedByKey[rootKeyFingerprint]).toBe(8)

      queryClient.unmount()
      queryClient.mount()
      expect(getBackboneDiffAuthorityLedger(queryClient)).toBe(authorityLedger)

      const secondRequest = queryClient.fetchInfiniteQuery({
        queryKey: rootKey,
        queryFn: rootQueryFn,
        initialPageParam: null as string | null,
      })
      await vi.waitFor(() => expect(rootSpy).toHaveBeenCalledTimes(2))
      rootDeferredSecond.reject(new Error('root-remount-failed'))
      await expect(secondRequest).rejects.toThrow('root-remount-failed')

      const retained = queryClient.getQueryData(rootKey) as
        | { pages?: Array<{ token?: number }> }
        | undefined
      const retainedPages = retained?.pages ?? []
      const retainedToken = retainedPages[retainedPages.length - 1]?.token ?? 0
      expect(retainedToken).toBe(8)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: retainedToken,
          issuedToken: authorityLedger.root.issuedByKey[rootKeyFingerprint] ?? 0,
          acceptedToken: authorityLedger.root.acceptedByKey[rootKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: { current: authorityLedger.root.acceptedByKey },
          key: rootKeyFingerprint,
        }),
      ).toBe(true)

      const freshQueryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 0 },
        },
      })
      expect(getBackboneDiffAuthorityLedger(freshQueryClient)).not.toBe(authorityLedger)
      expect(getBackboneDiffAuthorityLedger(freshQueryClient).root.acceptedByKey[rootKeyFingerprint]).toBeUndefined()
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
    const authorityLedger = getBackboneDiffAuthorityLedger(queryClient)

    const onlineState = onlineManager.isOnline()
    const branchQueryFn = createBackboneDiffWorkbenchBranchQueryFn(queryClient, authorityLedger.branch)
    const cellQueryFn = createBackboneDiffWorkbenchCellQueryFn(queryClient, authorityLedger.cell)

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
      const branchRequestAReplay = queryClient.fetchInfiniteQuery({
        queryKey: branchAKey,
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
      const cellRequestAReplay = queryClient.fetchInfiniteQuery({
        queryKey: cellAKey,
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

      const [branchAData, branchAReplayData, branchBData, cellAData, cellAReplayData, cellBData] =
        await Promise.all([
        branchRequestA,
        branchRequestAReplay,
        branchRequestB,
        cellRequestA,
        cellRequestAReplay,
        cellRequestB,
      ])

      expect(branchAData.pages[0]?.token).toBe(1)
      expect(branchAReplayData.pages[0]?.token).toBe(1)
      expect(branchBData.pages[0]?.token).toBe(1)
      expect(cellAData.pages[0]?.token).toBe(1)
      expect(cellAReplayData.pages[0]?.token).toBe(1)
      expect(cellBData.pages[0]?.token).toBe(1)

      queryClient.unmount()
      queryClient.mount()
      expect(getBackboneDiffAuthorityLedger(queryClient)).toBe(authorityLedger)

      const branchAKeyFingerprint = JSON.stringify(branchAKey)
      const branchBKeyFingerprint = JSON.stringify(branchBKey)
      const cellAKeyFingerprint = JSON.stringify(cellAKey)
      const cellBKeyFingerprint = JSON.stringify(cellBKey)

      expect(
        acceptBackboneDiffQueryPage({
          dataToken: branchAData.pages[0]?.token ?? 0,
          issuedToken: authorityLedger.branch.issuedByKey[branchAKeyFingerprint] ?? 0,
          acceptedToken: authorityLedger.branch.acceptedByKey[branchAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: { current: authorityLedger.branch.acceptedByKey },
          key: branchAKeyFingerprint,
        }),
      ).toBe(true)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: branchBData.pages[0]?.token ?? 0,
          issuedToken: authorityLedger.branch.issuedByKey[branchBKeyFingerprint] ?? 0,
          acceptedToken: authorityLedger.branch.acceptedByKey[branchBKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: { current: authorityLedger.branch.acceptedByKey },
          key: branchBKeyFingerprint,
        }),
      ).toBe(true)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: cellAData.pages[0]?.token ?? 0,
          issuedToken: authorityLedger.cell.issuedByKey[cellAKeyFingerprint] ?? 0,
          acceptedToken: authorityLedger.cell.acceptedByKey[cellAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: { current: authorityLedger.cell.acceptedByKey },
          key: cellAKeyFingerprint,
        }),
      ).toBe(true)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: cellBData.pages[0]?.token ?? 0,
          issuedToken: authorityLedger.cell.issuedByKey[cellBKeyFingerprint] ?? 0,
          acceptedToken: authorityLedger.cell.acceptedByKey[cellBKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: { current: authorityLedger.cell.acceptedByKey },
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
          issuedToken: authorityLedger.branch.issuedByKey[branchAKeyFingerprint] ?? 0,
          acceptedToken: 0,
        }),
      ).toBe(false)
      expect(
        shouldAcceptBackboneDiffQueryPage({
          dataToken: 1,
          issuedToken: authorityLedger.cell.issuedByKey[cellAKeyFingerprint] ?? 0,
          acceptedToken: 0,
        }),
      ).toBe(false)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: 1,
          issuedToken: authorityLedger.branch.issuedByKey[branchAKeyFingerprint] ?? 0,
          acceptedToken: authorityLedger.branch.acceptedByKey[branchAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: { current: authorityLedger.branch.acceptedByKey },
          key: branchAKeyFingerprint,
        }),
      ).toBe(true)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: 1,
          issuedToken: authorityLedger.cell.issuedByKey[cellAKeyFingerprint] ?? 0,
          acceptedToken: authorityLedger.cell.acceptedByKey[cellAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: { current: authorityLedger.cell.acceptedByKey },
          key: cellAKeyFingerprint,
        }),
      ).toBe(true)

      const branchAReplayCache = queryClient.getQueryData(branchAKey) as
        | { pages?: Array<{ token?: number }> }
        | undefined
      const cellAReplayCache = queryClient.getQueryData(cellAKey) as
        | { pages?: Array<{ token?: number }> }
        | undefined
      const branchAReplayPages = branchAReplayCache?.pages ?? []
      const cellAReplayPages = cellAReplayCache?.pages ?? []
      const branchAReplayPage = branchAReplayPages[branchAReplayPages.length - 1]
      const cellAReplayPage = cellAReplayPages[cellAReplayPages.length - 1]
      expect(branchAReplayPage?.token).toBe(1)
      expect(cellAReplayPage?.token).toBe(1)

      branchDeferredA2.reject(new Error('branch-a-2-failed'))
      cellDeferredA2.reject(new Error('cell-a-2-failed'))
      await expect(branchARefresh).rejects.toThrow('branch-a-2-failed')
      await expect(cellARefresh).rejects.toThrow('cell-a-2-failed')

      const branchARetainedAfterError = queryClient.getQueryData(branchAKey) as
        | { pages?: Array<{ token?: number }> }
        | undefined
      const cellARetainedAfterError = queryClient.getQueryData(cellAKey) as
        | { pages?: Array<{ token?: number }> }
        | undefined
      const branchARetainedAfterErrorPages = branchARetainedAfterError?.pages ?? []
      const cellARetainedAfterErrorPages = cellARetainedAfterError?.pages ?? []
      expect(branchARetainedAfterErrorPages[branchARetainedAfterErrorPages.length - 1]?.token).toBe(1)
      expect(cellARetainedAfterErrorPages[cellARetainedAfterErrorPages.length - 1]?.token).toBe(1)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: branchARetainedAfterErrorPages[branchARetainedAfterErrorPages.length - 1]?.token ?? 0,
          issuedToken: authorityLedger.branch.issuedByKey[branchAKeyFingerprint] ?? 0,
          acceptedToken: authorityLedger.branch.acceptedByKey[branchAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: { current: authorityLedger.branch.acceptedByKey },
          key: branchAKeyFingerprint,
        }),
      ).toBe(true)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: cellARetainedAfterErrorPages[cellARetainedAfterErrorPages.length - 1]?.token ?? 0,
          issuedToken: authorityLedger.cell.issuedByKey[cellAKeyFingerprint] ?? 0,
          acceptedToken: authorityLedger.cell.acceptedByKey[cellAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: { current: authorityLedger.cell.acceptedByKey },
          key: cellAKeyFingerprint,
        }),
      ).toBe(true)

      expect(authorityLedger.branch.acceptedByKey[branchAKeyFingerprint]).toBe(1)
      expect(authorityLedger.branch.acceptedByKey[branchBKeyFingerprint]).toBe(1)
      expect(authorityLedger.cell.acceptedByKey[cellAKeyFingerprint]).toBe(1)
      expect(authorityLedger.cell.acceptedByKey[cellBKeyFingerprint]).toBe(1)

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
          issuedToken: authorityLedger.branch.issuedByKey[branchAKeyFingerprint] ?? 0,
          acceptedToken: authorityLedger.branch.acceptedByKey[branchAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: { current: authorityLedger.branch.acceptedByKey },
          key: branchAKeyFingerprint,
        }),
      ).toBe(true)
      expect(
        acceptBackboneDiffQueryPage({
          dataToken: cellAAdvanceData.pages[0]?.token ?? 0,
          issuedToken: authorityLedger.cell.issuedByKey[cellAKeyFingerprint] ?? 0,
          acceptedToken: authorityLedger.cell.acceptedByKey[cellAKeyFingerprint] ?? 0,
          acceptedTokenByKeyRef: { current: authorityLedger.cell.acceptedByKey },
          key: cellAKeyFingerprint,
        }),
      ).toBe(true)
      expect(authorityLedger.branch.acceptedByKey[branchAKeyFingerprint]).toBe(3)
      expect(authorityLedger.cell.acceptedByKey[cellAKeyFingerprint]).toBe(3)
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

  it('purges exact authority entries on removeQueries and clear without cross-client leakage', () => {
    const clientA = new QueryClient()
    const clientB = new QueryClient()
    const ledgerA = getBackboneDiffAuthorityLedger(clientA)
    const ledgerB = getBackboneDiffAuthorityLedger(clientB)

    const rootKeyA = createBackboneDiffWorkbenchRootQueryKey(7, {
      previewLimit: 20,
      classification: ['added'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })
    const rootKeyA2 = createBackboneDiffWorkbenchRootQueryKey(7, {
      previewLimit: 20,
      classification: ['removed'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
    })
    const otherProjectRootKey = createBackboneDiffWorkbenchRootQueryKey(8, {
      previewLimit: 20,
      classification: ['changed'],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
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

    const rootFingerprintA = JSON.stringify(rootKeyA)
    const rootFingerprintA2 = JSON.stringify(rootKeyA2)
    const otherProjectRootFingerprint = JSON.stringify(otherProjectRootKey)
    const branchFingerprint = JSON.stringify(branchKey)
    const cellFingerprint = JSON.stringify(cellKey)

    ledgerA.root.revisionFenceByProjectId[7] = 3
    ledgerA.root.basisFenceMarkerByProjectId.set(7, { marker: 'basis-a' })
    ledgerA.root.issuedByKey[rootFingerprintA] = 1
    ledgerA.root.acceptedByKey[rootFingerprintA] = 1
    ledgerA.root.issuedByKey[rootFingerprintA2] = 2
    ledgerA.root.acceptedByKey[rootFingerprintA2] = 2
    ledgerA.branch.issuedByKey[branchFingerprint] = 2
    ledgerA.branch.acceptedByKey[branchFingerprint] = 2
    ledgerA.cell.issuedByKey[cellFingerprint] = 3
    ledgerA.cell.acceptedByKey[cellFingerprint] = 3

    ledgerB.root.revisionFenceByProjectId[7] = 13
    ledgerB.root.basisFenceMarkerByProjectId.set(7, { marker: 'basis-b' })
    ledgerB.root.revisionFenceByProjectId[8] = 21
    ledgerB.root.basisFenceMarkerByProjectId.set(8, { marker: 'basis-c' })
    ledgerB.root.issuedByKey[rootFingerprintA] = 11
    ledgerB.root.acceptedByKey[rootFingerprintA] = 11
    ledgerB.root.issuedByKey[otherProjectRootFingerprint] = 12
    ledgerB.root.acceptedByKey[otherProjectRootFingerprint] = 12
    ledgerB.branch.issuedByKey[branchFingerprint] = 12
    ledgerB.branch.acceptedByKey[branchFingerprint] = 12
    ledgerB.cell.issuedByKey[cellFingerprint] = 13
    ledgerB.cell.acceptedByKey[cellFingerprint] = 13

    clientA.setQueryData(rootKeyA, { pages: [] })
    clientA.setQueryData(rootKeyA2, { pages: [] })
    clientA.setQueryData(branchKey, { pages: [] })
    clientA.setQueryData(cellKey, { pages: [] })
    clientB.setQueryData(rootKeyA, { pages: [] })
    clientB.setQueryData(otherProjectRootKey, { pages: [] })
    clientB.setQueryData(branchKey, { pages: [] })
    clientB.setQueryData(cellKey, { pages: [] })

    clientA.removeQueries({ queryKey: rootKeyA, exact: true })
    expect(ledgerA.root.issuedByKey[rootFingerprintA]).toBeUndefined()
    expect(ledgerA.root.acceptedByKey[rootFingerprintA]).toBeUndefined()
    expect(ledgerA.root.issuedByKey[rootFingerprintA2]).toBe(2)
    expect(ledgerA.root.acceptedByKey[rootFingerprintA2]).toBe(2)
    expect(ledgerA.root.revisionFenceByProjectId[7]).toBe(3)
    expect(ledgerA.root.basisFenceMarkerByProjectId.get(7)).toEqual({ marker: 'basis-a' })
    expect(ledgerB.root.issuedByKey[rootFingerprintA]).toBe(11)
    expect(ledgerB.root.acceptedByKey[rootFingerprintA]).toBe(11)
    expect(ledgerB.root.issuedByKey[otherProjectRootFingerprint]).toBe(12)
    expect(ledgerB.root.acceptedByKey[otherProjectRootFingerprint]).toBe(12)
    expect(ledgerB.root.revisionFenceByProjectId[7]).toBe(13)
    expect(ledgerB.root.basisFenceMarkerByProjectId.get(7)).toEqual({ marker: 'basis-b' })
    expect(ledgerB.root.revisionFenceByProjectId[8]).toBe(21)
    expect(ledgerB.root.basisFenceMarkerByProjectId.get(8)).toEqual({ marker: 'basis-c' })

    clientA.removeQueries({ queryKey: rootKeyA2, exact: true })
    expect(ledgerA.root.issuedByKey[rootFingerprintA2]).toBeUndefined()
    expect(ledgerA.root.acceptedByKey[rootFingerprintA2]).toBeUndefined()
    expect(ledgerA.root.revisionFenceByProjectId[7]).toBeUndefined()
    expect(ledgerA.root.basisFenceMarkerByProjectId.get(7)).toBeUndefined()

    clientA.clear()
    expect(ledgerA.branch.issuedByKey[branchFingerprint]).toBeUndefined()
    expect(ledgerA.branch.acceptedByKey[branchFingerprint]).toBeUndefined()
    expect(ledgerA.cell.issuedByKey[cellFingerprint]).toBeUndefined()
    expect(ledgerA.cell.acceptedByKey[cellFingerprint]).toBeUndefined()
    expect(ledgerB.branch.issuedByKey[branchFingerprint]).toBe(12)
    expect(ledgerB.cell.acceptedByKey[cellFingerprint]).toBe(13)
    expect(ledgerB.root.revisionFenceByProjectId[7]).toBe(13)
    expect(ledgerB.root.basisFenceMarkerByProjectId.get(7)).toEqual({ marker: 'basis-b' })
    expect(ledgerB.root.revisionFenceByProjectId[8]).toBe(21)
    expect(ledgerB.root.basisFenceMarkerByProjectId.get(8)).toEqual({ marker: 'basis-c' })

    clientB.clear()
  })

  it('seeds branch and cell authority only from enabled parseable keys and preserves real tokens', () => {
    const queryClient = new QueryClient()
    const authorityLedger = getBackboneDiffAuthorityLedger(queryClient)

    const branchDisabledKey = ['backbone-diff', 7, 'branch', 'disabled'] as const
    const cellDisabledKey = ['backbone-diff', 7, 'cell', 'disabled'] as const
    const branchKey = createBackboneDiffWorkbenchBranchQueryKey(
      7,
      'root-s',
      'hash-1',
      {
        classification: ['added'],
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
        classification: ['added'],
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
    const branchDisabledFingerprint = JSON.stringify(branchDisabledKey)
    const cellDisabledFingerprint = JSON.stringify(cellDisabledKey)
    const branchFingerprint = JSON.stringify(branchKey)
    const cellFingerprint = JSON.stringify(cellKey)

    authorityLedger.branch.issuedByKey[branchDisabledFingerprint] = 3
    authorityLedger.branch.acceptedByKey[branchDisabledFingerprint] = 3
    authorityLedger.cell.issuedByKey[cellDisabledFingerprint] = 4
    authorityLedger.cell.acceptedByKey[cellDisabledFingerprint] = 4
    queryClient.setQueryData(branchKey, { pages: [{ token: 5, result: createConditionPage('R1') }], pageParams: [null] })
    queryClient.setQueryData(cellKey, { pages: [{ token: 6, result: createCellPage('P1') }], pageParams: [null] })

    seedBackboneDiffAuthorityFromCache({
      authorityLane: authorityLedger.branch,
      enabled: false,
      parseQueryKey: parseBackboneDiffWorkbenchBranchQueryKey,
      queryClient,
      queryKey: branchDisabledKey,
    })
    seedBackboneDiffAuthorityFromCache({
      authorityLane: authorityLedger.cell,
      enabled: false,
      parseQueryKey: parseBackboneDiffWorkbenchCellQueryKey,
      queryClient,
      queryKey: cellDisabledKey,
    })
    expect(authorityLedger.branch.issuedByKey[branchDisabledFingerprint]).toBeUndefined()
    expect(authorityLedger.branch.acceptedByKey[branchDisabledFingerprint]).toBeUndefined()
    expect(authorityLedger.cell.issuedByKey[cellDisabledFingerprint]).toBeUndefined()
    expect(authorityLedger.cell.acceptedByKey[cellDisabledFingerprint]).toBeUndefined()

    seedBackboneDiffAuthorityFromCache({
      authorityLane: authorityLedger.branch,
      enabled: true,
      parseQueryKey: parseBackboneDiffWorkbenchBranchQueryKey,
      queryClient,
      queryKey: branchKey,
    })
    seedBackboneDiffAuthorityFromCache({
      authorityLane: authorityLedger.cell,
      enabled: true,
      parseQueryKey: parseBackboneDiffWorkbenchCellQueryKey,
      queryClient,
      queryKey: cellKey,
    })
    expect(authorityLedger.branch.issuedByKey[branchFingerprint]).toBe(5)
    expect(authorityLedger.cell.issuedByKey[cellFingerprint]).toBe(6)
    expect(authorityLedger.branch.acceptedByKey[branchFingerprint]).toBeUndefined()
    expect(authorityLedger.cell.acceptedByKey[cellFingerprint]).toBeUndefined()

    queryClient.removeQueries({ queryKey: branchKey, exact: true })
    queryClient.removeQueries({ queryKey: cellKey, exact: true })
    expect(authorityLedger.branch.issuedByKey[branchFingerprint]).toBeUndefined()
    expect(authorityLedger.branch.acceptedByKey[branchFingerprint]).toBeUndefined()
    expect(authorityLedger.cell.issuedByKey[cellFingerprint]).toBeUndefined()
    expect(authorityLedger.cell.acceptedByKey[cellFingerprint]).toBeUndefined()

    queryClient.clear()
    expect(authorityLedger.branch.issuedByKey[branchDisabledFingerprint]).toBeUndefined()
    expect(authorityLedger.branch.acceptedByKey[branchDisabledFingerprint]).toBeUndefined()
    expect(authorityLedger.cell.issuedByKey[cellDisabledFingerprint]).toBeUndefined()
    expect(authorityLedger.cell.acceptedByKey[cellDisabledFingerprint]).toBeUndefined()

    authorityLedger.branch.issuedByKey[branchDisabledFingerprint] = 8
    authorityLedger.branch.acceptedByKey[branchDisabledFingerprint] = 8
    authorityLedger.cell.issuedByKey[cellDisabledFingerprint] = 9
    authorityLedger.cell.acceptedByKey[cellDisabledFingerprint] = 9
    seedBackboneDiffAuthorityFromCache({
      authorityLane: authorityLedger.branch,
      enabled: true,
      parseQueryKey: parseBackboneDiffWorkbenchBranchQueryKey,
      queryClient,
      queryKey: branchDisabledKey,
    })
    seedBackboneDiffAuthorityFromCache({
      authorityLane: authorityLedger.cell,
      enabled: true,
      parseQueryKey: parseBackboneDiffWorkbenchCellQueryKey,
      queryClient,
      queryKey: cellDisabledKey,
    })
    expect(authorityLedger.branch.issuedByKey[branchDisabledFingerprint]).toBeUndefined()
    expect(authorityLedger.branch.acceptedByKey[branchDisabledFingerprint]).toBeUndefined()
    expect(authorityLedger.cell.issuedByKey[cellDisabledFingerprint]).toBeUndefined()
    expect(authorityLedger.cell.acceptedByKey[cellDisabledFingerprint]).toBeUndefined()

    const branchNoCacheKey = createBackboneDiffWorkbenchBranchQueryKey(
      7,
      'root-s',
      'hash-2',
      {
        classification: ['removed'],
        layerKey: null,
        categoryCode: null,
        parameterCode: null,
        includeUnchanged: false,
        previewLimit: 20,
      },
      'L1::10::ETCH',
      'scope-y',
    )
    const branchNoCacheFingerprint = JSON.stringify(branchNoCacheKey)
    seedBackboneDiffAuthorityFromCache({
      authorityLane: authorityLedger.branch,
      enabled: true,
      parseQueryKey: parseBackboneDiffWorkbenchBranchQueryKey,
      queryClient,
      queryKey: branchNoCacheKey,
    })
    expect(authorityLedger.branch.issuedByKey[branchNoCacheFingerprint]).toBeUndefined()
    expect(authorityLedger.branch.acceptedByKey[branchNoCacheFingerprint]).toBeUndefined()

    authorityLedger.branch.issuedByKey[branchFingerprint] = 9
    seedBackboneDiffAuthorityFromCache({
      authorityLane: authorityLedger.branch,
      enabled: true,
      parseQueryKey: parseBackboneDiffWorkbenchBranchQueryKey,
      queryClient,
      queryKey: branchKey,
    })
    expect(authorityLedger.branch.issuedByKey[branchFingerprint]).toBe(9)
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
    expect(controllerSource).toContain('getBackboneDiffAuthorityLedger(queryClient)')
    expect(controllerSource).toContain('createBackboneDiffWorkbenchRootQueryFn')
    expect(controllerSource).toContain('createBackboneDiffWorkbenchBranchQueryFn')
    expect(controllerSource).toContain('createBackboneDiffWorkbenchCellQueryFn')
    expect(controllerSource).toContain('acceptBackboneDiffQueryPage')
    expect(controllerSource).toContain('authorityLedger.root')
    expect(controllerSource).toContain('authorityLedger.branch')
    expect(controllerSource).toContain('authorityLedger.cell')
    expect(controllerSource).toContain('registerBackboneDiffProjectFenceListener(queryClient, projectId, {')
    expect(controllerSource).toContain('broadcastBackboneDiffProjectFence(queryClient, projectId, fence)')
    expect(controllerSource).toContain('cancelAndInvalidateBackboneDiffProjectRoots(queryClient, projectId)')
    expect(controllerSource).toContain('seedBackboneDiffAuthorityFromCache({')
    expect(controllerSource).toContain("const queryKey = ['backboneDiff', projectId, 'root'] as const")
    expect(controllerSource).toContain('for (const listener of [...listeners])')
    expect(controllerSource).toContain('lastRevisionFenceRef.current = { projectId, revision: fence.revision }')
    expect(controllerSource).toContain('lastBasisFenceMarkerRef.current = { projectId, marker: fence.marker }')
    expect(controllerSource).toContain('exact: false')
    expect(controllerSource).toContain('handleBasisChangedFromRevision(revision)')
    expect(controllerSource).toContain('handleBasisChangedFromError(branchQuery.error)')
    expect(controllerSource).toContain('handleBasisChangedFromError(cellQuery.error)')
    expect(controllerSource).toContain('[commitState, projectId]')
    expect(controllerSource).toContain('void rootQuery.refetch()')
    expect(controllerSource).toContain('void branchQuery.refetch()')
    expect(controllerSource).toContain('void cellQuery.refetch()')
    expect(controllerSource).toContain('branchQuery.data === undefined')
    expect(controllerSource).toContain('cellQuery.data === undefined')
    expect(controllerSource).not.toContain('rootQueryTokenRef')
    expect(controllerSource).not.toContain('branchQueryIssuedTokenByKeyRef')
    expect(controllerSource).not.toContain('branchQueryAcceptedTokenByKeyRef')
    expect(controllerSource).not.toContain('cellQueryIssuedTokenByKeyRef')
    expect(controllerSource).not.toContain('cellQueryAcceptedTokenByKeyRef')
    expect(controllerSource).not.toContain('authorityLedger.branch.issuedByKey[key] = Math.max(currentIssuedToken, cachedToken)')
    expect(controllerSource).not.toContain('authorityLedger.cell.issuedByKey[key] = Math.max(currentIssuedToken, cachedToken)')
    expect(controllerSource).not.toContain('rootQueryTokenByKeyRef')
    expect(controllerSource).not.toContain('!rootQuery.isSuccess')
    expect(controllerSource).not.toContain('!branchQuery.isSuccess')
    expect(controllerSource).not.toContain('!cellQuery.isSuccess')
    expect(controllerSource).not.toContain('acceptedByKey[rootQueryKeyFingerprintRef.current] = 0')
    expect(controllerSource).not.toContain('authorityLedger.root.sequence = Math.max')
    expect(controllerSource).not.toContain('fencedByProjectId')
    expect(controllerSource).not.toContain('authorityLedger.branch.issuedByKey[key] = (authorityLedger.branch.issuedByKey[key] ?? 0) + 1')
    expect(controllerSource).not.toContain('authorityLedger.cell.issuedByKey[key] = (authorityLedger.cell.issuedByKey[key] ?? 0) + 1')
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
