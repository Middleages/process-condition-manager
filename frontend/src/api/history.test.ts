import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AxiosResponse } from 'axios'

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

import { apiClient } from './client'
import {
  buildHistoryCellHistoryQueryString,
  buildHistoryDetailQueryString,
  normalizeHistoryTimelineFilters,
} from './historyQuery'
import {
  getHistoryBatchDetail,
  getHistoryCellHistory,
  getHistoryTimeline,
} from './history'
import type { HistoryCellHistoryOut, HistoryDetailOut, HistoryTimelineOut } from './history'
import { buildHistoryTimelineQueryString } from './historyQuery'

function response<T>(data: T): AxiosResponse<T> {
  return { data } as unknown as AxiosResponse<T>
}

const get = vi.mocked(apiClient.get)

describe('history API client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GETs the timeline with query-string filters and repeated event types', async () => {
    const out: HistoryTimelineOut = {
      items: [],
      coverage: { legacy_unresolved_layer_count: 0, legacy_detail_unavailable_count: 0 },
      next_cursor: null,
    }
    get.mockResolvedValue(response(out))

    await getHistoryTimeline(
      7,
      {
        createdFrom: '2026-07-17T00:00:00Z',
        createdTo: '2026-07-18T00:00:00Z',
        layerKey: 'L1::10::ETCH',
        eventTypes: ['cell_update', 'backbone_copy'],
        actor: 'dev-admin',
        origin: 'manual',
        sourceProjectId: 17,
      },
      { cursor: 'cursor-1', limit: 75 },
    )

    expect(get).toHaveBeenCalledWith(
      '/projects/7/events?created_from=2026-07-17T00%3A00%3A00Z&created_to=2026-07-18T00%3A00%3A00Z&layer_key=L1%3A%3A10%3A%3AETCH&event_type=backbone_copy&event_type=cell_update&actor=dev-admin&origin=manual&source_project_id=17&cursor=cursor-1&limit=75',
    )
  })

  it('GETs batch detail with an encoded path segment and lazy scope cursor', async () => {
    const out: HistoryDetailOut = {
      order_kind: 'event_desc',
      detail_status: 'available',
      items: [],
      reason: null,
      next_cursor: null,
    }
    get.mockResolvedValue(response(out))

    await getHistoryBatchDetail(7, ' scope-token ', ' batch/1 ', {
      cursor: 'next',
      limit: 3,
    })

    expect(get).toHaveBeenCalledWith(
      '/projects/7/event-batches/batch%2F1?scope=scope-token&cursor=next&limit=3',
    )
  })

  it('GETs cell history with coordinate parameters and the default limit', async () => {
    const out: HistoryCellHistoryOut = {
      items: [],
      baseline_entry: null,
      initial_entry: null,
      initial_state_unavailable: false,
      next_cursor: null,
    }
    get.mockResolvedValue(response(out))

    await getHistoryCellHistory(7, 11, ' ETCH_P001 ', { cursor: 'next' })

    expect(get).toHaveBeenCalledWith(
      '/projects/7/cell-history?condition_id=11&parameter_code=ETCH_P001&cursor=next&limit=50',
    )
  })

  it('fails closed on invalid timeline bounds, event types, and limits', () => {
    expect(() =>
      normalizeHistoryTimelineFilters({
        createdFrom: ' ',
        createdTo: '2026-07-18T00:00:00Z',
        layerKey: '   ',
        eventTypes: ['cell_update', 'not-an-event'] as unknown as readonly never[],
        actor: ' ',
        origin: 'manual',
        sourceProjectId: 0,
      }),
    ).toThrow(TypeError)

    expect(() =>
      buildHistoryTimelineQueryString(
        {
          createdFrom: '2026-07-17T00:00:00Z',
          createdTo: '2026-07-18T00:00:00Z',
          layerKey: null,
          eventTypes: ['cell_update'],
          actor: null,
          origin: null,
          sourceProjectId: null,
        },
        { limit: 0 },
      ),
    ).toThrow(TypeError)

    expect(() => buildHistoryDetailQueryString('scope', { limit: 201 })).toThrow(TypeError)
    expect(() => buildHistoryCellHistoryQueryString(0, 'ETCH_P001')).toThrow(TypeError)
    expect(() => buildHistoryCellHistoryQueryString(11, 'ETCH_P001', { limit: 101 })).toThrow(
      TypeError,
    )
  })
})
