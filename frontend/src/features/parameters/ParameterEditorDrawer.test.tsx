import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { CategoryOut, ParameterOut } from '@/api/types'

import {
  parameterDetailQueryOptions,
  ParameterDetailError,
  ParameterDetailRefetchError,
  ParameterEditorDrawer,
} from './ParameterEditorDrawer'
import {
  parameterEditorSessionReducer,
  selectFreshParameterForHydration,
  startParameterEditorSession,
} from './parameterAdminState'
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
  it('aborts mount A so a same-ID reopen issues and hydrates only request B', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    })
    const oldParameter = { ...parameter, display_name: 'Old request A' }
    const updatedParameter = { ...parameter, display_name: 'Fresh request B' }
    let firstSignal: AbortSignal | undefined
    let resolveFirst: (value: ParameterOut) => void = () => undefined
    const load = vi.fn(
      (_parameterId: number, signal?: AbortSignal): Promise<ParameterOut> => {
        if (load.mock.calls.length === 1) {
          firstSignal = signal
          return new Promise((resolve, reject) => {
            resolveFirst = resolve
            signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            )
          })
        }
        return Promise.resolve(updatedParameter)
      },
    )

    const firstObserver = new QueryObserver(
      queryClient,
      parameterDetailQueryOptions(42, load),
    )
    const unsubscribeFirst = firstObserver.subscribe(() => undefined)
    expect(load).toHaveBeenCalledTimes(1)
    unsubscribeFirst()

    const reopenedObserver = new QueryObserver(
      queryClient,
      parameterDetailQueryOptions(42, load),
    )
    const unsubscribeReopened = reopenedObserver.subscribe(() => undefined)

    try {
      expect(firstSignal?.aborted).toBe(true)
      expect(load).toHaveBeenCalledTimes(2)
      const fresh = await waitForPostMountDetail(reopenedObserver)
      expect(fresh.display_name).toBe('Fresh request B')
      expect(fresh.display_name).not.toBe(oldParameter.display_name)
    } finally {
      resolveFirst(oldParameter)
      unsubscribeReopened()
    }
  })

  it('hydrates fresh detail on every reopen instead of accepting invalidated cache', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    })
    const queryKey = ['parameters', 'detail', 42] as const
    const cached = { ...parameter, display_name: 'Cached' }
    let backend = { ...parameter, display_name: 'First fresh' }
    queryClient.setQueryData(queryKey, cached)

    const firstObserver = new QueryObserver(
      queryClient,
      parameterDetailQueryOptions(42, async () => backend),
    )
    expect(parameterDetailQueryOptions(42).refetchOnMount).toBe('always')
    expect(
      selectFreshParameterForHydration(
        { kind: 'existing', id: 42 },
        firstObserver.getCurrentResult(),
      ),
    ).toBeNull()
    const firstFresh = await waitForPostMountDetail(firstObserver)
    const firstSession = parameterEditorSessionReducer(
      startParameterEditorSession({ kind: 'existing', id: 42 }),
      { type: 'hydrate', parameter: firstFresh },
    )
    expect(firstSession.form.displayName).toBe('First fresh')

    backend = { ...parameter, display_name: 'Changed while closed' }
    await queryClient.invalidateQueries({ queryKey, exact: true })
    const reopenedObserver = new QueryObserver(
      queryClient,
      parameterDetailQueryOptions(42, async () => backend),
    )
    expect(
      selectFreshParameterForHydration(
        { kind: 'existing', id: 42 },
        reopenedObserver.getCurrentResult(),
      ),
    ).toBeNull()
    const reopenedFresh = await waitForPostMountDetail(reopenedObserver)
    const reopenedSession = parameterEditorSessionReducer(
      startParameterEditorSession({ kind: 'existing', id: 42 }),
      { type: 'hydrate', parameter: reopenedFresh },
    )

    expect(reopenedSession.form.displayName).toBe('Changed while closed')
  })

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

  it('renders a hydrated refetch error as non-destructive draft context', () => {
    const html = renderToStaticMarkup(
      <ParameterDetailRefetchError error={new Error('GET failed')} onRetry={vi.fn()} />,
    )

    expect(html).toContain('최신 상세 정보를 다시 불러오지 못했습니다.')
    expect(html).toContain('편집 중인 초안은 그대로 유지됩니다.')
    expect(html).toContain('GET failed')
    expect(html).toContain('다시 시도')
  })

  it('does not expose cached existing detail before the post-mount response', () => {
    const activeHtml = renderDrawer({ kind: 'existing', id: 42 })

    expect(activeHtml).toContain('파라미터 수정')
    expect(activeHtml).toContain('최신 파라미터 정보를 불러오는 중입니다.')
    expect(activeHtml).not.toContain('value="tone"')
    expect(activeHtml).not.toContain('>비활성화</')
  })

  it('keeps category management create-only and omits unsupported schema fields', () => {
    const html = renderDrawer({ kind: 'new' }, null)

    expect(html).toContain('새 파라미터')
    expect(html).not.toContain('required pattern')
    expect(html).not.toContain('다시 활성화')
  })
})

async function waitForPostMountDetail(
  observer: QueryObserver<
    ParameterOut,
    Error,
    ParameterOut,
    ParameterOut,
    readonly ['parameters', 'detail', number | null]
  >,
): Promise<ParameterOut> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('Timed out waiting for a post-mount detail response.'))
    }, 1_000)
    const unsubscribe = observer.subscribe((result) => {
      const fresh = selectFreshParameterForHydration(
        { kind: 'existing', id: 42 },
        result,
      )
      if (!fresh) return

      clearTimeout(timeout)
      unsubscribe()
      resolve(fresh)
    })
  })
}
