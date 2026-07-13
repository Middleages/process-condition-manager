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
  min_value: 0,
  max_value: 100,
  sort_order: 0,
  is_active: true,
  options: [],
}

const inactiveParameter: ParameterOut = {
  ...activeParameter,
  id: 2,
  code: 'legacy_exposure',
  display_name: 'Legacy exposure',
  is_active: false,
}

function renderPage(location = '/parameters'): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(['parameter-categories', true], categories)
  queryClient.setQueryData(['parameters', false], [activeParameter, inactiveParameter])
  queryClient.setQueryData(['parameters', true], [activeParameter, inactiveParameter])

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
})
