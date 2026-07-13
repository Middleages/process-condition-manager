import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { MatchPreviewOut, ProcessDetailOut, ProcessListOut } from '@/api/types'

import { ProjectCreateWizard } from './ProjectCreateWizard'
import { previewFingerprint } from './wizardState'

const directProcess: ProcessDetailOut = {
  key: 'LINE Z::outside first page',
  line_id: 'LINE Z',
  process_id: 'outside first page',
  display_name: 'LINE Z / outside first page',
  step_count: 4,
  area_names: ['ETCH'],
  has_project: false,
  project_count: 0,
}

const firstPage: ProcessListOut = {
  items: [
    {
      key: 'LINE A::first',
      line_id: 'LINE A',
      process_id: 'first',
      display_name: 'LINE A / first',
      sort_order: 1,
      has_project: false,
    },
  ],
  next_cursor: null,
}

const preview: MatchPreviewOut = {
  match_rate: 0,
  matched_count: 0,
  unmatched_count: 1,
  copy_condition_count: 0,
  copy_cell_count: 0,
  matches: [
    {
      target_layer_key: '4::ETCH',
      source_layer_key: null,
      match_type: 'unmatched',
    },
  ],
}

function renderWizard(location: string, seedSelectedProcess: boolean): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(['processes', 'picker', ''], {
    pages: [firstPage],
    pageParams: [null],
  })

  if (seedSelectedProcess) {
    queryClient.setQueryData(['process', directProcess.key], directProcess)
    queryClient.setQueryData(
      ['backbone-preview', previewFingerprint(directProcess.key, null, {})],
      {
        fingerprint: previewFingerprint(directProcess.key, null, {}),
        preview,
      },
    )
  }

  const router = createMemoryRouter(
    [
      {
        path: '/projects/new',
        element: <ProjectCreateWizard onCreated={vi.fn()} />,
      },
    ],
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

describe('ProjectCreateWizard route restoration', () => {
  it('restores a direct Process outside picker results without selecting the first result', () => {
    const params = new URLSearchParams({ step: '3', process: directProcess.key })
    const html = renderWizard(`/projects/new?${params}`, true)

    expect(html).toContain('LINE Z / outside first page')
    expect(html).not.toContain('LINE A / first')
    expect(html).toContain('매칭 확인 · 프로젝트 정보</h2>')
    expect(html).toContain('현재 단계')
    expect(html).toContain('완료')
  })

  it('keeps a direct step three visible while its Process detail is pending', () => {
    const params = new URLSearchParams({ step: '3', process: directProcess.key })
    const html = renderWizard(`/projects/new?${params}`, false)

    expect(html).toContain('매칭 확인 · 프로젝트 정보</h2>')
    expect(html).toContain('URL에서 선택한 Process를 복원하는 중입니다.')
  })
})
