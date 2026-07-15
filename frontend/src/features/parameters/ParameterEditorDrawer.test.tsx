import {
  focusManager,
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/react-query'
import type { ComponentProps, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { CategoryOut, ChoiceSetSummaryOut, ParameterOut } from '@/api/types'
import { canCommitChoice } from '@/shared/components/SearchableChoice'

import {
  activeParameterChoiceSetsQueryOptions,
  deriveParameterChoiceSetComboboxAvailability,
  ExistingParameterChoiceSetBinding,
  firstInvalidParameterField,
  parameterDetailQueryOptions,
  ParameterChoiceSetPicker,
  ParameterDetailError,
  ParameterDetailRefetchError,
  ParameterEditorDrawer,
  prepareParameterChoiceSetPicker,
  shouldBlockParameterChoiceSetCreateResource,
  shouldBlockParameterChoiceSetResource,
} from './ParameterEditorDrawer'
import {
  parameterEditorSessionReducer,
  selectFreshParameterForHydration,
  startParameterEditorSession,
} from './parameterAdminState'
import {
  authorizeParameterChoiceSet,
  deriveParameterChoiceSetPickerState,
  reconcileParameterChoiceSetAuthorization,
  type EditTarget,
} from './registryState'

const categories: CategoryOut[] = [
  { id: 1, code: 'photo', display_name: 'Photo', sort_order: 0, is_active: true },
]

const equipmentMode: ChoiceSetSummaryOut = {
  code: 'equipment_mode',
  display_name: 'Equipment mode',
  description: null,
  is_active: true,
  version: 3,
  option_count: 2,
  active_option_count: 2,
  parameter_usage_count: 1,
  profile_usage_fields: [],
  created_at: '2026-07-14T00:00:00Z',
  updated_at: '2026-07-14T00:00:00Z',
}

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
  required: false,
  pattern: null,
  pattern_hint: null,
  choice_set: equipmentMode,
  sort_order: 0,
  is_active: true,
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
  queryClient.setQueryData(['choice-sets', 'list', false], [equipmentMode])

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
  it('keeps successful selection validation reachable and follows DOM focus order', () => {
    expect(
      shouldBlockParameterChoiceSetCreateResource({
        isCreate: true,
        valueType: 'choice',
        resourceReady: true,
      }),
    ).toBe(false)
    expect(
      shouldBlockParameterChoiceSetCreateResource({
        isCreate: true,
        valueType: 'choice',
        resourceReady: false,
      }),
    ).toBe(true)
    expect(
      firstInvalidParameterField({
        choiceSetCode: '선택지 집합을 선택해 주세요.',
        minValue: '올바른 소수를 입력해 주세요.',
      }),
    ).toBe('choiceSetCode')
  })

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

  it('extends the text parameter form with required and paired pattern metadata', () => {
    const html = renderDrawer({ kind: 'new' }, null)

    expect(html).toContain('새 파라미터')
    expect(html).toContain('data-parameter-field="required"')
    expect(html).toContain('data-parameter-field="pattern"')
    expect(html).toContain('data-parameter-field="patternHint"')
    expect(html).not.toContain('data-parameter-field="unit"')
    expect(html).not.toContain('data-parameter-field="minValue"')
    expect(html).not.toContain('data-parameter-field="maxValue"')
    expect(html).not.toContain('다시 활성화')
  })

  it('configures the active ChoiceSet list to refetch on every window focus', async () => {
    const load = vi.fn().mockResolvedValue([equipmentMode])
    const options = activeParameterChoiceSetsQueryOptions(load)

    expect(options.queryKey).toEqual(['choice-sets', 'list', false])
    expect(options.refetchOnWindowFocus).toBe('always')
    await options.queryFn?.({} as never)
    expect(load).toHaveBeenCalledWith(false)
  })

  it('awaits an explicit active-list refetch on every picker open even with cached rows', async () => {
    let backend: ChoiceSetSummaryOut[] = [equipmentMode]
    const refetch = vi.fn(async () => ({ data: backend, error: null }))
    const rawCode = 'equipment_mode'
    let authorizedCode = authorizeParameterChoiceSet(rawCode)

    await prepareParameterChoiceSetPicker(refetch)
    backend = []
    const fresh = await prepareParameterChoiceSetPicker(refetch)
    authorizedCode = reconcileParameterChoiceSetAuthorization(
      authorizedCode,
      rawCode,
      fresh,
    )
    const picker = deriveParameterChoiceSetPickerState({
      rawCode,
      authorizedCode,
      sets: fresh,
      status: 'success',
      refreshing: false,
    })

    expect(refetch).toHaveBeenCalledTimes(2)
    expect(refetch).toHaveBeenNthCalledWith(1, { throwOnError: true })
    expect(refetch).toHaveBeenNthCalledWith(2, { throwOnError: true })
    expect(picker.rawCode).toBe(rawCode)
    expect(picker.selectionReady).toBe(false)
  })

  it('fails closed after window-focus refetch discovers external deactivation', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let backend: ChoiceSetSummaryOut[] = [equipmentMode]
    const load = vi.fn(async () => backend)
    const observer = new QueryObserver(
      client,
      activeParameterChoiceSetsQueryOptions(load),
    )
    focusManager.setFocused(true)
    client.mount()
    const unsubscribe = observer.subscribe(() => undefined)

    try {
      await waitUntil(() => observer.getCurrentResult().isSuccess && load.mock.calls.length === 1)
      backend = []
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await waitUntil(
        () => load.mock.calls.length === 2 && observer.getCurrentResult().data?.length === 0,
      )

      const rawCode = 'equipment_mode'
      const authorizedCode = reconcileParameterChoiceSetAuthorization(
        authorizeParameterChoiceSet(rawCode),
        rawCode,
        observer.getCurrentResult().data ?? [],
      )
      const picker = deriveParameterChoiceSetPickerState({
        rawCode,
        authorizedCode,
        sets: observer.getCurrentResult().data ?? [],
        status: 'success',
        refreshing: false,
      })

      expect(load).toHaveBeenNthCalledWith(1, false)
      expect(load).toHaveBeenNthCalledWith(2, false)
      expect(picker.rawCode).toBe(rawCode)
      expect(picker.selectionReady).toBe(false)
    } finally {
      unsubscribe()
      client.unmount()
      focusManager.setFocused(undefined)
    }
  })

  it('fails closed with cached rows while an offline refetch is paused', () => {
    const rawCode = 'equipment_mode'
    const paused = shouldBlockParameterChoiceSetResource({
      isFetching: false,
      isPaused: true,
    })
    const picker = deriveParameterChoiceSetPickerState({
      rawCode,
      authorizedCode: authorizeParameterChoiceSet(rawCode),
      sets: [equipmentMode],
      status: 'success',
      refreshing: paused,
    })

    expect(paused).toBe(true)
    expect(picker.rawCode).toBe(rawCode)
    expect(picker.selectionReady).toBe(false)
  })

  it('renders loading and request-error picker states without clearing the raw draft', () => {
    const loading = renderChoiceSetPicker({
      rawCode: 'equipment_mode',
      sets: [equipmentMode],
      loading: true,
      resourceReady: false,
      sourceActive: true,
    })
    const failed = renderChoiceSetPicker({
      rawCode: 'equipment_mode',
      sets: [equipmentMode],
      error: '선택지 집합을 불러오지 못했습니다.',
      resourceReady: false,
      sourceActive: true,
    })

    expect(loading).toContain('equipment_mode')
    expect(loading).toContain('새로 고침 중')
    expect(failed).toContain('equipment_mode')
    expect(failed).toContain('선택지 집합을 불러오지 못했습니다.')
    expect(failed).toContain('다시 시도')
  })

  it('links an empty active registry to ChoiceSet administration', () => {
    const html = renderChoiceSetPicker({
      rawCode: '',
      sets: [],
      resourceReady: true,
      sourceActive: false,
    })

    expect(html).toContain('활성 선택지 집합이 없습니다.')
    expect(html).toContain('href="/parameters/choice-sets"')
  })

  it('shows a deactivated selection as raw read-only draft and fails closed', () => {
    const html = renderChoiceSetPicker({
      rawCode: 'equipment_mode',
      sets: [],
      resourceReady: true,
      sourceActive: false,
      validationError: '최신 목록에서 선택지 집합을 다시 선택해 주세요.',
    })

    expect(html).toContain('equipment_mode')
    expect(html).toContain('사용 중지됨')
    expect(html).toContain('다시 선택')
    expect(html).not.toContain('>다시 시도</')
  })

  it('lets a stale raw draft explicitly select a different active set after refresh', () => {
    const availability = deriveParameterChoiceSetComboboxAvailability({
      rawCode: 'retired_mode',
      selectedActive: false,
      resourceReady: true,
    })

    expect(availability).toEqual({
      sourceActive: true,
      sourceInactive: true,
      selectionReady: true,
    })
    expect(
      canCommitChoice(
        { code: 'equipment_mode', label: 'Equipment mode', is_active: true },
        { ...availability, generationReady: true },
      ),
    ).toBe(true)
  })

  it('renders an existing ChoiceSet as immutable metadata with a direct management link', () => {
    const html = renderWithRouter(
      <ExistingParameterChoiceSetBinding choiceSet={equipmentMode} />,
    )

    expect(html).toContain('equipment_mode')
    expect(html).toContain('Equipment mode')
    expect(html).toContain('href="/parameters/choice-sets/equipment_mode"')
    expect(html).toContain('Phase 2.6')
    expect(html).toContain('변경할 수 없습니다')
    expect(html).not.toContain('쉼표')
  })
})

function renderChoiceSetPicker(
  overrides: Partial<ComponentProps<typeof ParameterChoiceSetPicker>>,
): string {
  return renderWithRouter(
    <ParameterChoiceSetPicker
      rawCode=""
      sets={[]}
      loading={false}
      error={null}
      resourceReady={false}
      sourceActive={false}
      disabled={false}
      onOpen={async () => undefined}
      onChange={vi.fn()}
      {...overrides}
    />,
  )
}

function renderWithRouter(node: ReactNode): string {
  const router = createMemoryRouter(
    [{ path: '*', element: node }],
    { initialEntries: ['/parameters'] },
  )
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    return renderToStaticMarkup(<RouterProvider router={router} />)
  } finally {
    consoleError.mockRestore()
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for query state')
}

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
