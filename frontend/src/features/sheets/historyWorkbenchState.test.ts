import { describe, expect, it } from 'vitest'

import type {
  HistoryDetailItemOut,
  HistoryDetailOut,
  HistoryTimelineItemOut,
} from '@/api/history'

import {
  HISTORY_EVENT_TYPES,
  appendHistoryWorkbenchPage,
  buildHistoryDetailActivationTarget,
  createHistoryWorkbenchState,
  buildHistoryCellActivationTarget,
  describeHistoryDetailStatus,
  describeHistoryJumpTarget,
  describeHistoryLegacyCoverage,
  getHistoryBatchDetailCacheKey,
  getHistoryDetailItemKey,
  getHistoryTimelineItemKey,
  historyWorkbenchBatchDetailKey,
  historyWorkbenchCellHistoryKey,
  historyWorkbenchTimelineKey,
  historyEventTypeLabel,
  invalidateHistoryBatchDetailsForMutation,
  openHistoryCellScope,
  resolveHistoryActorLabel,
  shouldRequestHistoryBatchDetailOnOpen,
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
    const expanded = toggleHistoryBatchDetail(page, batchKey(1))
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
    let detailCalls = 0

    expect(page.expandedBatchKey).toBeNull()
    expect(detailCalls).toBe(0)
    const expanded = toggleHistoryBatchDetail(page, key)

    expect(shouldRequestHistoryBatchDetailOnOpen(expanded, createBatchItem(2))).toBe(true)
    if (shouldRequestHistoryBatchDetailOnOpen(expanded, createBatchItem(2))) detailCalls += 1
    expect(detailCalls).toBe(1)

    const loaded = storeHistoryBatchDetail(expanded, key, createDetail(2))
    expect(shouldRequestHistoryBatchDetailOnOpen(loaded, createBatchItem(2))).toBe(false)

    const collapsed = toggleHistoryBatchDetail(loaded, key)
    const reopened = toggleHistoryBatchDetail(collapsed, key)

    expect(shouldRequestHistoryBatchDetailOnOpen(reopened, createBatchItem(2))).toBe(false)
    if (shouldRequestHistoryBatchDetailOnOpen(reopened, createBatchItem(2))) detailCalls += 1
    expect(detailCalls).toBe(1)
  })

  it('clears only mutable batch detail state and advances authority after a sheet mutation', () => {
    const scope = { conditionId: 11, parameterCode: 'ETCH_P001' }
    const initial = createHistoryWorkbenchState({ actor: 'dev-admin' }, scope)
    const page = appendHistoryWorkbenchPage(initial, {
      items: [createBatchItem(4)],
      nextCursor: 'cursor-4',
    })
    const expanded = toggleHistoryBatchDetail(page, batchKey(4))
    const loaded = storeHistoryBatchDetail(expanded, batchKey(4), createDetail(4))

    const invalidated = invalidateHistoryBatchDetailsForMutation(loaded)

    expect(invalidated.revision).toBe(loaded.revision + 1)
    expect(invalidated.expandedBatchKey).toBeNull()
    expect(invalidated.batchDetailCache).toEqual({})
    expect(invalidated.filters).toBe(loaded.filters)
    expect(invalidated.pages).toBe(loaded.pages)
    expect(invalidated.nextCursor).toBe('cursor-4')
    expect(invalidated.cellScope).toBe(loaded.cellScope)
    expect(invalidated.mode).toBe(loaded.mode)

    const reopened = toggleHistoryBatchDetail(invalidated, batchKey(4))
    expect(shouldRequestHistoryBatchDetailOnOpen(reopened, createBatchItem(4))).toBe(true)
  })

  it('keeps the literal dev-admin actor and explicit legacy/deleted copy', () => {
    expect(resolveHistoryActorLabel(['dev-admin'])).toBe('dev-admin')
    expect(resolveHistoryActorLabel(['dev-admin'], { engineer: 'Engineer' })).toBe('dev-admin')
    expect(describeHistoryLegacyCoverage({ legacy_unresolved_layer_count: 2, legacy_detail_unavailable_count: 1 })).toContain('2개')
    expect(describeHistoryDetailStatus(createBatchItem(3, { detail_status: 'legacy_unavailable' }))).toContain('레거시 상세 형식')
    expect(describeHistoryJumpTarget({ ...availableJumpTarget(), jump_status: 'deleted' })).toContain('삭제된 대상')
    expect(historyEventTypeLabel('por_change')).toBe('POR 변경')
    expect(HISTORY_EVENT_TYPES).toHaveLength(8)
  })

  it('derives truthful detail navigation and capture-stable list keys', () => {
    const available = createDetailItem({
      jump_target: null,
      domain_coordinate: {
        layer_key: 'L1::10::ETCH',
        condition_id: 11,
        parameter_code: 'ETCH_P001',
        cell_ref: 'R11C3',
      },
      capture_tuple: {
        target_layer_sort: 1,
        target_layer_key: 'L1::10::ETCH',
        source_condition_index: 2,
        source_condition_id: 31,
        parameter_sort: 3,
        parameter_code: 'ETCH_P001',
        event_id: 41,
      },
    })
    const sameEventDifferentCapture = createDetailItem({
      capture_tuple: {
        ...available.capture_tuple!,
        source_condition_index: 4,
      },
    })
    const deleted = createDetailItem({
      jump_target: { ...availableJumpTarget(), jump_status: 'deleted' },
    })

    expect(buildHistoryDetailActivationTarget(available)).toEqual({
      layer_key: 'L1::10::ETCH',
      condition_id: 11,
      parameter_code: 'ETCH_P001',
      cell_ref: 'R11C3',
      jump_status: 'available',
    })
    expect(buildHistoryDetailActivationTarget(deleted)?.jump_status).toBe('deleted')
    expect(
      buildHistoryDetailActivationTarget(
        createDetailItem({ jump_target: null, domain_coordinate: null }),
      ),
    ).toBeNull()
    expect(getHistoryDetailItemKey(available)).toContain('capture')
    expect(getHistoryDetailItemKey(available)).not.toBe(
      getHistoryDetailItemKey(sameEventDifferentCapture),
    )
    expect(getHistoryDetailItemKey(available)).toBe(getHistoryDetailItemKey(available))
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
    const target = buildHistoryCellActivationTarget({ conditionId: 11, parameterCode: 'ETCH_P001' }, {
      event_id: 31,
      old_code: 'OLD',
      new_code: 'NEW',
      choice_label: 'choice',
      actor: 'dev-admin',
      origin: 'manual',
      created_at: '2026-07-17T00:00:00Z',
      layer_key: 'L1::10::ETCH',
      jump_status: 'available',
      metadata_status: 'complete',
    })

    expect(opened.mode).toBe('cell')
    expect(opened.cellScope).toEqual({ conditionId: 11, parameterCode: 'ETCH_P001' })
    expect(opened.filters.actor).toBe('dev-admin')
    expect(opened.expandedBatchKey).toBeNull()
    expect(target).toEqual({
      layer_key: 'L1::10::ETCH',
      condition_id: 11,
      parameter_code: 'ETCH_P001',
      cell_ref: null,
      jump_status: 'available',
    })
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

function createDetailItem(
  overrides: Partial<HistoryDetailItemOut> = {},
): HistoryDetailItemOut {
  return {
    event_id: 41,
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
    ...overrides,
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
