import { describe, expect, it } from 'vitest'

import {
  buildHistoryCellHistoryQueryString,
  buildHistoryDetailQueryString,
  buildHistoryTimelineQueryString,
  createHistoryTimelineFilters,
  type HistoryEventType,
  historyCellHistoryQueryKey,
  historyDetailQueryKey,
  historyTimelineQueryKey,
  normalizeHistoryTimelineFilters,
} from '@/api/historyQuery'

describe('history query helpers', () => {
  it('normalizes filters and produces a stable query key', () => {
    const filters = normalizeHistoryTimelineFilters({
      createdFrom: ' 2026-07-17T00:00:00Z ',
      createdTo: '2026-07-18T00:00:00Z',
      layerKey: ' L1::10::ETCH ',
      eventTypes: ['cell_update', 'backbone_copy', 'backbone_copy'] as readonly HistoryEventType[],
      actor: ' dev-admin ',
      origin: 'manual',
      sourceProjectId: 17,
    })

    expect(filters).toEqual({
      createdFrom: '2026-07-17T00:00:00Z',
      createdTo: '2026-07-18T00:00:00Z',
      layerKey: 'L1::10::ETCH',
      eventTypes: ['backbone_copy', 'cell_update'],
      actor: 'dev-admin',
      origin: 'manual',
      sourceProjectId: 17,
    })
    expect(historyTimelineQueryKey(7, filters)).toEqual([
      'history',
      7,
      'timeline',
      filters,
    ])
  })

  it('serializes timeline filters with repeated event_type parameters', () => {
    const query = buildHistoryTimelineQueryString(
      createHistoryTimelineFilters({
        createdFrom: '2026-07-17T00:00:00Z',
        createdTo: '2026-07-18T00:00:00Z',
        layerKey: 'L1::10::ETCH',
        eventTypes: ['cell_update', 'backbone_copy'] as readonly HistoryEventType[],
        actor: 'dev-admin',
        origin: 'system',
        sourceProjectId: 19,
      }),
      { cursor: 'cursor-1', limit: 75 },
    )

    expect(query).toBe(
      [
        'created_from=2026-07-17T00%3A00%3A00Z',
        'created_to=2026-07-18T00%3A00%3A00Z',
        'layer_key=L1%3A%3A10%3A%3AETCH',
        'event_type=backbone_copy',
        'event_type=cell_update',
        'actor=dev-admin',
        'origin=system',
        'source_project_id=19',
        'cursor=cursor-1',
        'limit=75',
      ].join('&'),
    )
  })

  it('serializes batch detail and cell history query keys and parameters', () => {
    expect(historyDetailQueryKey(7, 'scope-token', 'batch-1')).toEqual([
      'history',
      7,
      'detail',
      'scope-token',
      'batch-1',
    ])
    expect(historyCellHistoryQueryKey(7, 11, 'ETCH_P001')).toEqual([
      'history',
      7,
      'cell-history',
      11,
      'ETCH_P001',
    ])

    expect(buildHistoryDetailQueryString(' scope-token ', { cursor: 'next', limit: 3 })).toBe(
      'scope=scope-token&cursor=next&limit=3',
    )
    expect(buildHistoryCellHistoryQueryString(11, 'ETCH_P001', { cursor: 'next' })).toBe(
      'condition_id=11&parameter_code=ETCH_P001&cursor=next&limit=50',
    )
  })

  it('fails closed on runtime-invalid event types and out-of-range limits', () => {
    expect(() =>
      normalizeHistoryTimelineFilters({
        eventTypes: ['cell_update', 'bad-event'] as unknown as readonly HistoryEventType[],
      }),
    ).toThrow(TypeError)
    expect(() =>
      buildHistoryTimelineQueryString(
        {
          createdFrom: null,
          createdTo: null,
          layerKey: null,
          eventTypes: ['cell_update'] as readonly HistoryEventType[],
          actor: null,
          origin: null,
          sourceProjectId: null,
        },
        { limit: 0 },
      ),
    ).toThrow(TypeError)
    expect(() => buildHistoryDetailQueryString('scope', { limit: 0 })).toThrow(TypeError)
    expect(() => buildHistoryCellHistoryQueryString(0, 'ETCH_P001')).toThrow(TypeError)
  })
})
