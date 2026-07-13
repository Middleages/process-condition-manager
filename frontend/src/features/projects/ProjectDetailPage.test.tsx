import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { Route, Routes, StaticRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { ProjectOut } from '@/api/types'

import { ProjectDetailPage } from './ProjectDetailPage'

const project: ProjectOut = {
  id: 42,
  line_id: 'L1',
  process_id: 'coat',
  part_id: 'P-42',
  name: 'Coat baseline',
  description: null,
  status: 'draft',
  layers: [
    {
      id: 7,
      layer_key: 'L1::coat::0010::LYR01',
      step_seq: '0010',
      layer_id: 'LYR01',
      eqp_type: null,
      eqp_type_desc: null,
      area_name: 'PHOTO',
      sort_order: 0,
      condition_count: 2,
      cell_count: 24,
      source_project_id: null,
      source_layer_key: null,
    },
  ],
}

function renderDetail(): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  })
  queryClient.setQueryData(['project', 42], project)

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <StaticRouter location="/projects/42">
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        </Routes>
      </StaticRouter>
    </QueryClientProvider>,
  )
}

describe('ProjectDetailPage', () => {
  it('uses compact layer rows with an exact 36px replace target', () => {
    const html = renderDetail()

    expect(html).toContain('<tr class="h-9">')
    expect(html).toContain(
      'class="h-9 shadow-[inset_0_1px_0_var(--color-border-subtle)]',
    )
    expect(html).toMatch(/<button[^>]*class="[^"]*h-9[^"]*"[^>]*>/)
  })

  it('does not announce the entire resolved detail table as a live region', () => {
    expect(renderDetail()).not.toContain('aria-live="polite"')
  })
})
