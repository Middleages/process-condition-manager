import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { CategoryOut, ParameterOut } from '@/api/types'

import { ParameterAdminPage } from './ParameterAdminPage'

const categories: CategoryOut[] = [
  { id: 1, code: 'photo', display_name: 'Photo', sort_order: 0, is_active: true },
]

const activeParameter: ParameterOut = {
  id: 1,
  code: 'exposure_time',
  display_name: 'Exposure time',
  description: 'Main exposure',
  value_type: 'number',
  category_id: 1,
  unit: 'ms',
  min_value: '0',
  max_value: '100',
  required: false,
  pattern: null,
  pattern_hint: null,
  choice_set: null,
  sort_order: 0,
  is_active: true,
}

const inactiveParameter: ParameterOut = {
  ...activeParameter,
  id: 2,
  code: 'legacy_exposure',
  display_name: 'Legacy exposure',
  is_active: false,
}

function renderPage(
  location = '/parameters',
  parameters: readonly ParameterOut[] = [activeParameter, inactiveParameter],
): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(['parameter-categories', true], categories)
  queryClient.setQueryData(['parameters', false], parameters)
  queryClient.setQueryData(['parameters', true], parameters)

  const router = createMemoryRouter(
    [{ path: '/parameters', element: <ParameterAdminPage /> }],
    { initialEntries: [location] },
  )
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
  } finally {
    consoleError.mockRestore()
  }
}

describe('ParameterAdminPage', () => {
  it('puts the active-only compact registry in the first page surface', () => {
    const html = renderPage()

    expect(html).toContain('data-page-title="true"')
    expect(html).toContain('aria-label="파라미터 관리 섹션"')
    expect(html).toContain('href="/parameters/choice-sets"')
    expect(html).toContain('CSV 가져오기')
    expect(html).toContain('카테고리 추가')
    expect(html).toContain('새 파라미터')
    expect(html).toContain('exposure_time')
    expect(html).not.toContain('legacy_exposure')
    expect(html).toContain('Photo')
    expect(html).toContain('0–100 ms')
    expect(html).toContain('scope="col"')
    expect(html.match(/scope="col"/g)).toHaveLength(7)
    expect(html).toContain(
      '<tr class="h-9 shadow-[inset_0_1px_0_var(--color-border-subtle)]">',
    )
    expect(html).toMatch(/data-parameter-edit-trigger="1"[^>]*class="[^"]*h-9[^"]*"/)
    expect(html).toContain('data-parameter-edit-trigger="1"')
    expect(html).toContain('data-parameter-list-heading="true"')
    expect(html).toContain('<option value="text">text</option>')
    expect(html).toContain('<option value="number">number</option>')
    expect(html).toContain('<option value="choice">choice</option>')
    expect(html).not.toContain('<option value="date">')
    expect(html).not.toContain('<option value="boolean">')
  })

  it('restores inactive-only filtering without changing server order', () => {
    const html = renderPage('/parameters?active=inactive')

    expect(html).not.toContain('exposure_time</')
    expect(html).toContain('legacy_exposure')
    expect(html).toContain('비활성')
    expect(html).not.toContain('다시 활성화')
  })

  it('keeps list filters visible when an invalid direct editor target opens', () => {
    const html = renderPage('/parameters?query=exposure&category=photo&edit=abc')

    expect(html).toContain('value="exposure"')
    expect(html).toContain('value="photo" selected=""')
    expect(html).toContain('파라미터를 열 수 없습니다')
    expect(html).toContain('잘못된 편집 주소입니다.')
  })

  it('shows the managed ChoiceSet identity instead of an embedded option count', () => {
    const managedChoice: ParameterOut = {
      ...activeParameter,
      id: 3,
      code: 'mode',
      display_name: 'Mode',
      value_type: 'choice',
      unit: null,
      min_value: null,
      max_value: null,
      choice_set: {
        code: 'equipment_mode',
        display_name: 'Equipment mode',
        description: null,
        is_active: true,
        version: 2,
        option_count: 20,
        active_option_count: 18,
        parameter_usage_count: 4,
        profile_usage_fields: [],
        created_at: '2026-07-14T00:00:00Z',
        updated_at: '2026-07-14T00:00:00Z',
      },
    }
    const html = renderPage('/parameters', [managedChoice])

    expect(html).toContain('equipment_mode')
    expect(html).toContain('Equipment mode')
    expect(html).not.toContain('18개 선택지')
  })

  it('shows no legacy range or unit constraint for text parameters', () => {
    const textParameter: ParameterOut = {
      ...activeParameter,
      id: 4,
      code: 'operator_note',
      display_name: 'Operator note',
      value_type: 'text',
      unit: 'legacy-unit',
      min_value: '1',
      max_value: '2',
    }
    const html = renderPage('/parameters', [textParameter])

    expect(html).toContain('operator_note')
    expect(html).toContain('>—</span>')
    expect(html).not.toContain('legacy-unit')
    expect(html).not.toContain('1–2')
  })

  it('shows user-facing pattern guidance without rendering the raw pattern', () => {
    const textParameter: ParameterOut = {
      ...activeParameter,
      id: 5,
      code: 'mask_id',
      display_name: 'Mask ID',
      value_type: 'text',
      unit: null,
      min_value: null,
      max_value: null,
      required: true,
      pattern: '[A-Z]{2}-[0-9]{4}',
      pattern_hint: '영문 대문자 2자리-숫자 4자리',
    }
    const html = renderPage('/parameters', [textParameter])

    expect(html).toContain('영문 대문자 2자리-숫자 4자리')
    expect(html).toContain('필수')
    expect(html).not.toContain('[A-Z]{2}-[0-9]{4}')
  })
})
