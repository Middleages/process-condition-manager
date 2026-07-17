import { describe, expect, it } from 'vitest'

import type {
  HistoryCellHistoryOut,
  HistoryDetailOut,
  HistoryTimelineItemOut,
} from '@/api/history'

import {
  appendHistoryWorkbenchPage,
  createHistoryWorkbenchState,
  describeHistoryDetailStatus,
  describeHistoryJumpTarget,
  describeHistoryLegacyCoverage,
  getHistoryBatchDetailCacheKey,
  getHistoryTimelineItemKey,
  handleHistoryWorkbenchItemActivationKey,
  historyWorkbenchBatchDetailKey,
  historyWorkbenchCellHistoryKey,
  historyWorkbenchTimelineKey,
  openHistoryCellScope,
  reduceHistoryWorkbenchState,
  resolveHistoryActorLabel,
  shouldRequestHistoryBatchDetail,
  storeHistoryBatchDetail,
  toggleHistoryBatchDetail,
  updateHistoryWorkbenchFilters,
} from './historyWorkbenchState'

import { createHistoryTimelineItem } from './historyState.testHelpers'

describe('history workbench state', () => {
  it('resets accumulated pages and detail cache when filters change and keeps a stable query contract', () => {
    const initial = createHistoryWorkbenchState({ actor: 'dev-admin' })
    const page = appendHistoryWorkbenchPage(initial, {
      items: [createBatchItem(1)],
      nextCursor: 'cursor-1',
    })
    const expanded = toggleHistoryBatchDetail(page, getHistoryTimelineItemKey(createBatchItem(1)))
    const loaded = storeHistoryBatchDetail(expanded, batchKey(1), createDetail(1))
    const changed = updateHistoryWorkbenchFilters(loaded, { layerKey: 'L1::10::ETCH' })

    expect(changed.pages).toEqual([])
    expect(changed.nextCursor).toBeNull()
    expect(changed.expandedBatchKey).toBeNull()
    expect(changed.batchDetailCache).toEqual({})
    expect(changed.revision).toBe(loaded.revision + 1)
    expect(historyWorkbenchTimelineKey(7, changed.filters)).toEqual([
      'history',
      7,
      'timeline',
      changed.filters,
    ])
  })

  it('requests batch detail only on the first expand and reuses the cache on collapse/reopen', () => {
    const initial = createHistoryWorkbenchState()
    const page = appendHistoryWorkbenchPage(initial, { items: [createBatchItem(2)], nextCursor: null })
    const key = getHistoryTimelineItemKey(createBatchItem(2))
    const expanded = toggleHistoryBatchDetail(page, key)

    expect(shouldRequestHistoryBatchDetail(expanded, createBatchItem(2))).toBe(true)

    const loaded = storeHistoryBatchDetail(expanded, key, createDetail(2))
    expect(shouldRequestHistoryBatchDetail(loaded, createBatchItem(2))).toBe(false)

    const collapsed = toggleHistoryBatchDetail(loaded, key)
    const reopened = toggleHistoryBatchDetail(collapsed, key)

    expect(shouldRequestHistoryBatchDetail(reopened, createBatchItem(2))).toBe(false)
  })

  it('keeps the literal dev-admin actor and explicit legacy/deleted copy', () => {
    expect(resolveHistoryActorLabel(['dev-admin'])).toBe('dev-admin')
    expect(resolveHistoryActorLabel(['dev-admin'], { engineer: 'Engineer' })).toBe('dev-admin')
    expect(describeHistoryLegacyCoverage({ legacy_unresolved_layer_count: 2, legacy_detail_unavailable_count: 1 })).toContain('2개')
    expect(describeHistoryDetailStatus(createBatchItem(3, { detail_status: 'legacy_unavailable' }))).toContain('레거시 상세 형식')
    expect(describeHistoryJumpTarget({ ...availableJumpTarget(), jump_status: 'deleted' })).toContain('삭제된 대상')
  })

  it('handles Enter and Space activations without repeating', () => {
    const activated: string[] = []
    const preventDefault = () => activated.push('prevented')

    handleHistoryWorkbenchItemActivationKey('Enter', false, preventDefault, () => activated.push('enter'))
    handleHistoryWorkbenchItemActivationKey(' ', false, preventDefault, () => activated.push('space'))
    handleHistoryWorkbenchItemActivationKey('Enter', true, preventDefault, () => activated.push('repeat'))
    handleHistoryWorkbenchItemActivationKey('Escape', false, preventDefault, () => activated.push('escape'))

    expect(activated).toEqual(['prevented', 'enter', 'prevented', 'space'])
  })

  it('keeps the history batch and cell history query-key seams aligned to the accepted API contract', () => {
    expect(historyWorkbenchBatchDetailKey(7, 'scope-token', 'batch-1')).toEqual([
      'history',
      7,
      'detail',
      'scope-token',
      'batch-1',
    ])
    expect(historyWorkbenchCellHistoryKey(7, 11, 'ETCH_P001')).toEqual([
      'history',
      7,
      'cell-history',
      11,
      'ETCH_P001',
    ])
    expect(getHistoryBatchDetailCacheKey('scope-token', 'batch-1')).toBe('scope-token::batch-1')
  })

  it('opens a cell scope without disturbing the timeline filter state', () => {
    const initial = createHistoryWorkbenchState({ actor: 'dev-admin' })
    const opened = openHistoryCellScope(initial, { conditionId: 11, parameterCode: 'ETCH_P001' })

    expect(opened.mode).toBe('cell')
    expect(opened.cellScope).toEqual({ conditionId: 11, parameterCode: 'ETCH_P001' })
    expect(opened.filters.actor).toBe('dev-admin')
    expect(opened.expandedBatchKey).toBeNull()
  })
})

function createBatchItem(
  cursorId: number,
  overrides: Partial<HistoryTimelineItemOut> = {},
): HistoryTimelineItemOut {
  return {
    ...createHistoryTimelineItem(cursorId),
    kind: 'batch',
    event_types: ['backbone_copy', 'cell_update'],
    actors: ['dev-admin'],
    origins: ['manual'],
    batch_id: `batch-${cursorId}`,
    detail_scope: `scope-${cursorId}`,
    detail_status: 'available',
    jump_target: availableJumpTarget(),
    summary: `batch-${cursorId}`,
    ...overrides,
  }
}

function createDetail(cursorId: number): HistoryDetailOut {
  return {
    order_kind: 'event_desc',
    detail_status: 'available',
    items: [
      {
        event_id: cursorId * 10,
        old_code: 'OLD',
        new_code: 'NEW',
        copied_value: null,
        choice_label: 'choice',
        actor: 'dev-admin',
        origin: 'manual',
        created_at: '2026-07-17T00:00:00Z',
        layer_key: 'L1::10::ETCH',
        jump_target: availableJumpTarget(),
        domain_coordinate: null,
        capture_tuple: null,
        metadata_status: 'complete',
      },
    ],
    reason: null,
    next_cursor: null,
  }
}

function availableJumpTarget() {
  return {
    layer_key: 'L1::10::ETCH',
    condition_id: 11,
    parameter_code: 'ETCH_P001',
    cell_ref: 'R11C3',
    jump_status: 'available' as const,
  }
}

function batchKey(cursorId: number): string {
  return getHistoryTimelineItemKey(createBatchItem(cursorId))
}
