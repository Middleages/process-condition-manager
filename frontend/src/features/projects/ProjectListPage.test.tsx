import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { listProjects } from '@/api/projects'
import type { ProjectListOut } from '@/api/types'

import { ProjectListPage } from './ProjectListPage'
import { projectListQueryKey } from './projectListQuery'
import { parseProjectListSearch } from './urlState'

vi.mock('@/api/projects', () => ({ listProjects: vi.fn() }))

const listProjectsMock = vi.mocked(listProjects)

const projects: ProjectListOut = {
  items: [
    {
      id: 42,
      line_id: 'L1',
      process_id: 'coat',
      part_id: 'P-42',
      name: 'Coat baseline',
      status: 'draft',
      version: 1,
      revision_root_id: null,
      predecessor_project_id: null,
      successor_project_id: null,
      allowed_actions: ['request_review', 'approve'],
      device_type: { code: 'FOUNDRY', label: 'Foundry', is_active: true },
      project_category: { code: 'LEGACY', label: 'Legacy product', is_active: false },
      layer_total: '8',
      updated_at: '2026-07-14T02:30:00Z',
      layer_count: 8,
      cell_count: 128,
    },
  ],
  next_cursor: null,
}

type PageState = 'loaded' | 'loading' | 'error' | 'empty' | 'paginated'

function createProjectListQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnMount: false,
        retry: false,
        retryOnMount: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  })
}

function seedProjectListQuery(queryClient: QueryClient, location: string, state: PageState) {
  const routeState = parseProjectListSearch(new URL(location, 'https://pcm.test').searchParams)
  const queryKey = projectListQueryKey(routeState)

  if (state !== 'loading') {
    const result = state === 'empty'
      ? { items: [], next_cursor: null }
      : state === 'paginated'
        ? { ...projects, next_cursor: 100 }
        : projects

    queryClient.setQueryData(queryKey, {
      pages: [result],
      pageParams: [null],
    })
  }

  if (state === 'error') {
    queryClient.getQueryCache().find({ queryKey })?.setState({
      data: undefined,
      error: new Error('프로젝트 목록 조회에 실패했습니다.'),
      fetchStatus: 'idle',
      status: 'error',
    })
  }
}

function renderList(location: string, state: PageState = 'loaded'): string {
  const queryClient = createProjectListQueryClient()
  seedProjectListQuery(queryClient, location, state)

  const router = createMemoryRouter(
    [{ path: '/projects', element: <ProjectListPage /> }],
    { initialEntries: [location] },
  )
  const originalConsoleError = console.error
  const consoleError = vi.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (String(message).includes('useLayoutEffect does nothing on the server')) return
    originalConsoleError(message, ...args)
  })

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

describe('ProjectListPage', () => {
  beforeEach(() => {
    listProjectsMock.mockReset()
    listProjectsMock.mockImplementation(() => new Promise(() => {}))
  })

  it('renders the project command index with search, creation, and status-only filtering', () => {
    const html = renderList(
      '/projects?query=coat&status=draft&device_type=FOUNDRY&project_category=LEGACY',
    )
    const document = new JSDOM(html).window.document
    const statusGroup = document.querySelector('[role="group"][aria-label="프로젝트 상태 필터"]')
    const statusButtons = [...(statusGroup?.querySelectorAll('button') ?? [])]

    expect(document.querySelector('h1')?.textContent).toBe('프로젝트')
    expect(document.querySelector('input[type="search"]')?.getAttribute('placeholder')).toBe(
      'LINE, Process 또는 Part ID',
    )
    expect(document.querySelector('a[href="/projects/new"]')?.textContent).toContain('새 프로젝트')
    expect(statusButtons.map((button) => button.textContent?.trim())).toEqual([
      '전체',
      '초안',
      '검토중',
      '승인',
      '반려',
    ])
    expect(statusButtons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
    ])
    expect(html).not.toContain('Device Type')
    expect(html).not.toContain('Project Category')
    expect(html).not.toContain('Coat baseline')
    expect(html).toContain('>L1</a>')
  })

  it('announces the loaded project count in Korean', () => {
    const document = new JSDOM(renderList('/projects')).window.document
    const announcement = document.querySelector('[role="status"][aria-live="polite"]')

    expect(announcement?.textContent).toContain('프로젝트 1개')
    expect(announcement?.textContent).toContain('불러왔습니다')
  })

  it('renders loading, error with retry, empty, and pagination states', () => {
    const loadingHtml = renderList('/projects', 'loading')
    expect(loadingHtml).toContain('프로젝트 목록을 불러오는 중입니다.')
    expect(loadingHtml).not.toContain('개를 불러왔습니다.')

    const errorHtml = renderList('/projects?query=coat', 'error')
    expect(errorHtml).toContain('프로젝트 목록 조회에 실패했습니다.')
    expect(errorHtml).toContain('다시 시도')
    expect(errorHtml).toContain('value="coat"')
    expect(errorHtml).not.toContain('개를 불러왔습니다.')

    expect(renderList('/projects', 'empty')).toContain('조건에 맞는 프로젝트가 없습니다.')
    expect(renderList('/projects', 'paginated')).toContain('더 보기')
  })

  it('keeps legacy managed-choice URL filters server-side without exposing controls', () => {
    const html = renderList(
      '/projects?device_type=UNKNOWN_DEVICE&project_category=UNKNOWN_CATEGORY',
    )

    expect(html).not.toContain('UNKNOWN_DEVICE')
    expect(html).not.toContain('UNKNOWN_CATEGORY')
    expect(html).not.toContain('Device Type')
    expect(html).not.toContain('Project Category')
  })

  it('retries with the current query and forwards hidden legacy URL filters', async () => {
    const location =
      '/projects?query=coat&status=review&device_type=FOUNDRY&project_category=LEGACY'
    listProjectsMock
      .mockRejectedValueOnce(new Error('프로젝트 목록 조회에 실패했습니다.'))
      .mockResolvedValueOnce(projects)
    const interactive = renderInteractiveList(location)

    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25))
      })

      const retryButton = [...interactive.container.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === '다시 시도',
      )
      const searchInput = interactive.container.querySelector<HTMLInputElement>(
        'input[type="search"]',
      )

      expect(retryButton).toBeDefined()
      expect(searchInput?.value).toBe('coat')
      expect(listProjectsMock).toHaveBeenCalledTimes(1)
      expect(listProjectsMock).toHaveBeenNthCalledWith(1, {
        query: 'coat',
        status: 'review',
        deviceTypeCode: 'FOUNDRY',
        projectCategoryCode: 'LEGACY',
        cursor: undefined,
        limit: 50,
      })

      await act(async () => {
        retryButton?.dispatchEvent(
          new interactive.window.MouseEvent('click', { bubbles: true }),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(listProjectsMock).toHaveBeenCalledTimes(2)
      expect(listProjectsMock).toHaveBeenLastCalledWith({
        query: 'coat',
        status: 'review',
        deviceTypeCode: 'FOUNDRY',
        projectCategoryCode: 'LEGACY',
        cursor: undefined,
        limit: 50,
      })
      expect(searchInput?.value).toBe('coat')
      expect(interactive.container.textContent).not.toContain('Device Type')
      expect(interactive.container.textContent).not.toContain('Project Category')
    } finally {
      interactive.cleanup()
    }
  })

  it('does not add a history entry when the active status is clicked', async () => {
    const interactive = renderInteractiveList(
      '/projects?status=review',
      '/projects?status=draft',
    )

    try {
      const activeStatusButton = [...interactive.container.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === '검토중',
      )

      expect(activeStatusButton?.getAttribute('aria-pressed')).toBe('true')

      await act(async () => {
        activeStatusButton?.dispatchEvent(
          new interactive.window.MouseEvent('click', { bubbles: true }),
        )
      })
      await act(async () => {
        await interactive.router.navigate(-1)
      })

      expect(interactive.router.state.location.search).toBe('?status=draft')
    } finally {
      interactive.cleanup()
    }
  })
})

function renderInteractiveList(location: string, previousLocation?: string) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `https://pcm.test${location}`,
  })
  const container = dom.window.document.querySelector<HTMLDivElement>('#root')
  if (!container) throw new Error('Interactive test root is unavailable.')

  const queryClient = createProjectListQueryClient()
  seedProjectListQuery(queryClient, location, 'loading')
  const router = createMemoryRouter(
    [{ path: '/projects', element: <ProjectListPage /> }],
    {
      initialEntries: previousLocation ? [previousLocation, location] : [location],
      initialIndex: previousLocation ? 1 : 0,
    },
  )
  const globals = globalThis as unknown as {
    document?: Document
    HTMLElement?: typeof HTMLElement
    Node?: typeof Node
    window?: Window
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  const previousGlobals = {
    document: globals.document,
    HTMLElement: globals.HTMLElement,
    Node: globals.Node,
    window: globals.window,
    IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT,
  }
  let root: Root | null = null

  globals.window = dom.window as unknown as Window
  globals.document = dom.window.document
  globals.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement
  globals.Node = dom.window.Node as unknown as typeof Node
  globals.IS_REACT_ACT_ENVIRONMENT = true

  act(() => {
    root = createRoot(container)
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
  })

  return {
    container,
    router,
    window: dom.window,
    cleanup: () => {
      act(() => root?.unmount())
      queryClient.clear()
      globals.window = previousGlobals.window
      globals.document = previousGlobals.document
      globals.HTMLElement = previousGlobals.HTMLElement
      globals.Node = previousGlobals.Node
      globals.IS_REACT_ACT_ENVIRONMENT = previousGlobals.IS_REACT_ACT_ENVIRONMENT
      dom.window.close()
    },
  }
}
