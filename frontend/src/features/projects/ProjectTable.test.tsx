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

const maximumLengthProject: ProjectSummaryOut = {
  ...project,
  id: 43,
  name: 'N'.repeat(256),
  description: 'D'.repeat(1024),
  line_id: 'L'.repeat(64),
  process_id: 'P'.repeat(128),
  part_id: 'R'.repeat(128),
}

function renderTable(projects: ProjectSummaryOut[]): string {
  return renderToStaticMarkup(
    <StaticRouter location="/projects?query=coat">
      <ProjectTable
        projects={projects}
        from="/projects?query=coat"
        onProjectOpen={vi.fn()}
      />
    </StaticRouter>,
  )
}

describe('ProjectTable', () => {
  it('renders the compact project columns and a real detail link', () => {
    const html = renderTable([project])

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

  it('contains maximum-length project fields without losing their accessible text', () => {
    const html = renderTable([maximumLengthProject])
    const lineProcess = `${maximumLengthProject.line_id} / ${maximumLengthProject.process_id}`

    expect(html).toContain(`title="${maximumLengthProject.name}"`)
    expect(html).toContain(`>${maximumLengthProject.name}</a>`)
    expect(html).toContain(`title="${maximumLengthProject.description}"`)
    expect(html).toContain(`>${maximumLengthProject.description}</p>`)
    expect(html).toContain(`title="${lineProcess}"`)
    expect(html).toContain(`>${lineProcess}</span>`)
    expect(html).toContain(`title="${maximumLengthProject.part_id}"`)
    expect(html).toContain(`>${maximumLengthProject.part_id}</span>`)
    expect(html).toContain('min-w-0 overflow-hidden')
    expect(html).toContain('truncate whitespace-nowrap')
    expect(html).toContain('text-xs leading-3')
    expect(html).not.toContain('text-[11px]')
  })
})
