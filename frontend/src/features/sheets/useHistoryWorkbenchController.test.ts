// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  HistoryCellHistoryOut,
  HistoryDetailOut,
  HistoryTimelineItemOut,
  HistoryTimelineOut,
} from '@/api/history'

const historyApi = vi.hoisted(() => ({
  getHistoryBatchDetail: vi.fn(),
  getHistoryCellHistory: vi.fn(),
  getHistoryTimeline: vi.fn(),
}))

vi.mock('@/api/history', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/history')>()),
  ...historyApi,
}))

import {
  historyCellHistoryQueryEnabled,
  historyQueryPresentation,
  historyTimelineQueryEnabled,
  isCurrentHistoryDetailAuthority,
  mergeHistoryBatchDetailPage,
  mergeHistoryCellHistoryPages,
  mergeHistoryTimelinePages,
  parseHistoryCellScope,
  useHistoryWorkbenchController,
  type HistoryWorkbenchController,
} from './useHistoryWorkbenchController'
import source from './useHistoryWorkbenchController.ts?raw'

describe('useHistoryWorkbenchController seams', () => {
  it('keeps a selected cell passive until cell scope is explicitly chosen', () => {
    const controller = renderController()

    expect(controller.result.current.onScopeChange('cell')).toBe(false)

    act(() => {
      controller.result.current.onFiltersChange({ actor: 'dev-admin', layerKey: 'L1::10::ETCH' })
      expect(
        controller.result.current.onSelectedCellChange({
          conditionId: '11',
          parameterCode: 'ETCH_P001',
        }),
      ).toBe(true)
    })

    expect(controller.result.current.state.mode).toBe('timeline')

    act(() => {
      expect(controller.result.current.onScopeChange('cell')).toBe(true)
    })

    expect(controller.result.current.state.mode).toBe('cell')

    act(() => controller.result.current.onLayerScopeChange('L2::20::CLEAN'))

    expect(controller.result.current.state.mode).toBe('timeline')
    expect(controller.result.current.state.filters.actor).toBe('dev-admin')
    expect(controller.result.current.state.filters.layerKey).toBe('L2::20::CLEAN')
    expect(controller.result.current.state.cellScope).toBeNull()
    expect(
      historyCellHistoryQueryEnabled(
        true,
        controller.result.current.state.mode,
        controller.result.current.state.cellScope,
      ),
    ).toBe(false)
  })

  it('keeps current-Layer detail authority when the Layer boundary repeats', async () => {
    const detailRequest = deferred<HistoryDetailOut>()
    historyApi.getHistoryTimeline.mockResolvedValue(timelinePage(1, null))
    historyApi.getHistoryBatchDetail.mockReturnValueOnce(detailRequest.promise)
    const controller = renderController(true)
    const item = batchTimelineItem(72)

    act(() => controller.result.current.onLayerScopeChange('L1::10::ETCH'))
    await flushHistoryRequests()
    act(() => controller.result.current.onBatchToggle(item, true))
    await flushHistoryRequests()

    act(() => controller.result.current.onLayerScopeChange('L1::10::ETCH'))
    detailRequest.resolve(detailPage(702, null))
    await flushHistoryRequests()

    expect(controller.result.current.state.batchDetailCache).toMatchObject({
      'scope-72::batch-72': { items: [{ event_id: 702 }] },
    })
    expect(controller.result.current.batchDetailStatus).toBe('ready')
  })

  it('does not publish a late cell result after Layer scope replaces its authority', async () => {
    const cellRequest = deferred<HistoryCellHistoryOut>()
    historyApi.getHistoryTimeline.mockResolvedValue(timelinePage(1, null))
    historyApi.getHistoryCellHistory.mockReturnValueOnce(cellRequest.promise)
    const controller = renderController(true)

    act(() => {
      controller.result.current.onSelectedCellChange({
        conditionId: '11',
        parameterCode: 'ETCH_P001',
      })
      controller.result.current.onScopeChange('cell')
    })
    await flushHistoryRequests()

    expect(historyApi.getHistoryCellHistory).toHaveBeenCalledWith(7, 11, 'ETCH_P001', {
      cursor: null,
    })

    act(() => controller.result.current.onLayerScopeChange('L2::20::CLEAN'))
    cellRequest.resolve(cellPage(701, null, 'OLD', 'STALE'))
    await flushHistoryRequests()

    expect(controller.result.current.state).toMatchObject({
      mode: 'timeline',
      cellScope: null,
      filters: { layerKey: 'L2::20::CLEAN' },
    })
    expect(controller.result.current.cellHistory).toBeNull()
  })

  it('does not cache a late batch detail after Layer scope replaces its authority', async () => {
    const detailRequest = deferred<HistoryDetailOut>()
    historyApi.getHistoryTimeline.mockResolvedValue(timelinePage(1, null))
    historyApi.getHistoryBatchDetail.mockReturnValueOnce(detailRequest.promise)
    const controller = renderController(true)
    const item = batchTimelineItem(71)

    act(() => controller.result.current.onBatchToggle(item, true))
    await flushHistoryRequests()

    expect(historyApi.getHistoryBatchDetail).toHaveBeenCalledWith(7, 'scope-71', 'batch-71', {
      cursor: null,
    })

    act(() => controller.result.current.onLayerScopeChange('L2::20::CLEAN'))
    detailRequest.resolve(detailPage(701, null))
    await flushHistoryRequests()

    expect(controller.result.current.state.expandedBatchKey).toBeNull()
    expect(controller.result.current.state.batchDetailCache).toEqual({})
    expect(controller.result.current.batchDetailStatus).toBe('idle')
  })

  it('gates timeline and cell queries by the outer and inner modes', () => {
    const scope = { conditionId: 11, parameterCode: 'ETCH_P001' }

    expect(historyTimelineQueryEnabled(false, 'timeline')).toBe(false)
    expect(historyTimelineQueryEnabled(true, 'timeline')).toBe(true)
    expect(historyTimelineQueryEnabled(true, 'cell')).toBe(false)
    expect(historyCellHistoryQueryEnabled(false, 'cell', scope)).toBe(false)
    expect(historyCellHistoryQueryEnabled(true, 'timeline', scope)).toBe(false)
    expect(historyCellHistoryQueryEnabled(true, 'cell', null)).toBe(false)
    expect(historyCellHistoryQueryEnabled(true, 'cell', scope)).toBe(true)

    expect(source.match(/useInfiniteQuery\s*\(/g)).toHaveLength(2)
    expect(source).toContain('queryClient.fetchQuery({')
    expect(source).toMatch(/queryClient\.fetchQuery\(\{[\s\S]*?retry: false/)
    expect(source).toContain('previousEnabledRef.current !== enabled')
    expect(source).toContain('outerGenerationRef.current += 1')
    expect(source).not.toContain('useQuery(')
    expect(source).not.toContain('Number.POSITIVE_INFINITY')
    expect(source).not.toContain('.focus(')
  })

  it('fences root and next detail requests when the sheet mutation revision changes', () => {
    expect(source).toMatch(
      /useHistoryWorkbenchController\(\s*projectId: number,\s*enabled: boolean,\s*historyMutationRevision = 0/,
    )
    expect(source).toContain(
      'const previousMutationRevisionRef = useRef(historyMutationRevision)',
    )
    expect(source).toContain(
      'previousMutationRevisionRef.current !== historyMutationRevision',
    )
    expect(source).toMatch(
      /mutationRevisionChanged[\s\S]*?outerGenerationRef\.current \+= 1[\s\S]*?detailRequestTokenRef\.current \+= 1/,
    )
    expect(source).toContain('invalidateHistoryBatchDetailsForMutation(current)')
  })

  it('accepts only a safe exact cell-history scope', () => {
    expect(parseHistoryCellScope({ conditionId: '11', parameterCode: ' ETCH_P001 ' })).toEqual({
      conditionId: 11,
      parameterCode: 'ETCH_P001',
    })
    expect(parseHistoryCellScope({ conditionId: '0', parameterCode: 'ETCH_P001' })).toBeNull()
    expect(parseHistoryCellScope({ conditionId: '1.5', parameterCode: 'ETCH_P001' })).toBeNull()
    expect(
      parseHistoryCellScope({
        conditionId: String(Number.MAX_SAFE_INTEGER + 1),
        parameterCode: 'ETCH_P001',
      }),
    ).toBeNull()
    expect(parseHistoryCellScope({ conditionId: '11', parameterCode: '   ' })).toBeNull()
    expect(parseHistoryCellScope({ conditionId: '11', parameterCode: 'P'.repeat(65) })).toBeNull()
  })

  it('derives current pages while preserving loaded cursors and first-page cell metadata', () => {
    const firstTimeline = timelinePage(1, 'timeline-next')
    const secondTimeline = timelinePage(2, null)
    const timeline = mergeHistoryTimelinePages([firstTimeline, secondTimeline])

    expect(timeline.pages.map((page) => page.items[0]?.cursor_id)).toEqual([1, 2])
    expect(timeline.nextCursor).toBeNull()
    expect(timeline.coverage).toEqual(firstTimeline.coverage)

    const firstCell = cellPage(31, 'cell-next', 'BASE', 'INITIAL')
    const secondCell = cellPage(32, null, 'WRONG', 'WRONG')
    expect(mergeHistoryCellHistoryPages([firstCell, secondCell])).toMatchObject({
      items: [{ event_id: 31 }, { event_id: 32 }],
      baseline_entry: { code: 'BASE' },
      initial_entry: { code: 'INITIAL' },
      next_cursor: null,
    })
  })

  it('separates root failures from next-page failures without discarding loaded rows', () => {
    expect(
      historyQueryPresentation({
        enabled: true,
        isPending: false,
        isError: true,
        isFetchNextPageError: false,
        error: new Error('root failed'),
      }),
    ).toEqual({ status: 'error', rootError: 'root failed', nextPageError: null })

    expect(
      historyQueryPresentation({
        enabled: true,
        isPending: false,
        isError: true,
        isFetchNextPageError: true,
        error: new Error('next failed'),
      }),
    ).toEqual({ status: 'ready', rootError: null, nextPageError: 'next failed' })
    expect(
      historyQueryPresentation({
        enabled: false,
        isPending: true,
        isError: false,
        isFetchNextPageError: false,
        error: null,
      }),
    ).toEqual({ status: 'idle', rootError: null, nextPageError: null })
  })

  it('appends batch-detail pages while preserving the first page and next cursor', () => {
    const first = detailPage(101, 'detail-next')
    const second = detailPage(201, null)

    expect(mergeHistoryBatchDetailPage(first, second)).toMatchObject({
      items: [{ event_id: 101 }, { event_id: 201 }],
      order_kind: first.order_kind,
      detail_status: first.detail_status,
      next_cursor: null,
    })
    expect(source).toContain("'detail-page'")
    expect(source).toContain('batchDetailNextPageError')
    expect(source).toContain('onLoadMoreBatchDetail')
  })

  it('rejects late batch results after filter, key, mode, cell scope, or outer-mode changes', () => {
    const expected = {
      enabled: true,
      outerGeneration: 4,
      revision: 2,
      mode: 'timeline' as const,
      detailKey: 'scope::batch',
      cellScopeKey: '11::ETCH_P001',
    }
    expect(isCurrentHistoryDetailAuthority(expected, expected)).toBe(true)
    expect(isCurrentHistoryDetailAuthority(expected, { ...expected, enabled: false })).toBe(false)
    expect(
      isCurrentHistoryDetailAuthority(expected, { ...expected, outerGeneration: 5 }),
    ).toBe(false)
    expect(isCurrentHistoryDetailAuthority(expected, { ...expected, revision: 3 })).toBe(false)
    expect(isCurrentHistoryDetailAuthority(expected, { ...expected, mode: 'cell' })).toBe(false)
    expect(
      isCurrentHistoryDetailAuthority(expected, { ...expected, detailKey: 'other::batch' }),
    ).toBe(false)
    expect(
      isCurrentHistoryDetailAuthority(expected, { ...expected, cellScopeKey: '12::ETCH_P001' }),
    ).toBe(false)
  })
})

const mountedControllers: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  for (const controller of mountedControllers.splice(0)) {
    act(() => controller.root.unmount())
    controller.container.remove()
  }
  historyApi.getHistoryBatchDetail.mockReset()
  historyApi.getHistoryCellHistory.mockReset()
  historyApi.getHistoryTimeline.mockReset()
})

function renderController(
  enabled = false,
): { readonly result: { readonly current: HistoryWorkbenchController } } {
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean
  }
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  const result: { current: HistoryWorkbenchController | null } = { current: null }
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryOnMount: false, gcTime: Number.POSITIVE_INFINITY },
    },
  })

  function Probe() {
    result.current = useHistoryWorkbenchController(7, enabled)
    return null
  }

  document.body.append(container)
  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe),
      ),
    )
  })
  mountedControllers.push({ root, container })

  if (result.current === null) throw new Error('History controller did not render')
  return { result: result as { readonly current: HistoryWorkbenchController } }
}

async function flushHistoryRequests(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function timelinePage(cursorId: number, nextCursor: string | null): HistoryTimelineOut {
  return {
    items: [
      {
        kind: 'event',
        cursor_id: cursorId,
        event_types: ['cell_update'],
        actors: ['dev-admin'],
        origins: ['manual'],
        started_at: '2026-07-17T00:00:00Z',
        occurred_at: '2026-07-17T00:00:00Z',
        layer_keys: [],
        source_project_id: null,
        batch_id: null,
        matched_event_count: 1,
        total_event_count: 1,
        summary: `event-${cursorId}`,
        jump_target: null,
        detail_status: 'not_applicable',
        detail_scope: null,
        metadata_status: 'complete',
      },
    ],
    coverage: {
      legacy_unresolved_layer_count: cursorId,
      legacy_detail_unavailable_count: 0,
    },
    next_cursor: nextCursor,
  }
}

function batchTimelineItem(cursorId: number): HistoryTimelineItemOut {
  return {
    ...timelinePage(cursorId, null).items[0]!,
    kind: 'batch',
    batch_id: `batch-${cursorId}`,
    detail_scope: `scope-${cursorId}`,
    detail_status: 'available',
  }
}

function cellPage(
  eventId: number,
  nextCursor: string | null,
  baselineCode: string,
  initialCode: string,
): HistoryCellHistoryOut {
  return {
    items: [
      {
        event_id: eventId,
        old_code: null,
        new_code: String(eventId),
        choice_label: null,
        actor: 'dev-admin',
        origin: 'manual',
        created_at: '2026-07-17T00:00:00Z',
        layer_key: 'L1::10::ETCH',
        jump_status: 'available',
        metadata_status: 'complete',
      },
    ],
    baseline_entry: { code: baselineCode, label: null },
    initial_entry: { code: initialCode, label: null },
    initial_state_unavailable: false,
    next_cursor: nextCursor,
  }
}

function detailPage(eventId: number, nextCursor: string | null): HistoryDetailOut {
  return {
    order_kind: 'event_desc',
    detail_status: 'available',
    items: [
      {
        event_id: eventId,
        old_code: null,
        new_code: String(eventId),
        copied_value: null,
        choice_label: null,
        actor: 'dev-admin',
        origin: 'manual',
        created_at: '2026-07-17T00:00:00Z',
        layer_key: 'L1::10::ETCH',
        jump_target: null,
        domain_coordinate: null,
        capture_tuple: null,
        metadata_status: 'complete',
      },
    ],
    reason: null,
    next_cursor: nextCursor,
  }
}
