import { describe, expect, it } from 'vitest'

import type {
  BackboneDiffCellItemOut,
  BackboneDiffConditionItemOut,
  BackboneDiffCountsOut,
  BackboneDiffRootOut,
} from '@/api/backboneDiff'

import {
  announceBackboneDiffNavigation,
  clearBackboneDiffOpenScopes,
  createBackboneDiffWorkbenchState,
  openBackboneDiffBranch,
  openBackboneDiffCell,
  replaceBackboneDiffFilters,
  setBackboneDiffBranchPages,
  setBackboneDiffCellPages,
  type BackboneDiffCellPage,
  type BackboneDiffConditionPage,
  setBackboneDiffRootResult,
} from './backboneDiffState'

describe('backbone diff workbench state', () => {
  it('starts closed with deterministic normalized defaults', () => {
    const state = createBackboneDiffWorkbenchState()

    expect(state.mode).toBe('root')
    expect(state.revision).toBe(0)
    expect(state.rootScope).toBeNull()
    expect(state.rootBasisHash).toBeNull()
    expect(state.navigationAnnouncement).toBeNull()
    expect(state.filters).toEqual({
      classification: [],
      layerKey: null,
      categoryCode: null,
      parameterCode: null,
      includeUnchanged: false,
      previewLimit: 20,
    })
  })

  it('resets opened scopes and increments revision when filters change', () => {
    const withBranch = openBackboneDiffBranch(
      createBackboneDiffWorkbenchState(),
      'L1::10::ETCH',
      'branch-scope',
    )
    const withCell = openBackboneDiffCell(withBranch, 'L1::10::ETCH', 'ROW-1', 'cell-scope')

    const changed = replaceBackboneDiffFilters(withCell, {
      layerKey: 'L9::20::CORE',
      includeUnchanged: true,
      previewLimit: 10,
    })

    expect(changed.revision).toBe(withCell.revision + 1)
    expect(changed.mode).toBe('root')
    expect(changed.openLayerKey).toBeNull()
    expect(changed.branchScope).toBeNull()
    expect(changed.openCellLayerKey).toBeNull()
    expect(changed.openCellScope).toBeNull()
    expect(changed.branchPages).toEqual([])
    expect(changed.cellPages).toEqual([])
    expect(changed.filters.layerKey).toBe('L9::20::CORE')
    expect(changed.filters.includeUnchanged).toBe(true)
    expect(changed.filters.previewLimit).toBe(10)
  })

  it('clears all opened scopes while preserving filter state when root basis changes', () => {
    const sourceState = setBackboneDiffCellPages(
      setBackboneDiffBranchPages(
        openBackboneDiffCell(
          openBackboneDiffBranch(createBackboneDiffWorkbenchState(), 'L1::10::ETCH', 'branch-scope'),
          'L1::10::ETCH',
          'ROW-1',
          'cell-scope',
        ),
        [createConditionPage()],
        'branch-next',
      ),
      [createCellPage()],
      'cell-next',
    )

    const next = setBackboneDiffRootResult(sourceState, createRootOut({ scope: 'new-root', basis_hash: 'hash-2' }))

    expect(next.revision).toBe(sourceState.revision + 1)
    expect(next.mode).toBe('root')
    expect(next.openLayerKey).toBeNull()
    expect(next.branchScope).toBeNull()
    expect(next.openCellLayerKey).toBeNull()
    expect(next.openCellScope).toBeNull()
    expect(next.branchPages).toEqual([])
    expect(next.cellPages).toEqual([])
    expect(next.navigationAnnouncement).toBe('백본 비교 기준이 변경되어 새로고침합니다.')
    expect(next.rootScope).toBe('new-root')
    expect(next.rootBasisHash).toBe('hash-2')
    expect(next.filters).toEqual(sourceState.filters)
  })

  it('keeps root branch/cell scope untouched when root result is unchanged', () => {
    const loaded = setBackboneDiffRootResult(
      openBackboneDiffBranch(
        setBackboneDiffRootResult(createBackboneDiffWorkbenchState(), createRootOut()),
        'L1::10::ETCH',
        'branch-scope',
      ),
      createRootOut(),
    )

    const unchanged = setBackboneDiffRootResult(loaded, createRootOut())

    expect(unchanged).toMatchObject({
      openLayerKey: 'L1::10::ETCH',
      branchScope: 'branch-scope',
      openCellLayerKey: null,
      openCellScope: null,
      revision: loaded.revision,
      layerSummaries: loaded.layerSummaries,
      previewItems: loaded.previewItems,
      rootScope: loaded.rootScope,
      rootBasisHash: loaded.rootBasisHash,
    })
  })

  it('announces and clears navigation and open scopes with stable equality when unchanged', () => {
    const announced = announceBackboneDiffNavigation(
      createBackboneDiffWorkbenchState(),
      '백본 비교 기준이 변경되어 새로고침합니다.',
    )

    const stable = announceBackboneDiffNavigation(
      announced,
      '백본 비교 기준이 변경되어 새로고침합니다.',
    )
    expect(stable).toBe(announced)

    const cleared = clearBackboneDiffOpenScopes(
      openBackboneDiffCell(
        openBackboneDiffBranch(createBackboneDiffWorkbenchState(), 'L1::10::ETCH', 'branch-scope'),
        'L1::10::ETCH',
        'R1',
        'cell-scope',
      ),
    )

    expect(cleared.mode).toBe('root')
    expect(cleared.openLayerKey).toBeNull()
    expect(cleared.openCellLayerKey).toBeNull()
    expect(cleared.branchPages).toEqual([])
    expect(cleared.cellPages).toEqual([])

    const clearedAgain = clearBackboneDiffOpenScopes(cleared)
    expect(clearedAgain).toBe(cleared)
  })
})

function createRootOut(overrides: Partial<BackboneDiffRootOut> = {}): BackboneDiffRootOut {
  return {
    scope: 'scope-root',
    basis_hash: 'hash-1',
    counts: createCounts(),
    layer_summaries: [],
    changed_preview: [],
    ...overrides,
  }
}

function createCounts(overrides: Partial<BackboneDiffCountsOut> = {}): BackboneDiffCountsOut {
  return {
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
    ...overrides,
  }
}

function createConditionPage(): BackboneDiffConditionPage {
  return {
    items: [
      {
        row_ref: 'R1',
        row_status: 'added',
        effective_condition_index: 1,
        identity: 10,
        baseline_condition: null,
        current_condition: null,
        row_metadata: {
          label_changed: false,
          index_changed: false,
          por_changed: false,
        },
        filtered_cell_count: 0,
        full_cell_count: 0,
        jump_status: 'deleted',
        cell_scope: null,
      } as BackboneDiffConditionItemOut,
    ],
    nextCursor: null,
  }
}

function createCellPage(): BackboneDiffCellPage {
  return {
    items: [
      {
        classification: 'added',
        reason: 'init',
        parameter_code: 'P1',
        parameter_sort: 1,
        baseline_value: null,
        current_value: 'X',
        baseline_metadata: null,
        current_metadata: null,
        jump_status: 'deleted',
      } as BackboneDiffCellItemOut,
    ],
    nextCursor: null,
  }
}
