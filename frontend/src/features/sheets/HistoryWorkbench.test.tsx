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
  it('renders the current Layer scope as a continuous summary-only ledger', () => {
    const state = buildTimelineCountState(18)
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
    expect(html).toContain('LAYER 030 · CMP')
    expect(html).toContain('현재 Layer')
    expect(html).toContain('현재 셀만')
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('18건')
    expect(html).toContain('전체 변경 · dev-admin')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('필터에서 위치를 확인할 수 없는 과거 항목 2개')
    expect(html).toContain('상세를 불러올 수 없는 레거시 항목 1개')
    expect(html).toContain('dev-admin')
    expect(html).toContain('event-1')
    expect(html).toContain('삭제됨')
    expect(html).toContain('삭제된 대상이라 위치로 이동할 수 없습니다.')
    expect(html).not.toContain('이전 값')
    expect(html).not.toContain('변경 값')
    expect(html).toContain('다음 페이지 다시 시도')
    expect(html).not.toMatch(/>다음 페이지 불러오기<\/button>/)
    expect(html).toContain('다음 페이지를 불러오지 못했습니다.')
    expect(html).toContain('서버에서 이력 목록을 불러오지 못했습니다.')
    expect(html).toContain('기존 변경 이력은 유지됩니다.')
    expect(html).not.toContain('현재 Layer 변경 이력을 표시할 수 없습니다.')
    expect(html).toContain('aria-live="polite"')
    expect(source).not.toContain('handleHistoryWorkbenchItemActivationKey(')
    expect(source).not.toMatch(/onClick=\{handleJumpTargetActivate\}[\s\S]{0,100}onKeyDown=/)
    expect(source).toContain('shouldRequestHistoryBatchDetailOnOpen(')
    expect(source).toContain('onBatchToggle?.(item, shouldRequestDetail)')
    expect(source).toContain('parsePositiveIntegerText(')
    expect(source).toContain('onLoadMoreTimeline?.(state.nextCursor)')
    expect(source).toContain('onLoadMoreCell?.(cellHistory?.next_cursor ?? null)')
    expect(source).toContain('onClick={handleApplyFilters}')
    expect(html).not.toMatch(/class="[^"]*rounded[^"]*" data-history-item/)
    expect(source).not.toMatch(/(?:md|lg|xl):grid-cols/)
  })

  it('keeps Layer scope active when cell scope cannot be opened and describes unavailable scope', () => {
    const state = appendHistoryWorkbenchPage(createHistoryWorkbenchState(), {
      items: [createAvailableEvent()],
      nextCursor: null,
    })
    const onScopeChange = vi.fn(() => false)
    const unavailableHtml = render(state, { selectedCellAvailable: false })

    expect(unavailableHtml).toContain('id="history-cell-scope-help"')
    expect(unavailableHtml).toContain('그리드에서 셀을 선택하면 사용할 수 있습니다.')
    expect(unavailableHtml).toMatch(/aria-describedby="history-cell-scope-help"[^>]*disabled=""/)

    const { container, cleanup } = renderInteractive(state, {
      onScopeChange,
      selectedCellAvailable: true,
    })
    try {
      const cellScope = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === '현재 셀만',
      )
      if (cellScope === undefined) throw new Error('Cell scope control is unavailable')
      act(() => cellScope.click())

      expect(onScopeChange).toHaveBeenCalledOnce()
      expect(onScopeChange).toHaveBeenCalledWith('cell')
      expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
        '현재 Layer',
      )
      expect(container.textContent).toContain('선택한 셀 이력을 열 수 없습니다.')
      expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    } finally {
      cleanup()
    }
  })

  it('uses roving radio focus and arrow keys without entering a disabled cell scope', () => {
    const state = createHistoryWorkbenchState()
    const onScopeChange = vi.fn(() => true)
    const { container, cleanup } = renderInteractive(state, {
      onScopeChange,
      selectedCellAvailable: true,
    })

    try {
      const layerScope = findScopeRadio(container, '현재 Layer')
      const cellScope = findScopeRadio(container, '현재 셀만')
      expect(layerScope.tabIndex).toBe(0)
      expect(cellScope.tabIndex).toBe(-1)

      layerScope.focus()
      act(() =>
        layerScope.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' })),
      )
      expect(onScopeChange).toHaveBeenLastCalledWith('cell')
      expect(document.activeElement).toBe(cellScope)

      act(() =>
        cellScope.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' })),
      )
      expect(onScopeChange).toHaveBeenLastCalledWith('timeline')
      expect(document.activeElement).toBe(layerScope)
    } finally {
      cleanup()
    }

    const disabledScopeChange = vi.fn(() => true)
    const disabled = renderInteractive(state, {
      onScopeChange: disabledScopeChange,
      selectedCellAvailable: false,
    })
    try {
      const layerScope = findScopeRadio(disabled.container, '현재 Layer')
      const cellScope = findScopeRadio(disabled.container, '현재 셀만')
      layerScope.focus()
      act(() =>
        layerScope.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })),
      )
      expect(disabledScopeChange).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(layerScope)
      expect(cellScope.tabIndex).toBe(-1)
    } finally {
      disabled.cleanup()
    }
  })

  it('navigates only from the explicit cell button and keeps deleted history in place', () => {
    const state = appendHistoryWorkbenchPage(createHistoryWorkbenchState(), {
      items: [createAvailableEvent(), createDeletedEvent()],
      nextCursor: null,
    })
    const onActivateTarget = vi.fn()
    const { container, cleanup } = renderInteractive(state, { onActivateTarget })

    try {
      const rows = container.querySelectorAll<HTMLElement>('[data-history-item]')
      expect(rows).toHaveLength(2)
      expect(rows[0]?.onclick).toBeNull()
      expect(rows[0]?.className).not.toContain('rounded')
      act(() => rows[0]?.click())
      expect(onActivateTarget).not.toHaveBeenCalled()

      const move = [...rows[0]!.querySelectorAll('button')].find(
        (button) => button.textContent === '셀로 이동',
      )
      if (move === undefined) throw new Error('Cell navigation button is unavailable')
      act(() => move.click())
      expect(onActivateTarget).toHaveBeenCalledOnce()

      const deletedMove = rows[1]?.querySelector<HTMLButtonElement>('button')
      expect(deletedMove?.disabled).toBe(true)
      expect(rows[1]?.textContent).toContain('삭제된 대상이라 위치로 이동할 수 없습니다.')
    } finally {
      cleanup()
    }
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
      expect(
        [...container.querySelectorAll<HTMLSelectElement>('select option')].map(
          (option) => option.textContent,
        ),
      ).toEqual(['전체', '직접 입력', '붙여넣기', '백본', '시스템'])
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

  it('renders authoritative cell comparisons with explicit labels and initial-state fallback text', () => {
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

    expect(html).toContain('현재 셀만')
    expect(html).toContain('condition #11')
    expect(html).toContain('parameter ETCH_P001')
    expect(html).toContain('이전 값')
    expect(html).toContain('변경 값')
    expect(html).toContain('OLD')
    expect(html).toContain('NEW')
    expect(html).toContain('choice')
    expect(html).toContain('없음')
    expect(html).toContain('기준 셀이 없는 초기 상태입니다.')
    expect(html).toContain('초기 셀 상태를 확인할 수 없습니다.')
    expect(html).toContain('삭제된 대상이라 위치로 이동할 수 없습니다.')
    expect(html).toContain('2026-07-17T00:00:00Z')
    expect(html).toContain('더 보기 다시 시도')
    expect(html).not.toMatch(/>더 보기<\/button>/)
    expect(html).toContain('셀 다음 페이지를 불러오지 못했습니다.')
  })

  it('disables timeline and cell pagination with truthful loading copy', () => {
    const timelineHtml = render(buildTimelineCountState(1), {
      timelineIsFetchingNextPage: true,
      onLoadMoreTimeline: vi.fn(),
    })
    const cellState = openHistoryCellScope(createHistoryWorkbenchState(), {
      conditionId: 11,
      parameterCode: 'ETCH_P001',
    })
    const cellHtml = render(cellState, {
      cellHistory: cellHistory(),
      cellIsFetchingNextPage: true,
      onLoadMoreCell: vi.fn(),
    })

    expect(timelineHtml).toMatch(/<button[^>]*disabled=""[^>]*>다음 페이지 불러오는 중<\/button>/)
    expect(cellHtml).toMatch(/<button[^>]*disabled=""[^>]*>더 불러오는 중<\/button>/)

    const timelineRetryHtml = render(buildTimelineCountState(1), {
      nextPageError: '다음 페이지 실패',
      timelineIsFetchingNextPage: true,
      onLoadMoreTimeline: vi.fn(),
    })
    const cellRetryHtml = render(cellState, {
      cellHistory: cellHistory(),
      cellNextPageError: '셀 다음 페이지 실패',
      cellIsFetchingNextPage: true,
      onLoadMoreCell: vi.fn(),
    })

    expect(timelineRetryHtml).toMatch(
      /<button[^>]*disabled=""[^>]*>다음 페이지 불러오는 중<\/button>/,
    )
    expect(cellRetryHtml).toMatch(/<button[^>]*disabled=""[^>]*>더 불러오는 중<\/button>/)
  })

  it('wraps long actor identifiers in timeline, cell, and batch-detail ledgers', () => {
    const longActor = `operator_${'x'.repeat(88)}`
    const timelineItem = { ...createAvailableEvent(), actors: [longActor] }
    const timelineHtml = render(
      appendHistoryWorkbenchPage(createHistoryWorkbenchState(), {
        items: [timelineItem],
        nextCursor: null,
      }),
    )

    const cell = cellHistory()
    cell.items[0] = { ...cell.items[0]!, actor: longActor }
    const cellHtml = render(
      openHistoryCellScope(createHistoryWorkbenchState(), {
        conditionId: 11,
        parameterCode: 'ETCH_P001',
      }),
      { cellHistory: cell },
    )

    const detail = detailFixture()
    detail.items[0] = { ...detail.items[0]!, actor: longActor }
    const detailHtml = render(buildTimelineState(detail))

    expect(classNameForText(timelineHtml, longActor)).toContain('break-words')
    expect(classNameForText(cellHtml, longActor)).toContain('break-words')
    expect(classNameForText(detailHtml, longActor)).toContain('break-words')
  })

  it('keeps initial Choice context while rendering a successful empty cell ledger', () => {
    const state = openHistoryCellScope(createHistoryWorkbenchState(), {
      conditionId: 11,
      parameterCode: 'ETCH_P001',
    })
    const html = render(state, {
      cellHistory: {
        items: [],
        baseline_entry: { code: 'BASE', label: 'POR' },
        initial_entry: { code: 'INIT', label: 'Recipe A' },
        initial_state_unavailable: false,
        next_cursor: null,
      },
    })

    expect(html).toContain('선택한 셀에 기록된 변경이 없습니다.')
    expect(html).toContain('기준 셀 POR (BASE)')
    expect(html).toContain('초기 항목 Recipe A (INIT)')
  })

  it('keeps the first batch detail fetch lazy and cached in the state path', () => {
    const state = buildTimelineState()
    const item = state.pages[0].items[1]
    const batchKey = getHistoryTimelineItemKey(item)

    expect(batchKey).toContain('scope-2::batch-2')
    const html = render(state)
    expect(html).toContain('2개 변경 접기')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-controls="history-batch-detail-scope-2::batch-2"')
    expect(html).toContain('이전 값')
    expect(html).toContain('변경 값')
    expect(html).toContain('OLD')
    expect(html).toContain('NEW')
    expect(html).not.toContain('event_desc')
    expect(html).not.toContain('>available<')

    const alternateDetail = detailFixture()
    alternateDetail.order_kind = 'capture_asc'
    alternateDetail.detail_status = 'legacy_unavailable'
    const alternateHtml = render(buildTimelineState(alternateDetail))
    expect(alternateHtml).not.toContain('capture_asc')
    expect(alternateHtml).not.toContain('legacy_unavailable')

    const collapsed = toggleHistoryBatchDetail(state, batchKey)
    expect(render(collapsed)).toContain('2개 변경 펼치기')
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
    expect(html).toContain('이 배치의 개별 변경을 표시할 수 없습니다.')
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

    expect(html).toContain('셀로 이동')
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
      currentLayerLabel="LAYER 030 · CMP"
      projectId={7}
      selectedCellAvailable
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
        currentLayerLabel="LAYER 030 · CMP"
        projectId={7}
        selectedCellAvailable
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

function findScopeRadio(container: HTMLElement, label: string): HTMLButtonElement {
  const radio = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (candidate) => candidate.textContent === label,
  )
  if (radio === undefined) throw new Error(`${label} scope radio is unavailable`)
  return radio
}

function classNameForText(html: string, text: string): string {
  const host = document.createElement('div')
  host.innerHTML = html
  const match = [...host.querySelectorAll<HTMLElement>('*')].find(
    (element) => element.childElementCount === 0 && element.textContent?.includes(text),
  )
  if (match === undefined) throw new Error(`Element containing ${text} is unavailable`)
  return match.className
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

function buildTimelineCountState(count: number): HistoryWorkbenchState {
  return appendHistoryWorkbenchPage(createHistoryWorkbenchState({ actor: 'dev-admin' }), {
    items: Array.from({ length: count }, (_, index) => ({
      ...createDeletedEvent(),
      cursor_id: index + 1,
      summary: `event-${index + 1}`,
    })),
    nextCursor: 'cursor-2',
  })
}

function createAvailableEvent(): HistoryTimelineItemOut {
  return {
    ...createDeletedEvent(),
    cursor_id: 3,
    summary: 'available-event',
    jump_target: {
      ...createDeletedEvent().jump_target!,
      jump_status: 'available',
    },
  }
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
      {
        event_id: 32,
        old_code: null,
        new_code: null,
        choice_label: null,
        actor: null,
        origin: 'system',
        created_at: '2026-07-16T00:00:00Z',
        layer_key: 'L1::10::ETCH',
        jump_status: 'available',
        metadata_status: 'complete',
      },
    ],
    baseline_entry: null,
    initial_entry: null,
    initial_state_unavailable: true,
    next_cursor: 'cell-cursor-2',
  }
}
