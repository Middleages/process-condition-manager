import type { HistoryTimelineItemOut } from '@/api/history'

import {
  createHistoryTimelineFilters,
  historyTimelineQueryKey,
  normalizeHistoryTimelineFilters,
  type HistoryTimelineFilters,
} from './historyQuery'

export interface HistoryTimelinePage {
  items: readonly HistoryTimelineItemOut[]
  nextCursor: string | null
}

export interface HistoryTimelineState {
  filters: HistoryTimelineFilters
  pages: readonly HistoryTimelinePage[]
  nextCursor: string | null
  revision: number
}

export type HistoryTimelineAction =
  | { readonly type: 'replace-filters'; readonly filters: Partial<HistoryTimelineFilters> }
  | { readonly type: 'append-page'; readonly page: HistoryTimelinePage }
  | { readonly type: 'reset-pages' }

export function createHistoryTimelineState(
  filters: Partial<HistoryTimelineFilters> = {},
): HistoryTimelineState {
  return {
    filters: createHistoryTimelineFilters(filters),
    pages: [],
    nextCursor: null,
    revision: 0,
  }
}

export function reduceHistoryTimelineState(
  state: HistoryTimelineState,
  action: HistoryTimelineAction,
): HistoryTimelineState {
  switch (action.type) {
    case 'replace-filters': {
      const filters = normalizeHistoryTimelineFilters({
        ...state.filters,
        ...action.filters,
      })
      if (sameHistoryTimelineFilters(state.filters, filters)) return state
      return {
        ...state,
        filters,
        pages: [],
        nextCursor: null,
        revision: state.revision + 1,
      }
    }
    case 'append-page':
      return {
        ...state,
        pages: [...state.pages, action.page],
        nextCursor: action.page.nextCursor,
      }
    case 'reset-pages':
      return state.pages.length === 0 && state.nextCursor === null
        ? state
        : { ...state, pages: [], nextCursor: null }
  }
}

export function appendHistoryTimelinePage(
  state: HistoryTimelineState,
  page: HistoryTimelinePage,
): HistoryTimelineState {
  return reduceHistoryTimelineState(state, { type: 'append-page', page })
}

export function resetHistoryTimelinePages(state: HistoryTimelineState): HistoryTimelineState {
  return reduceHistoryTimelineState(state, { type: 'reset-pages' })
}

export function updateHistoryTimelineFilters(
  state: HistoryTimelineState,
  filters: Partial<HistoryTimelineFilters>,
): HistoryTimelineState {
  return reduceHistoryTimelineState(state, { type: 'replace-filters', filters })
}

export function historyTimelineKey(
  projectId: number,
  filters: HistoryTimelineFilters,
): readonly unknown[] {
  return historyTimelineQueryKey(projectId, filters)
}

function sameHistoryTimelineFilters(
  left: HistoryTimelineFilters,
  right: HistoryTimelineFilters,
): boolean {
  return (
    left.createdFrom === right.createdFrom &&
    left.createdTo === right.createdTo &&
    left.layerKey === right.layerKey &&
    left.actor === right.actor &&
    left.origin === right.origin &&
    left.sourceProjectId === right.sourceProjectId &&
    left.eventTypes.length === right.eventTypes.length &&
    left.eventTypes.every((value, index) => value === right.eventTypes[index])
  )
}
