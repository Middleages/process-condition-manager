// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
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
import {
  activateHistoryDetailTarget,
  applyHistoryWorkbenchFilterDraft,
  describeHistoryFilters,
  HistoryWorkbench,
  validateHistoryWorkbenchFilterDraft,
} from './HistoryWorkbench'
import source from './HistoryWorkbench.tsx?raw'

const testGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
testGlobals.IS_REACT_ACT_ENVIRONMENT = true

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
    expect(html).toContain('전체 변경 · dev-admin')
    expect(html).toContain('aria-expanded="false"')
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
    expect(html).toContain('aria-live="polite"')
    expect(source).not.toContain('handleHistoryWorkbenchItemActivationKey(')
    expect(source).not.toMatch(/onClick=\{handleJumpTargetActivate\}[\s\S]{0,100}onKeyDown=/)
    expect(source).toContain('shouldRequestHistoryBatchDetailOnOpen(')
    expect(source).toContain('onBatchToggle?.(item, shouldRequestDetail)')
    expect(source).toContain('parsePositiveIntegerText(')
    expect(source).toContain('onLoadMoreTimeline?.(state.nextCursor)')
    expect(source).toContain('onLoadMoreCell?.(cellHistory?.next_cursor ?? null)')
    expect(source).toContain('onClick={handleApplyFilters}')
  })

  it('describes applied filters without exposing the authoritative Layer as a draft filter', () => {
    expect(describeHistoryFilters(createHistoryWorkbenchState().filters)).toBe(
      '전체 변경 · 전체 작업자',
    )
    expect(
      describeHistoryFilters(
        createHistoryWorkbenchState({
          actor: '김민수',
          origin: 'manual',
          eventTypes: ['cell_update', 'por_change'],
        }).filters,
      ),
    ).toBe('직접 입력 · 변경 유형 2개 · 김민수')

    const timelineOnlyState = appendHistoryWorkbenchPage(createHistoryWorkbenchState(), {
      items: [createDeletedEvent()],
      nextCursor: null,
    })
    const html = render(timelineOnlyState)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('전체 변경 · 전체 작업자')
    expect(html).not.toContain('>Layer<')
  })

  it('keeps existing history rows when an expanded draft has an invalid source project', () => {
    const state = appendHistoryWorkbenchPage(createHistoryWorkbenchState(), {
      items: [createDeletedEvent()],
      nextCursor: null,
    })
    const onFiltersChange = vi.fn()
    const { container, cleanup } = renderInteractive(state, { onFiltersChange })

    try {
      const disclosure = container.querySelector<HTMLButtonElement>('[aria-controls="history-filter-panel"]')
      if (disclosure === null) throw new Error('History filter disclosure is unavailable')
      act(() => disclosure.click())

      expect(container.querySelector('#history-filter-panel')).not.toBeNull()
      const sourceInput = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')
      if (sourceInput === null) throw new Error('Source project input is unavailable')
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set
        if (setter === undefined) throw new Error('Input value setter is unavailable')
        setter.call(sourceInput, 'not-a-project')
        sourceInput.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const apply = [...container.querySelectorAll('button')].find((button) => button.textContent === '적용')
      if (apply === undefined) throw new Error('Filter apply button is unavailable')
      act(() => apply.click())

      expect(onFiltersChange).not.toHaveBeenCalled()
      expect(container.textContent).toContain('event-1')
      expect(container.textContent).toContain('Source project는 1 이상의 정수로 입력해 주세요.')
    } finally {
      cleanup()
    }
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

    expect(batchKey).toContain('scope-2::batch-2')
    expect(render(state)).toContain('OLD → NEW')

    const collapsed = toggleHistoryBatchDetail(state, batchKey)
    const loaded = storeHistoryBatchDetail(collapsed, batchKey, detailFixture())
    const reopened = toggleHistoryBatchDetail(loaded, batchKey)

    expect(loaded.batchDetailCache[batchKey]).toBeDefined()
    expect(reopened.batchDetailCache[batchKey]).toBeDefined()
  })

  it('renders truthful batch-detail failure and retry instead of permanent fake loading', () => {
    const item = createExpandedBatchItem()
    const page = appendHistoryWorkbenchPage(createHistoryWorkbenchState(), {
      items: [item],
      nextCursor: null,
    })
    const expanded = toggleHistoryBatchDetail(page, getHistoryTimelineItemKey(item))
    const html = render(expanded, {
      batchDetailStatus: 'error',
      batchDetailError: '상세 조회 실패',
      onRetryBatchDetail: vi.fn(),
    })

    expect(html).toContain('상세 조회 실패')
    expect(html).toContain('상세 다시 시도')
    expect(html).not.toContain('상세 이력을 불러오는 중입니다.')
  })

  it('renders detail-cell navigation, disabled deletion, unique capture keys, and detail pagination', () => {
    const onActivateTarget = vi.fn()
    const availableTarget = detailFixture().items[0]!.jump_target!
    const deletedTarget = { ...availableTarget, jump_status: 'deleted' as const }
    const detail = detailFixture()
    detail.next_cursor = 'detail-cursor-2'
    detail.items.push({
      ...detail.items[0]!,
      jump_target: deletedTarget,
      capture_tuple: {
        target_layer_sort: 1,
        target_layer_key: 'L1::10::ETCH',
        source_condition_index: 2,
        source_condition_id: 31,
        parameter_sort: 3,
        parameter_code: 'ETCH_P001',
        event_id: 21,
      },
    })
    const state = buildTimelineState(detail)
    const html = render(state, {
      batchDetailNextPageError: '상세 다음 페이지 실패',
      onLoadMoreBatchDetail: vi.fn(),
      onActivateTarget,
    })

    expect(html).toContain('상세 셀로 이동')
    expect(html).toContain('상세 다음 페이지 실패')
    expect(html).toContain('상세 다음 페이지 다시 시도')
    expect(html).toMatch(/disabled=""[^>]*>삭제됨</)
    expect(activateHistoryDetailTarget(availableTarget, onActivateTarget)).toBe(true)
    expect(onActivateTarget).toHaveBeenCalledOnce()
    expect(activateHistoryDetailTarget(deletedTarget, onActivateTarget)).toBe(false)
    expect(onActivateTarget).toHaveBeenCalledOnce()
    expect(source).toContain('getHistoryDetailItemKey(entry)')
  })

  it('rejects invalid source-project and date drafts without broadening applied filters', () => {
    const applied = vi.fn()
    expect(
      applyHistoryWorkbenchFilterDraft(
        createHistoryWorkbenchState({ actor: 'dev-admin' }).filters,
        'not-a-project',
        applied,
      ),
    ).toBe('Source project는 1 이상의 정수로 입력해 주세요.')
    expect(applied).not.toHaveBeenCalled()

    expect(
      validateHistoryWorkbenchFilterDraft(
        createHistoryWorkbenchState({ actor: 'dev-admin' }).filters,
        'not-a-project',
      ),
    ).toEqual({
      ok: false,
      message: 'Source project는 1 이상의 정수로 입력해 주세요.',
    })
    expect(
      validateHistoryWorkbenchFilterDraft(
        { ...createHistoryWorkbenchState().filters, createdFrom: 'not-a-date' },
        '',
      ),
    ).toEqual({
      ok: false,
      message: '기간은 유효한 ISO 날짜/시간으로 입력해 주세요.',
    })
    expect(
      validateHistoryWorkbenchFilterDraft(
        createHistoryWorkbenchState({ actor: 'dev-admin' }).filters,
        '17',
      ),
    ).toMatchObject({
      ok: true,
      filters: { actor: 'dev-admin', sourceProjectId: 17 },
    })
    expect(
      applyHistoryWorkbenchFilterDraft(
        createHistoryWorkbenchState({ actor: 'dev-admin' }).filters,
        '17',
        applied,
      ),
    ).toBeNull()
    expect(applied).toHaveBeenCalledOnce()
    expect(applied).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'dev-admin', sourceProjectId: 17 }),
    )
    expect(source).toContain('role="alert"')
    expect(source).toContain('setFilterError(null)')
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

function renderInteractive(
  state: HistoryWorkbenchState,
  overrides: Partial<Parameters<typeof HistoryWorkbench>[0]> = {},
): { readonly container: HTMLDivElement; readonly cleanup: () => void } {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(
      <HistoryWorkbench
        projectId={7}
        state={state}
        coverage={{
          legacy_unresolved_layer_count: 0,
          legacy_detail_unavailable_count: 0,
        }}
        timelineStatus="ready"
        cellStatus="ready"
        {...overrides}
      />,
    )
  })
  return {
    container,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function buildTimelineState(detail: HistoryDetailOut = detailFixture()): HistoryWorkbenchState {
  const initial = createHistoryWorkbenchState({ actor: 'dev-admin' })
  const withPage = appendHistoryWorkbenchPage(initial, {
    items: [createDeletedEvent(), createExpandedBatchItem()],
    nextCursor: 'cursor-2',
  })
  const expanded = toggleHistoryBatchDetail(withPage, getHistoryTimelineItemKey(createExpandedBatchItem()))
  return storeHistoryBatchDetail(expanded, getHistoryTimelineItemKey(createExpandedBatchItem()), detail)
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
    jump_target: null,
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
    next_cursor: 'cell-cursor-2',
  }
}
