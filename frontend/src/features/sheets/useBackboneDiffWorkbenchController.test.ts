import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

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
  mergeBackboneDiffConditionPages,
  mergeBackboneDiffCellPages,
  mergeBackboneDiffRootPages,
  clearBackboneDiffBranchAndCellQueries,
  shouldHandleDiffBasisChangedQueryError,
} from './useBackboneDiffWorkbenchController'
import { type BackboneDiffWorkbenchMode, type BackboneDiffWorkbenchState } from './backboneDiffState'

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

  it('only handles basis-change errors once per observed failure count and only after reset', () => {
    const basisError = {
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

    const nonBasisError = { response: { status: 409, data: { code: 'other' } } } as const
    expect(
      shouldHandleDiffBasisChangedQueryError({
        error: nonBasisError,
        isError: true,
        failureCount: 1,
        previousFailureCount: 0,
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
