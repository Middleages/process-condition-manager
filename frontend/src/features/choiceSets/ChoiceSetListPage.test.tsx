import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { ChoiceSetSummaryOut } from '@/api/types'

import {
  ChoiceSetListRouteHeader,
  ChoiceSetListView,
  choiceSetListQueryOptions,
  filterChoiceSets,
} from './ChoiceSetListPage'

const sets: ChoiceSetSummaryOut[] = [
  {
    code: 'equipment_mode',
    display_name: '설비 모드',
    description: '공용 모드',
    is_active: true,
    version: 7,
    option_count: 3,
    active_option_count: 2,
    parameter_usage_count: 4,
    profile_usage_fields: ['device_type_code'],
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T02:03:04Z',
  },
  {
    code: 'legacy_mode',
    display_name: '이전 모드',
    description: null,
    is_active: false,
    version: 2,
    option_count: 1,
    active_option_count: 0,
    parameter_usage_count: 0,
    profile_usage_fields: [],
    created_at: '2026-07-13T00:00:00Z',
    updated_at: '2026-07-13T00:00:00Z',
  },
]

describe('ChoiceSetListPage', () => {
  it('always loads active and inactive sets once for local filters', () => {
    expect(choiceSetListQueryOptions().queryKey).toEqual([
      'choice-sets',
      'list',
      true,
    ])
  })

  it('filters locally by exact URL-owned query and lifecycle state', () => {
    expect(filterChoiceSets(sets, { query: 'legacy', active: 'all' })).toEqual([
      sets[1],
    ])
    expect(filterChoiceSets(sets, { query: '', active: 'inactive' })).toEqual([
      sets[1],
    ])
  })

  it('keeps a focusable route title mounted independently of async row state', () => {
    const html = renderToStaticMarkup(
      <ChoiceSetListRouteHeader onCreate={vi.fn()} />,
    )

    expect(html).toContain('data-page-title="true"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('선택지 집합')
  })

  it('renders the compact administration columns, usage, and inactive rows', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let html: string
    try {
      html = renderToStaticMarkup(
        <MemoryRouter>
          <>
            <ChoiceSetListRouteHeader onCreate={vi.fn()} />
            <ChoiceSetListView
              rows={sets}
              state={{ query: '', active: 'all' }}
              queryDraft=""
              onEdit={vi.fn()}
              onQueryChange={vi.fn()}
              onActiveChange={vi.fn()}
            />
          </>
        </MemoryRouter>,
      )
    } finally {
      consoleError.mockRestore()
    }

    for (const heading of [
      'Code',
      '표시명',
      '상태',
      '전체 / 활성',
      '파라미터 사용',
      'Profile 사용',
      '버전',
      '업데이트',
    ]) {
      expect(html).toContain(heading)
    }
    expect(html).toContain('equipment_mode')
    expect(html).toContain('legacy_mode')
    expect(html).toContain('사용 중지됨')
    expect(html).toContain('device_type_code')
    expect(html).toContain('새 선택지 집합')
    expect(html).toContain('class="h-9 shadow-')
    expect(html).toContain('whitespace-nowrap')
    expect(html).toContain('sticky right-0')
  })
})
