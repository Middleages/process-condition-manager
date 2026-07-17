import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  BackboneDiffWorkbench,
  activateBackboneJumpTarget,
  type BackboneDiffCellItem,
  type BackboneDiffConditionItem,
  type BackboneDiffPreviewItem,
  type BackboneDiffFilter,
  type BackboneDiffRoot,
  type PreviewState,
} from './BackboneDiffWorkbench'
import source from './BackboneDiffWorkbench.tsx?raw'

function createBaseFilter(): BackboneDiffFilter {
  return {
    classification: ['added', 'changed'],
    layerKey: '',
    categoryCode: '',
    parameterCode: '',
    includeUnchanged: false,
  }
}

function createCounts() {
  return {
    layerCount: 1,
    availableLayerCount: 1,
    unavailableLayerCount: 0,
    rowCount: 1,
    cellCount: 2,
    fullRowCount: 3,
    fullCellCount: 4,
    ambiguousLineageCount: 0,
    addedCount: 1,
    changedCount: 1,
    clearedCount: 0,
    removedCount: 0,
    unchangedCount: 0,
  }
}

function createRootData(): BackboneDiffRoot {
  return {
    scope: 'scope-root',
    basisHash: 'basis-1',
    counts: createCounts(),
    changedPreview: [
      {
        itemKind: 'row',
        classification: 'added',
        layerKey: 'L1::10::ETCH',
        effectiveConditionIndex: 1,
        itemSortKey: ['cell-01'],
        rowRef: 'row-1',
        cellScope: null,
        rowStatus: 'added',
        parameterCode: null,
      },
      {
        itemKind: 'cell',
        classification: 'changed',
        layerKey: 'L1::10::ETCH',
        effectiveConditionIndex: 2,
        itemSortKey: ['cell-02', 2],
        rowRef: 'row-2',
        cellScope: 'cell-scope',
        rowStatus: null,
        parameterCode: 'ETCH_P002',
      },
    ],
    layerSummaries: [
      {
        layerKey: 'L1::10::ETCH',
        layerStatus: 'available',
        baselineConditionCount: 2,
        currentConditionCount: 2,
        rowCount: 1,
        cellCount: 2,
        fullRowCount: 1,
        fullCellCount: 2,
        ambiguousLineageCount: 0,
        changedCount: 2,
      },
    ],
  }
}

function createPreviewState(): PreviewState<{
  readonly itemKind: 'row' | 'cell'
  readonly classification: 'added' | 'changed' | 'cleared' | 'removed' | 'unchanged'
  readonly layerKey: string
  readonly effectiveConditionIndex: number
  readonly itemSortKey: readonly (string | number | null)[]
  readonly rowRef: string | null
  readonly cellScope: string | null
  readonly rowStatus?: 'added' | 'changed' | 'cleared' | 'removed' | 'unchanged' | null
  readonly parameterCode?: string | null
}> {
  return {
    status: 'ready',
    items: [],
    nextCursor: null,
    error: null,
    nextPageError: null,
  }
}

function createCondition(): BackboneDiffConditionItem {
  return {
    rowRef: 'row-1',
    rowStatus: 'matched',
    effectiveConditionIndex: 1,
    identity: 101,
    baselineCondition: {
      conditionId: 10,
      sourceConditionId: 20,
      label: 'baseline',
      conditionIndex: 1,
      isPor: true,
    },
    currentCondition: {
      conditionId: 11,
      sourceConditionId: 21,
      label: 'current',
      conditionIndex: 1,
      isPor: true,
    },
    filteredCellCount: 2,
    fullCellCount: 2,
    jumpStatus: 'available',
    cellScope: 'scope-row-1',
    rowMetadata: {
      labelChanged: true,
      indexChanged: true,
      porChanged: true,
    },
  }
}

function createCell(): BackboneDiffCellItem {
  return {
    classification: 'changed',
    reason: 'value diff',
    parameterCode: 'ETCH_P001',
    parameterSort: 1,
    baselineValue: '10',
    currentValue: '20',
    jumpStatus: 'available',
  }
}

function createPreviewStaticMarkup(root: BackboneDiffRoot, preview: PreviewState<
  {
    readonly itemKind: 'row' | 'cell'
    readonly classification: 'added' | 'changed' | 'cleared' | 'removed' | 'unchanged'
    readonly layerKey: string
    readonly effectiveConditionIndex: number
    readonly itemSortKey: readonly (string | number | null)[]
    readonly rowRef: string | null
    readonly cellScope: string | null
    readonly rowStatus?: 'added' | 'changed' | 'cleared' | 'removed' | 'unchanged' | null
    readonly parameterCode?: string | null
  }
>) {
  return renderToStaticMarkup(
    <BackboneDiffWorkbench
      root={root}
      rootStatus="ready"
      rootError={null}
      onRetryRoot={vi.fn()}
      onRefreshAnnouncementReset={vi.fn()}
      refreshAnnouncement={null}
      filters={createBaseFilter()}
      onFiltersChange={vi.fn()}
      preview={preview}
      onLoadMorePreview={vi.fn()}
      onRetry={vi.fn()}
      layerConditionBranches={{}}
      onOpenLayer={vi.fn()}
      onLoadMoreConditions={vi.fn()}
      onRetryConditions={vi.fn()}
      cellBranches={{}}
      onOpenCells={vi.fn()}
      onLoadMoreCells={vi.fn()}
      onRetryCells={vi.fn()}
      onActivateTarget={vi.fn()}
      baselineUnavailableCopy={null}
    />,
  )
}

function nextFilterByClassification(current: BackboneDiffFilter, target: typeof current.classification[number], checked: boolean) {
  const next = new Set(current.classification)
  if (checked) {
    next.add(target)
  } else {
    next.delete(target)
  }
  const includeUnchanged =
    target === 'unchanged' ? checked : current.includeUnchanged

  return {
    ...current,
    classification: [...next],
    includeUnchanged,
  }
}

function nextFilterByIncludeUnchanged(current: BackboneDiffFilter, includeUnchanged: boolean) {
  const next = new Set(current.classification)
  if (!includeUnchanged) {
    next.delete('unchanged')
  }
  return {
    ...current,
    includeUnchanged,
    classification: [...next],
  }
}

describe('BackboneDiffWorkbench', () => {
  it('renders compact summary/filter/preview and baseline unavailable copy', () => {
    const root = createRootData()
    const html = renderToStaticMarkup(
      <BackboneDiffWorkbench
        root={root}
        rootStatus="ready"
        rootError={null}
        onRetryRoot={vi.fn()}
        onRefreshAnnouncementReset={vi.fn()}
        refreshAnnouncement={null}
        filters={createBaseFilter()}
        onFiltersChange={vi.fn()}
        preview={{ ...createPreviewState(), items: root.changedPreview }}
        onLoadMorePreview={vi.fn()}
        onRetry={vi.fn()}
        layerConditionBranches={{}}
        onOpenLayer={vi.fn()}
        onLoadMoreConditions={vi.fn()}
        onRetryConditions={vi.fn()}
        cellBranches={{}}
        onOpenCells={vi.fn()}
        onLoadMoreCells={vi.fn()}
        onRetryCells={vi.fn()}
        onActivateTarget={vi.fn()}
        baselineUnavailableCopy="baseline is unavailable for one deleted layer"
      />,
    )

    expect(html).toContain('aria-label="백본 비교 워크벤치"')
    expect(html).toContain('변경 레이어')
    expect(html).toContain('변경 미리보기')
    expect(html).toContain('L1::10::ETCH')
    expect(html).toContain('baseline is unavailable for one deleted layer')
    expect(html).toContain('classification')
    expect(html).toContain('#1')
    expect(html).toContain('비움 <strong>0</strong>')
  })

  it('renders root and preview errors with retry actions', () => {
    const html = renderToStaticMarkup(
      <BackboneDiffWorkbench
        root={null}
        rootStatus="error"
        rootError="루트 조회 실패"
        onRetryRoot={vi.fn()}
        onRefreshAnnouncementReset={vi.fn()}
        refreshAnnouncement={null}
        filters={createBaseFilter()}
        onFiltersChange={vi.fn()}
        preview={{ ...createPreviewState(), status: 'error', error: '미리보기 조회 실패' }}
        onLoadMorePreview={vi.fn()}
        onRetry={vi.fn()}
        layerConditionBranches={{}}
        onOpenLayer={vi.fn()}
        onLoadMoreConditions={vi.fn()}
        onRetryConditions={vi.fn()}
        cellBranches={{}}
        onOpenCells={vi.fn()}
        onLoadMoreCells={vi.fn()}
        onRetryCells={vi.fn()}
        onActivateTarget={vi.fn()}
        baselineUnavailableCopy={null}
      />,
    )

    expect(html).toContain('루트 조회 실패')
    expect(html).toContain('루트 다시 시도')
    expect(html).toContain('미리보기 조회 실패')
    expect(html).toContain('미리보기 다시 시도')
  })

  it('keeps disclosure transition contract for layers and rows without DOM execution', () => {
    const openThenClose = (current: string | null, next: string) => {
      return current === next ? null : next
    }

    expect(openThenClose(null, 'L1::10::ETCH')).toEqual('L1::10::ETCH')
    expect(openThenClose('L1::10::ETCH', 'L1::10::ETCH')).toEqual(null)
    expect(openThenClose('L1::10::ETCH', 'L1::20::ETCH')).toEqual('L1::20::ETCH')
    expect(openThenClose('row-1', 'row-1')).toEqual(null)
    expect(openThenClose('row-2', 'row-1')).toEqual('row-1')

    expect(source).toContain('setExpandedLayerKey((current) => {')
    expect(source).toContain('if (current === layerKey) {')
    expect(source).toContain("if (layer.layerStatus === 'available' || isExpanded) {")
    expect(source).toContain('if (layerConditionBranches[layerKey] === undefined) {')
    expect(source).toContain('onOpenLayer(layerKey)')
    expect(source).toContain('onCloseBranch?.(current)')

    expect(source).toContain('setExpandedRowRef((current) => {')
    expect(source).toContain('if (current === rowRef) {')
    expect(source).toContain('if (!scopeAvailable && expandedRowRef !== rowRef) {')
    expect(source).toContain('if (cellBranches[rowRef] === undefined) {')
    expect(source).toContain('onOpenCells(rowRef)')
  })

  it('prevents preview key collisions by including kind/status/index and optional payload fields', () => {
    const html = createPreviewStaticMarkup(createRootData(), {
      ...createPreviewState(),
      items: [
        {
          itemKind: 'row',
          classification: 'added',
          layerKey: 'L1::10::ETCH',
          effectiveConditionIndex: 1,
          itemSortKey: ['shared'],
          rowRef: 'row-1',
          cellScope: null,
          rowStatus: 'added',
          parameterCode: null,
        },
        {
          itemKind: 'cell',
          classification: 'added',
          layerKey: 'L1::10::ETCH',
          effectiveConditionIndex: 1,
          itemSortKey: ['shared'],
          rowRef: 'row-1',
          cellScope: null,
          rowStatus: 'added',
          parameterCode: 'ETCH_P001',
        },
      ],
      nextCursor: null,
      status: 'ready',
    })

    expect(html).toContain('L1::10::ETCH')
    expect(source).toContain('item.itemKind')
    expect(source).toContain('item.effectiveConditionIndex')
    expect(source).toContain('item.rowRef ??')
    expect(source).toContain('item.parameterCode ??')
    expect(html).toContain('파라미터: ETCH_P001')
    expect(html).toContain('상태: added')
  })

  it('dispatches activation through one callback and blocks unavailable targets', () => {
    const onActivateTarget = vi.fn()

    const activated = activateBackboneJumpTarget(
      {
        kind: 'condition',
        layerKey: 'L1::10::ETCH',
        classification: 'changed',
        jumpStatus: 'available',
        rowRef: 'row-1',
        conditionId: 11,
        parameterCode: 'ETCH_P001',
        sourceConditionId: null,
      },
      onActivateTarget,
    )
    expect(activated).toBe(true)
    expect(onActivateTarget).toHaveBeenCalledOnce()

    const unchangedAvailable = activateBackboneJumpTarget(
      {
        kind: 'cell',
        layerKey: 'L1::10::ETCH',
        classification: 'unchanged',
        jumpStatus: 'available',
        rowRef: 'row-1',
        conditionId: 11,
        parameterCode: 'ETCH_P001',
        sourceConditionId: null,
      },
      onActivateTarget,
    )
    expect(unchangedAvailable).toBe(true)
    expect(onActivateTarget).toHaveBeenCalledTimes(2)

    const deletedBlocked = activateBackboneJumpTarget(
      {
        kind: 'cell',
        layerKey: 'L1::10::ETCH',
        classification: 'changed',
        jumpStatus: 'deleted',
        rowRef: 'row-1',
        conditionId: 11,
        parameterCode: 'ETCH_P001',
        sourceConditionId: null,
      },
      onActivateTarget,
    )
    expect(deletedBlocked).toBe(false)
    expect(onActivateTarget).toHaveBeenCalledTimes(1)

    const conditionNavigationBlocked = activateBackboneJumpTarget(
      {
        kind: 'condition',
        layerKey: 'L1::10::ETCH',
        classification: 'changed',
        jumpStatus: 'available',
        rowRef: 'row-1',
        conditionId: 11,
        parameterCode: null,
        sourceConditionId: null,
      },
      onActivateTarget,
    )
    expect(conditionNavigationBlocked).toBe(false)

    const removedBlocked = activateBackboneJumpTarget(
      {
        kind: 'cell',
        layerKey: 'L1::10::ETCH',
        classification: 'removed',
        jumpStatus: 'available',
        rowRef: 'row-1',
        conditionId: 11,
        parameterCode: 'ETCH_P001',
        sourceConditionId: null,
      },
      onActivateTarget,
    )
    expect(removedBlocked).toBe(false)
    expect(onActivateTarget).toHaveBeenCalledTimes(2)
  })

  it('documents disabled jump target labels in source-contract and SSR visibility', () => {
    const html = renderToStaticMarkup(
      <BackboneDiffWorkbench
        root={createRootData()}
        rootStatus="ready"
        rootError={null}
        onRetryRoot={vi.fn()}
        onRefreshAnnouncementReset={vi.fn()}
        refreshAnnouncement={null}
        filters={createBaseFilter()}
        onFiltersChange={vi.fn()}
        preview={createPreviewState()}
        onLoadMorePreview={vi.fn()}
        onRetry={vi.fn()}
        layerConditionBranches={{
          'L1::10::ETCH': {
            status: 'ready',
            basisHash: 'scope-1',
            scope: 'scope-1',
            items: [
              {
                ...createCondition(),
                rowStatus: 'removed',
                jumpStatus: 'deleted',
              },
            ],
            nextCursor: null,
            error: null,
            nextPageError: null,
          },
        }}
        onOpenLayer={vi.fn()}
        onLoadMoreConditions={vi.fn()}
        onRetryConditions={vi.fn()}
        cellBranches={{
          'row-1': {
            status: 'ready',
            basisHash: 'scope-1',
            scope: 'scope-1',
            items: [
              {
                ...createCell(),
                classification: 'removed',
                jumpStatus: 'available',
              },
              {
                ...createCell(),
                classification: 'changed',
                jumpStatus: 'deleted',
                parameterCode: 'ETCH_P002',
              },
            ],
            nextCursor: null,
            error: null,
            nextPageError: null,
          },
        }}
        onOpenCells={vi.fn()}
        onLoadMoreCells={vi.fn()}
        onRetryCells={vi.fn()}
        onActivateTarget={vi.fn()}
        baselineUnavailableCopy={null}
      />,
    )

    expect(source).toContain('activationStatusFor({')
    expect(source).toContain('제거됨')
    expect(source).toContain('삭제됨')
    expect(html).toContain('L1::10::ETCH')
    expect(source).toContain('조건 인덱스')
    expect(source).toContain('POR')
    expect(source).toContain('hasConditionNavigation')
    expect(source).toContain('if (!hasConditionNavigation && !isRowExpanded)')
  })

  it('hides implementation refs from preview UI rendering', () => {
    const root = createRootData()

    const html = createPreviewStaticMarkup(root, {
      ...createPreviewState(),
      items: [
        {
          itemKind: 'cell',
          classification: 'changed',
          layerKey: 'L1::10::ETCH',
          effectiveConditionIndex: 3,
          itemSortKey: ['secret'],
          rowRef: 'row-secret',
          cellScope: 'secret-scope',
          rowStatus: 'matched',
          parameterCode: 'ETCH_P999',
        },
      ],
      status: 'ready',
      nextCursor: null,
      error: null,
      nextPageError: null,
    })

    expect(html).toContain('L1::10::ETCH')
    expect(html).not.toContain('row-secret')
    expect(html).not.toContain('secret-scope')
    expect(html).toContain('상태: matched')
    expect(html).toContain('파라미터: ETCH_P999')
  })

  it('marks unavailable rows when row-level navigation parameters are missing', () => {
    renderToStaticMarkup(
      <BackboneDiffWorkbench
        root={createRootData()}
        rootStatus="ready"
        rootError={null}
        onRetryRoot={vi.fn()}
        onRefreshAnnouncementReset={vi.fn()}
        refreshAnnouncement={null}
        filters={createBaseFilter()}
        onFiltersChange={vi.fn()}
        preview={createPreviewState()}
        onLoadMorePreview={vi.fn()}
        onRetry={vi.fn()}
        layerConditionBranches={{
          'L1::10::ETCH': {
            status: 'ready',
            basisHash: 'scope-1',
            scope: 'scope-1',
            items: [
              {
                ...createCondition(),
                baselineCondition: null,
                currentCondition: null,
              },
            ],
            nextCursor: null,
            error: null,
            nextPageError: null,
          },
        }}
        onOpenLayer={vi.fn()}
        onLoadMoreConditions={vi.fn()}
        onRetryConditions={vi.fn()}
        cellBranches={{
          'row-1': {
            status: 'ready',
            basisHash: 'scope-1',
            scope: 'scope-1',
            items: [
              {
                ...createCell(),
                jumpStatus: 'available',
              },
            ],
            nextCursor: null,
            error: null,
            nextPageError: null,
          },
        }}
        onOpenCells={vi.fn()}
        onLoadMoreCells={vi.fn()}
        onRetryCells={vi.fn()}
        onActivateTarget={vi.fn()}
        baselineUnavailableCopy={null}
      />,
    )

    expect(source).toContain('baselineToCurrentLabel')
    expect(source).toContain('baselineToCurrentIndex')
    expect(source).toContain('baselineToCurrentPor')
    expect(source).toContain('hasConditionNavigation')
  })

  it('keeps preview rows visible during loading and error states', () => {
    const root = createRootData()
    const item = root.changedPreview[0]

    const ready = createPreviewStaticMarkup(root, {
      ...createPreviewState(),
      status: 'ready',
      items: [item],
      nextCursor: 'cursor-2',
    })
    const loading = createPreviewStaticMarkup(root, {
      ...createPreviewState(),
      status: 'loading',
      items: [item],
      nextCursor: 'cursor-2',
    })
    const error = createPreviewStaticMarkup(root, {
      ...createPreviewState(),
      status: 'error',
      items: [item],
      nextCursor: 'cursor-2',
      error: '오류 메시지',
    })

    expect(ready).toContain('L1::10::ETCH')
    expect(loading).toContain('L1::10::ETCH')
    expect(error).toContain('L1::10::ETCH')
    expect(error).toContain('오류 메시지')
    expect(ready).toContain('더 보기')
  })

  it('computes filter transitions as pure contracts without DOM events', () => {
    const base = createBaseFilter()

    const includedUnchanged = nextFilterByClassification(base, 'unchanged', true)
    expect(includedUnchanged).toEqual({
      ...base,
      classification: ['added', 'changed', 'unchanged'],
      includeUnchanged: true,
    })

    const removedChecked = nextFilterByClassification(
      { ...base, classification: ['added', 'changed', 'unchanged'], includeUnchanged: true },
      'unchanged',
      false,
    )
    expect(removedChecked).toEqual({
      ...base,
      classification: ['added', 'changed'],
      includeUnchanged: false,
    })

    const includeUnchecked = nextFilterByIncludeUnchanged(base, true)
    expect(includeUnchecked).toEqual({
      ...base,
      includeUnchanged: true,
      classification: ['added', 'changed'],
    })

    const includeUncheckedFalse = nextFilterByIncludeUnchanged(
      { ...base, classification: ['added', 'changed', 'unchanged', 'removed'] },
      false,
    )
    expect(includeUncheckedFalse.classification).toEqual([
      'added',
      'changed',
      'removed',
    ])

    const includeDefaulted = nextFilterByIncludeUnchanged({ ...base, classification: [] }, true)
    expect(includeDefaulted).toEqual({
      ...base,
      includeUnchanged: true,
      classification: [],
    })

    expect(source).toContain('handleClassificationToggle')
    expect(source).toContain('handleIncludeUnchanged')
    expect(source).toContain('checked={filters.includeUnchanged}')
    expect(source).toContain('onChange={(event) => handleClassificationToggle(classification, event.currentTarget.checked)}')
  })
})
