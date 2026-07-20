import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { ChoiceSetSummaryOut, ProjectListOut } from '@/api/types'
import { choiceSetKeys } from '@/features/choiceSets/choiceQueries'
import type { ChoiceSetOptionsResource } from '@/features/choiceSets/useChoiceSetOptions'

import { ProjectChoiceFilter, ProjectListPage } from './ProjectListPage'
import { projectListQueryKey } from './projectListQuery'
import { parseProjectListSearch } from './urlState'

const deviceTypeSummary: ChoiceSetSummaryOut = {
  code: 'device_type',
  display_name: 'Device Type',
  description: null,
  is_active: true,
  version: 1,
  option_count: 2,
  active_option_count: 1,
  parameter_usage_count: 0,
  profile_usage_fields: ['device_type'],
  created_at: '2026-07-14T00:00:00Z',
  updated_at: '2026-07-14T00:00:00Z',
}

const categorySummary: ChoiceSetSummaryOut = {
  ...deviceTypeSummary,
  code: 'project_category',
  display_name: 'Project Category',
  profile_usage_fields: ['project_category'],
}

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

function renderList(location: string): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  })
  const routeState = parseProjectListSearch(new URL(location, 'https://pcm.test').searchParams)
  queryClient.setQueryData(projectListQueryKey(routeState), {
    pages: [projects],
    pageParams: [null],
  })
  queryClient.setQueryData(choiceSetKeys.summary('device_type'), deviceTypeSummary)
  queryClient.setQueryData(choiceSetKeys.options('device_type', 1, true), {
    set_code: 'device_type',
    version: 1,
    items: [
      { code: 'FOUNDRY', label: 'Foundry', sort_order: 0, is_active: true },
      { code: 'MEMORY', label: 'Memory', sort_order: 1, is_active: false },
    ],
  })
  queryClient.setQueryData(choiceSetKeys.summary('project_category'), categorySummary)
  queryClient.setQueryData(choiceSetKeys.options('project_category', 1, true), {
    set_code: 'project_category',
    version: 1,
    items: [{ code: 'LEGACY', label: 'Legacy product', sort_order: 0, is_active: false }],
  })

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
  it('restores both exact managed-choice filters and keeps historical inactive choices filterable', () => {
    const html = renderList(
      '/projects?query=coat&status=draft&device_type=FOUNDRY&project_category=LEGACY',
    )

    expect(html).toContain('Device Type')
    expect(html).toContain('Project Category')
    expect(html).toContain('FOUNDRY · Foundry')
    expect(html).toContain('LEGACY · Legacy product')
    expect(html).toContain('사용 중지됨')
    expect(html).toContain('Coat baseline')
    expect(html).toContain('href="/projects/42"')
  })

  it('renders raw selected filter codes while choice data is still unavailable', () => {
    const html = renderList(
      '/projects?device_type=UNKNOWN_DEVICE&project_category=UNKNOWN_CATEGORY',
    )

    expect(html).toContain('UNKNOWN_DEVICE')
    expect(html).toContain('UNKNOWN_CATEGORY')
  })

  it('uses one restrained work frame and one semantic three-control finder', () => {
    const html = renderList('/projects')
    const finder = html.match(
      /<section(?=[^>]*aria-labelledby="project-filter-title")[^>]*>[\s\S]*?<\/section>/,
    )?.[0]

    expect(html).toContain('max-w-[1600px]')
    expect(finder).toBeDefined()
    expect(finder).toContain('id="project-filter-title"')
    expect(finder).toContain('>프로젝트 찾기<')
    expect(finder).toContain('불러온 1개')
    expect(finder).toContain('lg:grid-cols-3')
    expect(finder).not.toContain('lg:grid-cols-[minmax(18rem,1.4fr)')
  })
})

describe('ProjectChoiceFilter', () => {
  it('retains and can clear a raw URL code during a real lookup error', () => {
    const retryOptions = vi.fn().mockResolvedValue(undefined)
    const resource: ChoiceSetOptionsResource = {
      setCode: 'device_type',
      version: null,
      setIsActive: null,
      displayOptions: [],
      selectableOptions: [],
      selectionReady: false,
      loading: false,
      refreshing: false,
      error: 'Device Type 조회에 실패했습니다.',
      prepareToOpen: vi.fn().mockRejectedValue(new Error('request failed')),
      refetchSummary: vi.fn().mockRejectedValue(new Error('request failed')),
      retryOptions,
    }

    const html = renderToStaticMarkup(
      <ProjectChoiceFilter
        id="project-list-device-type"
        label="Device Type"
        value="RAW_DEVICE"
        resource={resource}
        onChange={vi.fn()}
      />,
    )

    expect(html).toContain('RAW_DEVICE')
    expect(html).toContain('Device Type 조회에 실패했습니다.')
    expect(html).toContain('선택 해제')
    expect(html).toContain('다시 시도')

    const emptyHtml = renderToStaticMarkup(
      <ProjectChoiceFilter
        id="project-list-device-type"
        label="Device Type"
        value={null}
        resource={resource}
        onChange={vi.fn()}
      />,
    )
    expect(emptyHtml).toMatch(
      /id="project-list-device-type-selected-status"[^>]*class="[^"]*sr-only[^"]*"|class="[^"]*sr-only[^"]*"[^>]*id="project-list-device-type-selected-status"/,
    )
    expect(emptyHtml).toContain('선택 없음')
  })
})
