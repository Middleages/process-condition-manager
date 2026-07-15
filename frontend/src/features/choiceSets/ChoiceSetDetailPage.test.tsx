import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { ChoiceOptionOut, ChoiceSetSummaryOut } from '@/api/types'

import {
  ChoiceSetDetailRouteHeader,
  ChoiceSetDetailView,
  buildChoiceReorderSubmission,
  choiceSetAdminSessionForRoute,
  choiceOrderReducer,
  createChoiceSetDetailOwnerElement,
  hasUnsavedChoiceOrder,
  isChoiceReorderAvailable,
  ownChoiceSetAdminSession,
  startChoiceOrderSession,
} from './ChoiceSetDetailPage'

const summary: ChoiceSetSummaryOut = {
  code: 'equipment_mode',
  display_name: '설비 모드',
  description: '여러 화면에서 공유합니다.',
  is_active: true,
  version: 7,
  option_count: 102,
  active_option_count: 101,
  parameter_usage_count: 4,
  profile_usage_fields: ['device_type_code', 'active_direction_code'],
  created_at: '2026-07-14T00:00:00Z',
  updated_at: '2026-07-14T00:00:00Z',
}

const options: ChoiceOptionOut[] = Array.from({ length: 102 }, (_, index) => ({
  code: `MODE_${String(index + 1).padStart(3, '0')}`,
  label: `모드 ${index + 1}`,
  sort_order: (index + 1) * 10,
  is_active: index !== 1,
}))

describe('ChoiceSetDetailPage', () => {
  it('keys the complete detail owner by setCode so A state cannot survive on B', () => {
    const ownerA = createChoiceSetDetailOwnerElement('A')
    const ownerB = createChoiceSetDetailOwnerElement('B')

    expect(ownerA.key).toBe('A')
    expect(ownerA.props.setCode).toBe('A')
    expect(ownerB.key).toBe('B')
    expect(ownerB.props.setCode).toBe('B')
  })

  it('retains the editor-owned exact snapshot while the live pair temporarily disappears', () => {
    const ownedSnapshot = {
      summary: { ...summary, option_count: 3, active_option_count: 2 },
      aggregate: {
        set_code: summary.code,
        version: summary.version,
        items: options.slice(0, 3),
      },
    }
    const owner = ownChoiceSetAdminSession(
      ownedSnapshot,
      { kind: 'create' as const },
    )
    const liveSnapshot = null

    expect(liveSnapshot).toBeNull()
    expect(choiceSetAdminSessionForRoute(owner, summary.code)).toBe(owner)
    expect(owner.snapshot).toBe(ownedSnapshot)
  })

  it('discards an A-owned editor session before rendering the B route', () => {
    const ownedSnapshot = {
      summary: {
        ...summary,
        code: 'A',
        option_count: 3,
        active_option_count: 2,
      },
      aggregate: {
        set_code: 'A',
        version: summary.version,
        items: options.slice(0, 3),
      },
    }
    const owner = ownChoiceSetAdminSession(
      ownedSnapshot,
      { kind: 'create' as const },
    )

    expect(choiceSetAdminSessionForRoute(owner, 'B')).toBeNull()
  })

  it('only permits full-code reorder when no query or lifecycle filter hides rows', () => {
    expect(isChoiceReorderAvailable({ query: '', active: 'all' })).toBe(true)
    expect(isChoiceReorderAvailable({ query: 'mode', active: 'all' })).toBe(false)
    expect(isChoiceReorderAvailable({ query: '', active: 'active' })).toBe(false)
  })

  it('preserves the full order on conflict, explicitly rebases, and retries once', () => {
    const initialOptions = options.slice(0, 3)
    const snapshot = {
      summary: { ...summary, option_count: 3, active_option_count: 2 },
      aggregate: {
        set_code: summary.code,
        version: summary.version,
        items: initialOptions,
      },
    }
    let order = startChoiceOrderSession(snapshot)
    order = choiceOrderReducer(order, {
      type: 'move',
      code: initialOptions[1]?.code ?? '',
      delta: -1,
    })
    order = choiceOrderReducer(order, {
      type: 'conflict',
      latest: { ...snapshot.summary, version: 8 },
    })

    expect(order.orderedOptions.map(({ code }) => code)).toEqual([
      'MODE_002',
      'MODE_001',
      'MODE_003',
    ])
    expect(
      buildChoiceReorderSubmission(order, snapshot, { query: '', active: 'all' }, false),
    ).toBeNull()

    const latestSnapshot = {
      summary: { ...snapshot.summary, version: 8 },
      aggregate: {
        set_code: summary.code,
        version: 8,
        items: [initialOptions[0]!, initialOptions[2]!, initialOptions[1]!],
      },
    }
    order = choiceOrderReducer(order, {
      type: 'reload-latest',
      snapshot: latestSnapshot,
    })
    const submission = buildChoiceReorderSubmission(
      order,
      latestSnapshot,
      { query: '', active: 'all' },
      false,
    )

    expect(order.baseVersion).toBe(8)
    expect(order.orderedOptions.map(({ code }) => code)).toEqual([
      'MODE_002',
      'MODE_001',
      'MODE_003',
    ])
    expect(submission).toEqual({
      setCode: 'equipment_mode',
      payload: {
        expected_version: 8,
        ordered_codes: ['MODE_002', 'MODE_001', 'MODE_003'],
      },
    })
    expect(new Set(submission?.payload.ordered_codes).size).toBe(3)
  })

  it('reconciles the mutation response before refetch and clears a transient conflict', () => {
    const snapshot = {
      summary: { ...summary, option_count: 3, active_option_count: 2 },
      aggregate: {
        set_code: summary.code,
        version: summary.version,
        items: options.slice(0, 3),
      },
    }
    let order = choiceOrderReducer(startChoiceOrderSession(snapshot), {
      type: 'move',
      code: 'MODE_002',
      delta: -1,
    })
    order = choiceOrderReducer(order, {
      type: 'conflict',
      latest: { ...snapshot.summary, version: 8 },
    })
    order = choiceOrderReducer(order, {
      type: 'save-success',
      summary: { ...snapshot.summary, version: 8 },
    })

    expect(order).toMatchObject({
      baseVersion: 8,
      conflict: null,
      dirty: false,
      rebased: false,
    })
    expect(hasUnsavedChoiceOrder(order)).toBe(false)
  })

  it('marks dirty or conflicted full-order drafts as unsaved navigation work', () => {
    const snapshot = {
      summary: { ...summary, option_count: 3, active_option_count: 2 },
      aggregate: {
        set_code: summary.code,
        version: summary.version,
        items: options.slice(0, 3),
      },
    }
    const clean = startChoiceOrderSession(snapshot)
    const dirty = choiceOrderReducer(clean, {
      type: 'move',
      code: 'MODE_002',
      delta: -1,
    })
    const conflicted = choiceOrderReducer(dirty, {
      type: 'conflict',
      latest: { ...snapshot.summary, version: 8 },
    })

    expect(hasUnsavedChoiceOrder(null)).toBe(false)
    expect(hasUnsavedChoiceOrder(clean)).toBe(false)
    expect(hasUnsavedChoiceOrder(dirty)).toBe(true)
    expect(hasUnsavedChoiceOrder(conflicted)).toBe(true)
  })

  it('keeps a focusable detail route title mounted before summary data arrives', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let html: string
    try {
      html = renderToStaticMarkup(
        <MemoryRouter>
          <ChoiceSetDetailRouteHeader
            setCode="equipment_mode"
            onAdd={vi.fn()}
            onEditSet={vi.fn()}
            onImport={vi.fn()}
          />
        </MemoryRouter>,
      )
    } finally {
      consoleError.mockRestore()
    }

    expect(html).toContain('data-page-title="true"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('equipment_mode')
  })

  it('blocks reorder for mismatch, pending work, or an unresolved conflict', () => {
    const exact = {
      summary: { ...summary, option_count: 3, active_option_count: 2 },
      aggregate: {
        set_code: summary.code,
        version: summary.version,
        items: options.slice(0, 3),
      },
    }
    const order = startChoiceOrderSession(exact)
    const mismatch = {
      ...exact,
      aggregate: { ...exact.aggregate, version: 8 },
    }

    expect(
      buildChoiceReorderSubmission(order, mismatch, { query: '', active: 'all' }, false),
    ).toBeNull()
    expect(
      buildChoiceReorderSubmission(order, exact, { query: '', active: 'all' }, true),
    ).toBeNull()
  })

  it('renders usage blast radius, inactive rows, and the initial 100-row window', () => {
    const html = renderDetail({ query: '', active: 'all' }, options, 100)

    expect(html).toContain('파라미터 4곳')
    expect(html).toContain('고정 Profile 필드 2곳')
    expect(html).toContain('device_type_code')
    expect(html).toContain('active_direction_code')
    expect(html).toContain('MODE_002')
    expect(html).toContain('사용 중지됨')
    expect(html).toContain('MODE_100')
    expect(html).not.toContain('MODE_101')
    expect(html).toContain('더 보기')
    expect(html).toContain('class="h-9 shadow-')
    expect(html).toContain('whitespace-nowrap')
  })

  it('disables reorder with an explanation whenever filtered rows are hidden', () => {
    const html = renderDetail({ query: 'MODE_001', active: 'all' }, options, 100)

    expect(html).toContain('검색과 상태 필터를 해제해야 전체 순서를 바꿀 수 있습니다')
    expect(html).toMatch(/aria-label="MODE_001 위로"[^>]*disabled/)
    expect(html).toMatch(/aria-label="MODE_001 아래로"[^>]*disabled/)
  })

  it('keeps CSV import and add/edit actions in the full-page work area', () => {
    const html = renderDetail({ query: '', active: 'all' }, options.slice(0, 3), 100)

    expect(html).toContain('CSV 가져오기')
    expect(html).toContain('선택지 추가')
    expect(html).toContain('수정')
    expect(html).toContain('사용 중지')
  })
})

function renderDetail(
  state: { query: string; active: 'active' | 'inactive' | 'all' },
  rows: ChoiceOptionOut[],
  visibleLimit: number,
) {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    return renderToStaticMarkup(
      <MemoryRouter>
        <>
          <ChoiceSetDetailRouteHeader
            setCode={summary.code}
            summary={summary}
            onAdd={vi.fn()}
            onEditSet={vi.fn()}
            onImport={vi.fn()}
          />
          <ChoiceSetDetailView
            options={rows}
            queryDraft={state.query}
            state={state}
            summary={summary}
            visibleLimit={visibleLimit}
            onActiveChange={vi.fn()}
            onDeactivate={vi.fn()}
            onEdit={vi.fn()}
            onLoadMore={vi.fn()}
            onQueryChange={vi.fn()}
            onReorder={vi.fn()}
          />
        </>
      </MemoryRouter>,
    )
  } finally {
    consoleError.mockRestore()
  }
}
