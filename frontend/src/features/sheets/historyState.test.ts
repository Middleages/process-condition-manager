import { describe, expect, it } from 'vitest'

import { createHistoryTimelineItem } from './historyState.testHelpers'
import {
  appendHistoryTimelinePage,
  createHistoryTimelineState,
  reduceHistoryTimelineState,
  resetHistoryTimelinePages,
  updateHistoryTimelineFilters,
} from './historyState'

describe('history timeline state', () => {
  it('starts empty and accumulates pages', () => {
    const initial = createHistoryTimelineState({ actor: 'dev-admin' })
    const withPage = appendHistoryTimelinePage(initial, {
      items: [createHistoryTimelineItem(1)],
      nextCursor: 'next-1',
    })

    expect(withPage.pages).toHaveLength(1)
    expect(withPage.nextCursor).toBe('next-1')
    expect(withPage.filters.actor).toBe('dev-admin')
  })

  it('clears accumulated pages and advances revision when any filter changes', () => {
    const initial = createHistoryTimelineState({ layerKey: 'L1::10::ETCH' })
    const withPage = reduceHistoryTimelineState(initial, {
      type: 'append-page',
      page: { items: [createHistoryTimelineItem(1)], nextCursor: 'next-1' },
    })
    const changed = updateHistoryTimelineFilters(withPage, { actor: 'dev-admin' })

    expect(changed.pages).toEqual([])
    expect(changed.nextCursor).toBeNull()
    expect(changed.revision).toBe(withPage.revision + 1)
    expect(changed.filters).toEqual({
      createdFrom: null,
      createdTo: null,
      layerKey: 'L1::10::ETCH',
      eventTypes: [],
      actor: 'dev-admin',
      origin: null,
      sourceProjectId: null,
    })
  })

  it('preserves state identity when filter updates are no-ops and can reset pages explicitly', () => {
    const initial = createHistoryTimelineState({
      createdFrom: '2026-07-17T00:00:00Z',
      createdTo: '2026-07-18T00:00:00Z',
    })
    const appended = appendHistoryTimelinePage(initial, {
      items: [createHistoryTimelineItem(2)],
      nextCursor: null,
    })
    const noOp = updateHistoryTimelineFilters(appended, {
      createdFrom: '2026-07-17T00:00:00Z',
    })
    const reset = resetHistoryTimelinePages(appended)

    expect(noOp).toBe(appended)
    expect(reset.pages).toEqual([])
    expect(reset.nextCursor).toBeNull()
  })
})
