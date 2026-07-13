import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { CategoryOut, ParameterOut } from '@/api/types'

import { ParameterDetailError, ParameterEditorDrawer } from './ParameterEditorDrawer'
import type { EditTarget } from './registryState'

const categories: CategoryOut[] = [
  { id: 1, code: 'photo', display_name: 'Photo', sort_order: 0, is_active: true },
]

const parameter: ParameterOut = {
  id: 42,
  code: 'tone',
  display_name: 'Tone',
  description: null,
  value_type: 'choice',
  category_id: 1,
  unit: null,
  min_value: null,
  max_value: null,
  sort_order: 0,
  is_active: true,
  options: [
    { id: 1, value: 'warm', display_name: 'Warm', sort_order: 0, is_active: true },
  ],
}

function renderDrawer(
  target: Exclude<EditTarget, { kind: 'closed' }>,
  detail: ParameterOut | null = parameter,
): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  if (target.kind === 'existing' && detail !== null) {
    queryClient.setQueryData(['parameters', 'detail', target.id], detail)
  }

  const router = createMemoryRouter(
    [
      {
        path: '/parameters',
        element: (
          <ParameterEditorDrawer
            categories={categories}
            fallbackFocusRef={{ current: null }}
            target={target}
            onClose={vi.fn()}
          />
        ),
      },
    ],
    { initialEntries: ['/parameters'] },
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

function renderMissingDetailError(): string {
  const missingError = Object.assign(new Error('missing'), {
    isAxiosError: true,
    response: {
      status: 404,
      data: { code: 'not_found', message: 'missing' },
    },
  })
  return renderToStaticMarkup(
    <ParameterDetailError error={missingError} onRetry={vi.fn()} />,
  )
}

describe('ParameterEditorDrawer', () => {
  it('renders invalid edit syntax as a drawer-local error', () => {
    const html = renderDrawer({ kind: 'invalid', raw: '0' })

    expect(html).toContain('<dialog')
    expect(html).toContain('파라미터를 열 수 없습니다')
    expect(html).toContain('잘못된 편집 주소입니다.')
  })

  it('keeps a missing direct ID inside the drawer instead of selecting a list row', () => {
    const html = renderMissingDetailError()

    expect(html).toContain('요청한 파라미터를 찾을 수 없습니다.')
    expect(html).toContain('목록 필터는 그대로 유지되었습니다.')
    expect(html).not.toContain('value="tone"')
  })

  it('loads an existing parameter from its direct detail cache and permits deactivate only while active', () => {
    const activeHtml = renderDrawer({ kind: 'existing', id: 42 })
    const inactiveHtml = renderDrawer(
      { kind: 'existing', id: 42 },
      { ...parameter, is_active: false },
    )

    expect(activeHtml).toContain('파라미터 수정')
    expect(activeHtml).toContain('value="tone"')
    expect(activeHtml).toContain('value="choice"')
    expect(activeHtml).toContain('비활성화')
    expect(inactiveHtml).toContain('비활성 파라미터')
    expect(inactiveHtml).not.toContain('>비활성화</')
    expect(inactiveHtml).not.toContain('다시 활성화')
  })

  it('keeps category management create-only and omits unsupported schema fields', () => {
    const html = renderDrawer({ kind: 'new' }, null)

    expect(html).toContain('새 파라미터')
    expect(html).not.toContain('required pattern')
    expect(html).not.toContain('다시 활성화')
  })
})
