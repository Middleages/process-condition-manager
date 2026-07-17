import { describe, expect, it } from 'vitest'

import type { HistoryCellHistoryOut, HistoryTimelineOut } from '@/api/history'

import {
  historyCellHistoryQueryEnabled,
  historyQueryPresentation,
  historyTimelineQueryEnabled,
  isCurrentHistoryDetailAuthority,
  mergeHistoryCellHistoryPages,
  mergeHistoryTimelinePages,
  parseHistoryCellScope,
} from './useHistoryWorkbenchController'
import source from './useHistoryWorkbenchController.ts?raw'

describe('useHistoryWorkbenchController seams', () => {
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

  it('rejects late detail results after filter, key, mode, scope, or outer-mode changes', () => {
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
