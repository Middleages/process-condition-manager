import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { listProjectLines, listProjects } from '@/api/projects'
import type { ProjectListOut } from '@/api/types'

import { ProjectListPage } from './ProjectListPage'
import { projectListQueryKey } from './projectListQuery'
import { parseProjectListSearch } from './urlState'

vi.mock('@/api/projects', () => ({ listProjects: vi.fn(), listProjectLines: vi.fn() }))

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

  queryClient.setQueryData(['projects', 'lines'], ['L1', 'L2'])

  if (state !== 'loading') {
    const result = state === 'empty'
      ? { items: [], next_cursor: null }
      : state === 'paginated'
        ? { ...projects, next_cursor: 100 }
        : projects

    queryClient.setQueryData(queryKey, result)
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
    [{ path: '/projects', element: <ProjectListPage /> }, { path: '/projects/:id/sheet', element: <div>Detail</div> }],
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
    vi.mocked(listProjectLines).mockResolvedValue(['L1', 'L2'])
  })

  it('requires LINE selection, then exposes explicit search and two synchronized pagers', () => {
    expect(renderList('/projects')).toContain('LINE을 선택해 주세요.')
    const document = new JSDOM(renderList('/projects?line=L1', 'paginated')).window.document
    expect(document.querySelector('h1')?.textContent).toBe('제품 목록')
    expect(document.querySelector('form')).not.toBeNull()
    expect(document.querySelector('input')?.placeholder).toBe('Process 또는 Part ID')
    expect(document.querySelector('a[href="/projects/new"]')?.textContent).toContain('공정조건 등록')
    expect(document.querySelectorAll('nav[aria-label*="페이지"]')).toHaveLength(2)
    expect(document.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1)
    expect(document.body.textContent).not.toContain('Coat baseline')
  })

  it('renders scoped loading, retry and distinct empty states', () => {
    expect(renderList('/projects?line=L1', 'loading')).toContain('제품 목록을 불러오는 중입니다.')
    expect(renderList('/projects?line=L1', 'error')).toContain('다시 시도')
    expect(renderList('/projects?line=L1', 'empty')).toContain('이 LINE에 등록된 공정조건이 없습니다.')
    expect(renderList('/projects?line=L1&query=coat', 'empty')).toContain('검색 결과가 없습니다.')
  })

  it('does not fetch any products until a LINE is selected', async () => {
    const view = renderInteractiveList('/projects')
    try {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(listProjectsMock).not.toHaveBeenCalled()
      const line = [...view.container.querySelectorAll('button')].find(button => button.textContent === 'L2')!
      await act(async () => line.click())
      expect(listProjectsMock).toHaveBeenCalledWith(expect.objectContaining({ lineId: 'L2', limit: 25 }))
    } finally { view.cleanup() }
  })

  it('pages using server cursors, restores prior page on back, and resets on LINE change', async () => {
    listProjectsMock.mockResolvedValue({ ...projects, next_cursor: 40 })
    const view = renderInteractiveList('/projects?line=L1&query=coat')
    const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }
    try {
      await settle()
      const next = [...view.container.querySelectorAll('button')].filter(button => button.textContent === '다음')
      expect(next).toHaveLength(2)
      await act(async () => next[1].click())
      await settle()
      expect(listProjectsMock).toHaveBeenLastCalledWith(expect.objectContaining({ lineId: 'L1', query: 'coat', cursor: 40, limit: 25 }))
      expect(view.router.state.location.search).toContain('trail=0')
      expect(view.container.querySelector('h2[tabindex]')).toBe(view.window.document.activeElement)
      await act(async () => view.router.navigate(-1))
      await settle()
      expect(view.router.state.location.search).not.toContain('cursor')
      const line = [...view.container.querySelectorAll('button')].find(button => button.textContent === 'L2')!
      await act(async () => line.click())
      expect(listProjectsMock).toHaveBeenLastCalledWith(expect.objectContaining({ lineId: 'L2', query: 'coat', cursor: undefined }))
    } finally { view.cleanup() }
  })

  it('restores a later-page open link after detail/back navigation', async () => {
    listProjectsMock.mockResolvedValue(projects)
    const view = renderInteractiveList('/projects?line=L1&cursor=50&trail=0')
    try {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
      const link = view.container.querySelector<HTMLAnchorElement>('[data-project-id="42"]')!
      await act(async () => link.click())
      expect(view.router.state.location.pathname).toBe('/projects/42/sheet')
      expect(view.router.state.location.state.from).toBe('/projects?line=L1&cursor=50&trail=0')
      await act(async () => view.router.navigate(-1))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
      expect(view.window.document.activeElement?.getAttribute('data-project-id')).toBe('42')
      expect(view.router.state.location.search).toContain('cursor=50')
    } finally { view.cleanup() }
  })

  it('labels a direct cursor without history as first-page recovery and resets submitted search', async () => {
    listProjectsMock.mockResolvedValue(projects)
    const view = renderInteractiveList('/projects?line=L1&query=coat&cursor=50&trail=bad')
    try {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(view.container.textContent).toContain('현재 1개 표시')
      const first = [...view.container.querySelectorAll('button')].filter(button => button.textContent === '처음')
      expect(first).toHaveLength(2)
      await act(async () => first[1].click())
      expect(view.router.state.location.search).toBe('?line=L1&query=coat')
      await act(async () => view.router.navigate('/projects?line=L1&query=coat&cursor=50&trail=0'))
      await act(async () => view.container.querySelector('form')!.dispatchEvent(new view.window.Event('submit', { bubbles: true, cancelable: true })))
      expect(view.router.state.location.search).toBe('?line=L1&query=coat')
    } finally { view.cleanup() }
  })

  it('keeps no stale rows under the new LINE heading while loading and supports retry', async () => {
    listProjectsMock.mockResolvedValueOnce(projects).mockRejectedValueOnce(new Error('LINE request failed')).mockResolvedValueOnce({ items: [], next_cursor: null })
    const view = renderInteractiveList('/projects?line=L1')
    try {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(view.container.querySelector('table')).not.toBeNull()
      const line = [...view.container.querySelectorAll('button')].find(button => button.textContent === 'L2')!
      await act(async () => line.click())
      expect(view.container.querySelector('table')).toBeNull()
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
      const retry = [...view.container.querySelectorAll('button')].find(button => button.textContent === '다시 시도')!
      await act(async () => retry.click())
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(view.container.textContent).toContain('이 LINE에 등록된 공정조건이 없습니다.')
      expect(listProjectsMock).toHaveBeenLastCalledWith(expect.objectContaining({ lineId: 'L2', limit: 25 }))
    } finally { view.cleanup() }
  })

  it('keeps draft typing local and restores applied query when switching LINE', async () => {
    listProjectsMock.mockResolvedValue(projects)
    const view = renderInteractiveList('/projects?line=L1&query=coat')
    try {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
      // React DOM is imported before JSDOM in this test harness; simulate its tracked change event.
      const input = view.container.querySelector('input')!
      const props = Object.keys(input).find(key => key.startsWith('__reactProps'))!
      await act(async () => {
        (input as unknown as Record<string, { onChange: (event: { target: { value: string } }) => void }>)[props].onChange({ target: { value: 'unsubmitted' } })
      })
      expect(input.value).toBe('unsubmitted')
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
      expect(listProjectsMock).toHaveBeenCalledTimes(1)
      const line = [...view.container.querySelectorAll('button')].find(button => button.textContent === 'L2')!
      await act(async () => line.click())
      expect(input.value).toBe('coat')
      await act(async () => {
        (input as unknown as Record<string, { onChange: (event: { target: { value: string } }) => void }>)[props].onChange({ target: { value: 'P-42' } })
      })
      await act(async () => view.container.querySelector('form')!.dispatchEvent(new view.window.Event('submit', { bubbles: true, cancelable: true })))
      expect(listProjectsMock).toHaveBeenLastCalledWith(expect.objectContaining({ lineId: 'L2', query: 'P-42', cursor: undefined }))
    } finally { view.cleanup() }
  })
})

function renderInteractiveList(location: string, previousLocation?: string) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `https://pcm.test${location}`,
    pretendToBeVisual: true,
  })
  const container = dom.window.document.querySelector<HTMLDivElement>('#root')
  if (!container) throw new Error('Interactive test root is unavailable.')

  const queryClient = createProjectListQueryClient()
  seedProjectListQuery(queryClient, location, 'loading')
  const router = createMemoryRouter(
    [{ path: '/projects', element: <ProjectListPage /> }, { path: '/projects/:id/sheet', element: <div>Detail</div> }],
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
