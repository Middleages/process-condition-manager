import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { LayerOut, ProcessDetailOut, ProcessListOut } from '@/api/types'

import { ProcessExplorerPage } from './ProcessExplorerPage'

const layer: LayerOut = {
  key: 'L1::10::COAT',
  step_seq: '10',
  layer_id: 'COAT',
  eqp_type: 'TRACK',
  eqp_type_desc: 'Coater track',
  area_name: 'PHOTO',
  sort_order: 1,
}

function renderCatalog(process: ProcessDetailOut | null): string {
  const list: ProcessListOut = {
    items:
      process === null
        ? []
        : [
            {
              key: process.key,
              line_id: process.line_id,
              process_id: process.process_id,
              display_name: process.display_name,
              sort_order: 1,
              has_project: process.has_project,
            },
          ],
    next_cursor: null,
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })

  queryClient.setQueryData(['process-catalog', '', false], list)
  if (process !== null) {
    queryClient.setQueryData(['process', process.key], process)
    queryClient.setQueryData(['process-layers', process.key], [layer])
  }

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <StaticRouter location="/processes">
        <ProcessExplorerPage />
      </StaticRouter>
    </QueryClientProvider>,
  )
}

function makeProcess(overrides: Partial<ProcessDetailOut> = {}): ProcessDetailOut {
  return {
    key: 'L1::PROC_ALPHA',
    line_id: 'L1',
    process_id: 'PROC_ALPHA',
    display_name: 'L1 / PROC_ALPHA',
    step_count: 3,
    area_names: ['PHOTO'],
    has_project: false,
    project_count: 0,
    ...overrides,
  }
}

describe('ProcessExplorerPage', () => {
  it('renders a focusable title and a non-color selected-state cue', () => {
    const html = renderCatalog(makeProcess())

    expect(html).toContain('data-page-title="true"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toMatch(/<h1[^>]*>공정 카탈로그<\/h1>/)
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('선택됨')
    expect(html).not.toMatch(/(?:cyan|slate)-/)
  })

  it('links an unused Process to its stable encoded wizard URL', () => {
    const html = renderCatalog(makeProcess({ key: 'L1::P&1' }))

    expect(html).toContain('href="/projects/new?step=1&amp;process=L1%3A%3AP%261"')
    expect(html).toContain('scope="col"')
  })

  it('links an existing Process to the searchable project list without inventing an ID', () => {
    const html = renderCatalog(
      makeProcess({ has_project: true, process_id: 'PHOTO-1', project_count: 2 }),
    )

    expect(html).toContain('href="/projects?query=PHOTO-1"')
    expect(html).not.toMatch(/href="\/projects\/\d+/)
  })

  it('keeps selection guidance visible when no Process is available', () => {
    expect(renderCatalog(null)).toContain('왼쪽 목록에서 Process를 선택하세요.')
  })
})
