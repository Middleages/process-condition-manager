/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  BackboneDiffWorkbench,
  activateBackboneJumpTarget,
  type BackboneDiffCellItem,
  type BackboneDiffConditionItem,
  type BackboneDiffFilter,
  type BackboneDiffRoot,
  type BackboneDiffWorkbenchProps,
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
      },
      {
        itemKind: 'cell',
        classification: 'changed',
        layerKey: 'L1::10::ETCH',
        effectiveConditionIndex: 2,
        itemSortKey: ['cell-02', 2],
        rowRef: 'row-2',
        cellScope: 'cell-scope',
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

function createPreviewState(): PreviewState<{ readonly itemKind: 'row' | 'cell'; readonly classification: 'added' | 'changed' | 'cleared' | 'removed' | 'unchanged'; readonly layerKey: string; readonly effectiveConditionIndex: number; readonly itemSortKey: readonly (string | number | null)[]; readonly rowRef: string | null; readonly cellScope: string | null }> {
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
    rowStatus: 'changed',
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
    expect(html).toContain('변경 미리보기')
    expect(html).toContain('unchanged')
    expect(html).toContain('#1')
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

  it('keeps lazy-open disclosure state and invokes one fetch callback per branch open', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const onOpenLayer = vi.fn()
    const onOpenCells = vi.fn()
    const onLoadMoreConditions = vi.fn()
    const onLoadMoreCells = vi.fn()

    const staticProps: Omit<
      BackboneDiffWorkbenchProps,
      'root' | 'preview' | 'layerConditionBranches' | 'cellBranches'
    > = {
      rootStatus: 'ready',
      rootError: null,
      onRetryRoot: vi.fn(),
      onRefreshAnnouncementReset: vi.fn(),
      refreshAnnouncement: null,
      filters: createBaseFilter(),
      onFiltersChange: vi.fn(),
      onLoadMorePreview: vi.fn(),
      onRetry: vi.fn(),
      onOpenLayer,
      onLoadMoreConditions,
      onRetryConditions: vi.fn(),
      onOpenCells,
      onLoadMoreCells,
      onRetryCells: vi.fn(),
      onActivateTarget: vi.fn(),
      baselineUnavailableCopy: null,
    }

    const rootData = createRootData()

    act(() => {
      root.render(
        <BackboneDiffWorkbench
          {...staticProps}
          root={rootData}
          preview={createPreviewState()}
          layerConditionBranches={{}}
          cellBranches={{}}
        />,
      )
    })

    const expandLayer = Array.from(container.querySelectorAll('button[type="button"]')).find(
      (button) => button.textContent === '열기',
    )
    expect(expandLayer).not.toBeNull()
    act(() => {
      expandLayer?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onOpenLayer).toHaveBeenCalledOnce()

    act(() => {
      root.render(
        <BackboneDiffWorkbench
          {...staticProps}
          root={rootData}
          preview={createPreviewState()}
          layerConditionBranches={{
            'L1::10::ETCH': {
              status: 'ready',
              basisHash: 'scope-1',
              scope: 'scope-1',
              items: [createCondition()],
              nextCursor: 'condition-cursor',
              error: null,
              nextPageError: null,
            },
          }}
          cellBranches={{
            'row-1': {
              status: 'ready',
              basisHash: 'scope-1',
              scope: 'scope-1',
              items: [createCell()],
              nextCursor: 'cell-cursor',
              error: null,
              nextPageError: null,
            },
          }}
        />,
      )
    })

    expect(container.textContent).toContain('condition #1')

    const expandRow = Array.from(container.querySelectorAll('button[type="button"]')).find((button) => {
      return button.textContent === '셀 보기'
    })
    expect(expandRow).not.toBeNull()

    act(() => {
      expandRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    act(() => {
      root.render(
        <BackboneDiffWorkbench
          {...staticProps}
          root={rootData}
          preview={createPreviewState()}
          layerConditionBranches={{
            'L1::10::ETCH': {
              status: 'ready',
              basisHash: 'scope-1',
              scope: 'scope-1',
              items: [createCondition()],
              nextCursor: 'condition-cursor',
              error: null,
              nextPageError: null,
            },
          }}
          cellBranches={{
            'row-1': {
              status: 'ready',
              basisHash: 'scope-1',
              scope: 'scope-1',
              items: [createCell()],
              nextCursor: 'cell-cursor',
              error: null,
              nextPageError: null,
            },
          }}
        />,
      )
    })
    expect(container.textContent).toContain('ETCH_P001')

    expect(container.textContent).toContain('더 보기')

    expect(container.textContent).toContain('condition #1')
    expect(container.textContent).toContain('ETCH_P001')

    act(() => {
      root.unmount()
    })
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
        parameterCode: null,
        sourceConditionId: null,
      },
      onActivateTarget,
    )
    expect(activated).toBe(true)
    expect(onActivateTarget).toHaveBeenCalledOnce()

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
    expect(onActivateTarget).toHaveBeenCalledOnce()
  })

  it('marks removed/deleted jump targets as disabled labels in markup', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const rootRender = createRoot(container)

    const onOpenLayer = vi.fn()
    const onActivateTarget = vi.fn()

    act(() => {
      rootRender.render(
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
          onOpenLayer={onOpenLayer}
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
          onActivateTarget={onActivateTarget}
          baselineUnavailableCopy={null}
        />,
      )
    })

    const expandLayer = Array.from(container.querySelectorAll('button[type="button"]')).find(
      (button) => button.textContent === '열기',
    )
    act(() => {
      expandLayer?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const openRow = Array.from(container.querySelectorAll('button[type="button"]')).find(
      (button) => button.textContent === '셀 보기',
    )
    act(() => {
      openRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('제거됨')
    expect(container.textContent).toContain('삭제됨')
    expect(source).toContain('activateBackboneJumpTarget(')

    act(() => {
      rootRender.unmount()
    })
  })

  it('preserves preview items across loading and keeps content visible on page errors', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const rootRender = createRoot(container)

    const previewItem = createRootData().changedPreview[0]

    act(() => {
      rootRender.render(
        <BackboneDiffWorkbench
          root={createRootData()}
          rootStatus="ready"
          rootError={null}
          onRetryRoot={vi.fn()}
          onRefreshAnnouncementReset={vi.fn()}
          refreshAnnouncement={null}
          filters={createBaseFilter()}
          onFiltersChange={vi.fn()}
          preview={{ ...createPreviewState(), status: 'ready', items: [previewItem], nextCursor: 'cursor-2' }}
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
        />
      )
    })

    expect(container.textContent).toContain('row-1')
    expect(container.querySelector('button[type="button"]')?.textContent).toContain('더 보기')

    act(() => {
      rootRender.render(
        <BackboneDiffWorkbench
          root={createRootData()}
          rootStatus="ready"
          rootError={null}
          onRetryRoot={vi.fn()}
          onRefreshAnnouncementReset={vi.fn()}
          refreshAnnouncement={null}
          filters={createBaseFilter()}
          onFiltersChange={vi.fn()}
          preview={{ ...createPreviewState(), status: 'loading', items: [previewItem], nextCursor: 'cursor-2' }}
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
        />
      )
    })

    expect(container.textContent).toContain('row-1')

    act(() => {
      rootRender.render(
        <BackboneDiffWorkbench
          root={createRootData()}
          rootStatus="ready"
          rootError={null}
          onRetryRoot={vi.fn()}
          onRefreshAnnouncementReset={vi.fn()}
          refreshAnnouncement={null}
          filters={createBaseFilter()}
          onFiltersChange={vi.fn()}
          preview={{
            ...createPreviewState(),
            status: 'error',
            items: [previewItem],
            error: '오류 메시지',
            nextCursor: 'cursor-2',
          }}
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
        />
      )
    })

    expect(container.textContent).toContain('오류 메시지')
    expect(container.textContent).toContain('row-1')

    act(() => {
      rootRender.unmount()
    })
  })

  it('calls filter callback for classification/unchanged controls', () => {
    const onFiltersChange = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const rootRender = createRoot(container)

    act(() => {
      rootRender.render(
        <BackboneDiffWorkbench
          root={createRootData()}
          rootStatus="ready"
          rootError={null}
          onRetryRoot={vi.fn()}
          onRefreshAnnouncementReset={vi.fn()}
          refreshAnnouncement={null}
          filters={createBaseFilter()}
          onFiltersChange={onFiltersChange}
          preview={createPreviewState()}
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
        />
      )
    })

    const allCheckboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'))
    const includeUnchangedInput = allCheckboxes[5] as HTMLInputElement
    const removedInput = allCheckboxes[3] as HTMLInputElement

    act(() => {
      includeUnchangedInput.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    act(() => {
      removedInput.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onFiltersChange).toHaveBeenCalledTimes(2)
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...createBaseFilter(),
      includeUnchanged: true,
      classification: [...createBaseFilter().classification, 'unchanged'],
    })
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...createBaseFilter(),
      classification: [...createBaseFilter().classification, 'removed'],
    })

    act(() => {
      rootRender.unmount()
    })
  })
})
