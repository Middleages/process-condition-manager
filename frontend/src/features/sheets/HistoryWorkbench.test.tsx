import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type {
  HistoryCellHistoryOut,
  HistoryDetailOut,
  HistoryTimelineItemOut,
} from '@/api/history'

import {
  appendHistoryWorkbenchPage,
  createHistoryWorkbenchState,
  getHistoryTimelineItemKey,
  openHistoryCellScope,
  storeHistoryBatchDetail,
  toggleHistoryBatchDetail,
  type HistoryWorkbenchState,
} from './historyWorkbenchState'
import { HistoryWorkbench } from './HistoryWorkbench'
import source from './HistoryWorkbench.tsx?raw'

describe('HistoryWorkbench', () => {
  it('renders timeline filters, legacy coverage, summary-only batch cards, and deletion status while preserving loaded rows', () => {
    const state = buildTimelineState()
    const html = render(
      state,
      {
        timelineStatus: 'error',
        timelineError: '서버에서 이력 목록을 불러오지 못했습니다.',
        nextPageError: '다음 페이지를 불러오지 못했습니다.',
        onRetryTimeline: vi.fn(),
        onLoadMoreTimeline: vi.fn(),
      },
    )

    expect(html).toContain('aria-label="변경 이력 워크벤치"')
    expect(html).toContain('프로젝트 #7')
    expect(html).toContain('기간 시작')
    expect(html).toContain('Origin/source')
    expect(html).toContain('Type')
    expect(html).toContain('적용')
    expect(html).toContain('필터 초기화')
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('role="tab"')
    expect(html).toContain('필터에서 위치를 확인할 수 없는 과거 항목 2개')
    expect(html).toContain('상세를 불러올 수 없는 레거시 항목 1개')
    expect(html).toContain('dev-admin')
    expect(html).toContain('삭제됨')
    expect(html).toContain('삭제된 대상이라 위치로 이동할 수 없습니다.')
    expect(html).toContain('요약만 먼저 렌더됩니다.')
    expect(html).toContain('상세')
    expect(html).toContain('OLD → NEW')
    expect(html).toContain('다음 페이지 불러오기')
    expect(html).toContain('다음 페이지를 불러오지 못했습니다.')
    expect(html).toContain('서버에서 이력 목록을 불러오지 못했습니다.')
    expect(html).toContain('2개 항목')
    expect(html).toContain('aria-live="polite"')
    expect(source).toContain('handleHistoryWorkbenchItemActivationKey(')
    expect(source).toContain('shouldRequestHistoryBatchDetailOnOpen(')
    expect(source).toContain('onBatchToggle?.(item, shouldRequestDetail)')
    expect(source).toContain('parsePositiveIntegerText(')
    expect(source).toContain('onLoadMoreTimeline?.(state.nextCursor)')
    expect(source).toContain('onLoadMoreCell?.(cellHistory?.next_cursor ?? null)')
    expect(source).toContain('onClick={handleApplyFilters}')
  })

  it('renders cell-scope history with explicit scope copy and initial-state fallback text', () => {
    const state = openHistoryCellScope(createHistoryWorkbenchState(), {
      conditionId: 11,
      parameterCode: 'ETCH_P001',
    })
    const html = render(state, {
      cellHistory: cellHistory(),
      cellNextPageError: '셀 다음 페이지를 불러오지 못했습니다.',
      onLoadMoreCell: vi.fn(),
      onRetryCell: vi.fn(),
    })

    expect(html).toContain('셀 범위')
    expect(html).toContain('condition #11')
    expect(html).toContain('parameter ETCH_P001')
    expect(html).toContain('기준 셀이 없는 초기 상태입니다.')
    expect(html).toContain('초기 셀 상태를 확인할 수 없습니다.')
    expect(html).toContain('삭제된 대상이라 위치로 이동할 수 없습니다.')
    expect(html).toContain('2026-07-17T00:00:00Z')
    expect(html).toContain('더 보기')
    expect(html).toContain('셀 다음 페이지를 불러오지 못했습니다.')
  })

  it('keeps the first batch detail fetch lazy and cached in the state path', () => {
    const state = buildTimelineState()
    const item = state.pages[0].items[1]
    const batchKey = getHistoryTimelineItemKey(item)
    const expanded = toggleHistoryBatchDetail(state, batchKey)

    expect(batchKey).toContain('scope-2::batch-2')
    expect(render(expanded)).toContain('OLD → NEW')

    const loaded = storeHistoryBatchDetail(expanded, batchKey, detailFixture())
    const collapsed = toggleHistoryBatchDetail(loaded, batchKey)
    const reopened = toggleHistoryBatchDetail(collapsed, batchKey)

    expect(reopened.batchDetailCache[batchKey]).toBeDefined()
  })
})

function render(
  state: HistoryWorkbenchState,
  overrides: Partial<Parameters<typeof HistoryWorkbench>[0]> = {},
): string {
  return renderToStaticMarkup(
    <HistoryWorkbench
      projectId={7}
      state={state}
      coverage={{
        legacy_unresolved_layer_count: 2,
        legacy_detail_unavailable_count: 1,
      }}
      timelineStatus="ready"
      cellStatus="ready"
      {...overrides}
    />,
  )
}

function buildTimelineState(): HistoryWorkbenchState {
  const initial = createHistoryWorkbenchState({ actor: 'dev-admin' })
  const withPage = appendHistoryWorkbenchPage(initial, {
    items: [createDeletedEvent(), createExpandedBatchItem()],
    nextCursor: 'cursor-2',
  })
  const expanded = toggleHistoryBatchDetail(withPage, getHistoryTimelineItemKey(createExpandedBatchItem()))
  return storeHistoryBatchDetail(expanded, getHistoryTimelineItemKey(createExpandedBatchItem()), detailFixture())
}

function createDeletedEvent(): HistoryTimelineItemOut {
  return {
    kind: 'event',
    cursor_id: 1,
    event_types: ['cell_update'],
    actors: ['dev-admin'],
    origins: ['manual'],
    started_at: '2026-07-17T00:00:00Z',
    occurred_at: '2026-07-17T00:00:00Z',
    layer_keys: ['L1::10::ETCH'],
    source_project_id: null,
    batch_id: null,
    matched_event_count: 1,
    total_event_count: 1,
    summary: 'event-1',
    jump_target: {
      layer_key: 'L1::10::ETCH',
      condition_id: 11,
      parameter_code: 'ETCH_P001',
      cell_ref: 'R11C3',
      jump_status: 'deleted',
    },
    detail_status: 'available',
    detail_scope: null,
    metadata_status: 'complete',
  }
}

function createExpandedBatchItem(): HistoryTimelineItemOut {
  return {
    kind: 'batch',
    cursor_id: 2,
    event_types: ['backbone_copy', 'cell_update'],
    actors: ['dev-admin'],
    origins: ['manual'],
    started_at: '2026-07-17T01:00:00Z',
    occurred_at: '2026-07-17T02:00:00Z',
    layer_keys: ['L1::10::ETCH'],
    source_project_id: 17,
    batch_id: 'batch-2',
    matched_event_count: 2,
    total_event_count: 3,
    summary: 'batch-2',
    jump_target: {
      layer_key: 'L1::10::ETCH',
      condition_id: 11,
      parameter_code: 'ETCH_P001',
      cell_ref: 'R11C3',
      jump_status: 'available',
    },
    detail_status: 'available',
    detail_scope: 'scope-2',
    metadata_status: 'legacy_partial',
  }
}

function detailFixture(): HistoryDetailOut {
  return {
    order_kind: 'event_desc',
    detail_status: 'available',
    items: [
      {
        event_id: 21,
        old_code: 'OLD',
        new_code: 'NEW',
        copied_value: null,
        choice_label: 'choice',
        actor: 'dev-admin',
        origin: 'manual',
        created_at: '2026-07-17T00:00:00Z',
        layer_key: 'L1::10::ETCH',
        jump_target: {
          layer_key: 'L1::10::ETCH',
          condition_id: 11,
          parameter_code: 'ETCH_P001',
          cell_ref: 'R11C3',
          jump_status: 'available',
        },
        domain_coordinate: null,
        capture_tuple: null,
        metadata_status: 'complete',
      },
    ],
    reason: null,
    next_cursor: null,
  }
}

function cellHistory(): HistoryCellHistoryOut {
  return {
    items: [
      {
        event_id: 31,
        old_code: 'OLD',
        new_code: 'NEW',
        choice_label: 'choice',
        actor: 'dev-admin',
        origin: 'manual',
        created_at: '2026-07-17T00:00:00Z',
        layer_key: 'L1::10::ETCH',
        jump_status: 'deleted',
        metadata_status: 'complete',
      },
    ],
    baseline_entry: null,
    initial_entry: null,
    initial_state_unavailable: true,
    next_cursor: null,
  }
}
