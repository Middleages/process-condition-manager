import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { ProjectSummaryOut } from '@/api/types'

import { ProjectTable } from './ProjectTable'

const project: ProjectSummaryOut = {
  id: 42,
  line_id: 'L1',
  process_id: 'coat',
  part_id: 'P-42',
  name: 'Coat baseline',
  description: '양산 기준 조건표',
  status: 'draft',
  layer_count: 8,
  cell_count: 128,
}

describe('ProjectTable', () => {
  it('renders the compact project columns and a real detail link', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/projects?query=coat">
        <ProjectTable
          projects={[project]}
          from="/projects?query=coat"
          onProjectOpen={vi.fn()}
        />
      </StaticRouter>,
    )

    expect(html).toContain('<table')
    expect(html).toContain('프로젝트명')
    expect(html).toContain('Line / Process')
    expect(html).toContain('상태')
    expect(html).toContain('Layer')
    expect(html).toContain('Cell')
    expect(html).toContain('href="/projects/42"')
    expect(html).toContain('양산 기준 조건표')
    expect(html).toContain('P-42')
    expect(html).toContain('<tr class="h-9">')
    expect(html).toContain('class="h-9 border-t border-border-subtle')
    expect(html).toContain('leading-4')
    expect(html).toContain('leading-3')
  })
})
