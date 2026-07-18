import { describe, expect, it } from 'vitest'

import type {
  BackboneDiffCellItemOut,
  BackboneDiffConditionItemOut,
  BackboneDiffCountsOut,
  BackboneDiffLayerSummaryOut,
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
    const sourceWithOpenedScope = setBackboneDiffCellPages(
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
    const sourceState = setBackboneDiffRootResult(
      sourceWithOpenedScope,
      createRootOut({ scope: 'root-s', basis_hash: 'hash-1' }),
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

  it('does not announce when first root value lands from null scope', () => {
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

    const next = setBackboneDiffRootResult(sourceState, createRootOut())

    expect(next.revision).toBe(sourceState.revision + 1)
    expect(next.mode).toBe('root')
    expect(next.openLayerKey).toBeNull()
    expect(next.branchScope).toBeNull()
    expect(next.openCellLayerKey).toBeNull()
    expect(next.openCellScope).toBeNull()
    expect(next.branchPages).toEqual([])
    expect(next.cellPages).toEqual([])
    expect(next.navigationAnnouncement).toBeNull()
    expect(next.rootScope).toBe('scope-root')
    expect(next.rootBasisHash).toBe('hash-1')
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

  it('does not republish root result when scope/basis and result payload references are identical', () => {
    const rootOut = createRootOut()
    const loaded = setBackboneDiffRootResult(createBackboneDiffWorkbenchState(), rootOut)
    const same = setBackboneDiffRootResult(loaded, rootOut)

    expect(same).toBe(loaded)
  })

  it('updates root payload when same scope/basis arrives with changed references', () => {
    const payload = createRootOut()
    const loaded = setBackboneDiffRootResult(createBackboneDiffWorkbenchState(), payload)
    const mutated = setBackboneDiffRootResult(
      loaded,
      {
        ...payload,
        counts: {
          ...payload.counts,
          changed_count: 1,
        },
        layer_summaries: [
          {
            layer_key: 'new-layer',
            layer_sort: 1,
            layer_status: 'available',
            baseline_condition_count: 0,
            current_condition_count: 0,
            row_count: 1,
            cell_count: 1,
            full_row_count: 0,
            full_cell_count: 0,
            ambiguous_lineage_count: 0,
            changed_count: 0,
            branch_scope: null,
          } as BackboneDiffLayerSummaryOut,
        ],
        changed_preview: [],
      },
    )

    expect(mutated).not.toBe(loaded)
    expect(mutated).toMatchObject({
      rootScope: payload.scope,
      rootBasisHash: payload.basis_hash,
      rootCounts: {
        changed_count: 1,
      },
      revision: loaded.revision,
      layerSummaries: [
        {
          layer_key: 'new-layer',
        },
      ],
      previewItems: [],
    })
  })

  it('does not announce on the first root load from empty scope', () => {
    const loaded = setBackboneDiffRootResult(createBackboneDiffWorkbenchState(), createRootOut())
    expect(loaded.navigationAnnouncement).toBeNull()
  })

  it('re-emits basis change announcement after explicit clear', () => {
    const initial = setBackboneDiffRootResult(createBackboneDiffWorkbenchState(), createRootOut({ basis_hash: 'hash-1' }))
    const firstChange = setBackboneDiffRootResult(initial, createRootOut({ basis_hash: 'hash-2' }))

    expect(firstChange.navigationAnnouncement).toBe('백본 비교 기준이 변경되어 새로고침합니다.')

    const cleared = announceBackboneDiffNavigation(
      firstChange,
      null,
    )
    const secondChange = setBackboneDiffRootResult(
      cleared,
      createRootOut({ basis_hash: 'hash-3' }),
    )

    expect(secondChange.navigationAnnouncement).toBe('백본 비교 기준이 변경되어 새로고침합니다.')
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

  it('does not republish branch pages when cursor and page array reference are unchanged', () => {
    const openBranch = openBackboneDiffBranch(createBackboneDiffWorkbenchState(), 'L1::10::ETCH', 'branch-scope')
    const branchPage = createConditionPageOut({
      row_ref: 'row-1',
      row_status: 'added',
    })
    const loaded = setBackboneDiffBranchPages(openBranch, [branchPage], 'cursor-1')
    const same = setBackboneDiffBranchPages(loaded, loaded.branchPages, 'cursor-1')

    expect(same).toBe(loaded)
  })

  it('updates branch pages when cursor matches but payload is new', () => {
    const openBranch = openBackboneDiffBranch(createBackboneDiffWorkbenchState(), 'L1::10::ETCH', 'branch-scope')
    const firstPages = [
      createConditionPageOut({
        row_ref: 'row-1',
        row_status: 'added',
      }),
    ] as readonly BackboneDiffConditionPage[]
    const loaded = setBackboneDiffBranchPages(openBranch, firstPages, 'cursor-1')
    const nextPages: readonly BackboneDiffConditionPage[] = [
      {
        ...firstPages[0],
        items: [
          {
            ...firstPages[0].items[0],
            row_status: 'removed',
          },
        ],
      },
    ]

    const changed = setBackboneDiffBranchPages(loaded, nextPages, 'cursor-1')

    expect(changed).not.toBe(loaded)
    expect(changed.branchPages[0]?.items[0]?.row_status).toBe('removed')
  })

  it('does not republish cell pages when cursor and page array reference are unchanged', () => {
    const openCell = openBackboneDiffCell(
      openBackboneDiffBranch(createBackboneDiffWorkbenchState(), 'L1::10::ETCH', 'branch-scope'),
      'L1::10::ETCH',
      'row-1',
      'cell-scope',
    )
    const cellPage = createCellPageOut({
      parameter_code: 'param-1',
      classification: 'added',
    })
    const loaded = setBackboneDiffCellPages(openCell, [cellPage], 'cell-cursor-1')
    const same = setBackboneDiffCellPages(loaded, loaded.cellPages, 'cell-cursor-1')

    expect(same).toBe(loaded)
  })

  it('updates cell pages when cursor matches but payload is new', () => {
    const openCell = openBackboneDiffCell(
      openBackboneDiffBranch(createBackboneDiffWorkbenchState(), 'L1::10::ETCH', 'branch-scope'),
      'L1::10::ETCH',
      'row-1',
      'cell-scope',
    )
    const firstPages = [
      createCellPageOut({
        parameter_code: 'param-1',
        classification: 'added',
      }),
    ] as readonly BackboneDiffCellPage[]
    const loaded = setBackboneDiffCellPages(openCell, firstPages, 'cell-cursor-1')
    const nextPages: readonly BackboneDiffCellPage[] = [
      {
        ...firstPages[0],
        items: [
          {
            ...firstPages[0].items[0],
            jump_status: 'available',
          },
        ],
      },
    ]

    const changed = setBackboneDiffCellPages(loaded, nextPages, 'cell-cursor-1')

    expect(changed).not.toBe(loaded)
    expect(changed.cellPages[0]?.items[0]?.jump_status).toBe('available')
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

function createConditionPageOut(
  partial: Partial<BackboneDiffConditionItemOut> = {},
): BackboneDiffConditionPage {
  return {
    items: [
      {
        row_ref: partial.row_ref ?? 'row-1',
        row_status: partial.row_status ?? 'added',
        effective_condition_index: partial.effective_condition_index ?? 1,
        identity: partial.identity ?? 1,
        baseline_condition: null,
        current_condition: null,
        row_metadata: {
          label_changed: partial.row_metadata?.label_changed ?? false,
          index_changed: partial.row_metadata?.index_changed ?? false,
          por_changed: partial.row_metadata?.por_changed ?? false,
        },
        filtered_cell_count: partial.filtered_cell_count ?? 0,
        full_cell_count: partial.full_cell_count ?? 0,
        jump_status: partial.jump_status ?? 'available',
        cell_scope: partial.cell_scope ?? null,
      } as BackboneDiffConditionItemOut,
    ],
    nextCursor: null,
  }
}

function createCellPageOut(
  partial: Omit<Partial<BackboneDiffCellItemOut>, 'row_ref'> = {},
): BackboneDiffCellPage {
  return {
    items: [
      {
        classification: partial.classification ?? 'added',
        reason: 'init',
        parameter_code: partial.parameter_code ?? 'param-1',
        parameter_sort: partial.parameter_sort ?? 1,
        baseline_value: partial.baseline_value ?? null,
        current_value: partial.current_value ?? 'X',
        baseline_metadata: null,
        current_metadata: null,
        jump_status: partial.jump_status ?? 'deleted',
      } as BackboneDiffCellItemOut,
    ],
    nextCursor: null,
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
