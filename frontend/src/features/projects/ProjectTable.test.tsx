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
  status: 'draft',
  version: 1,
  revision_root_id: null,
  predecessor_project_id: null,
  successor_project_id: null,
  allowed_actions: ['request_review', 'approve'],
  device_type: { code: 'FOUNDRY', label: 'Foundry', is_active: true },
  project_category: { code: 'LOGIC', label: 'Logic', is_active: true },
  layer_total: '8',
  updated_at: '2026-07-14T02:30:00Z',
  layer_count: 8,
  cell_count: 128,
}

const maximumLengthProject: ProjectSummaryOut = {
  ...project,
  id: 43,
  name: 'N'.repeat(256),
  line_id: 'L'.repeat(64),
  process_id: 'P'.repeat(128),
  part_id: 'R'.repeat(128),
  device_type: {
    code: 'DEVICE_RAW_CODE',
    label: '',
    is_active: false,
  },
  project_category: {
    code: 'CATEGORY_RAW_CODE',
    label: 'Legacy category',
    is_active: false,
  },
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
  it('renders the approved eight compact columns in order and a real detail link', () => {
    const html = renderTable([project])
    const headers = [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((match) =>
      match[1]?.replace(/<[^>]+>/g, '').trim(),
    )

    expect(html).toContain('<table')
    expect(headers).toEqual([
      '프로젝트명',
      'LINE / Process',
      'PARTID',
      'Device Type',
      'Category',
      'Layer Total',
      '상태',
      'Lineage',
      '허용 액션',
      'Updated',
    ])
    expect(html).toContain('href="/projects/42"')
    expect(html).toContain('P-42')
    expect(html).toContain('Foundry')
    expect(html).toContain('Logic')
    expect(html).toContain('min-w-[1120px]')
    expect(html).not.toContain('min-w-[920px]')
    expect(html).not.toContain('min-w-[1040px]')
    expect(html).toContain('<tr class="h-9">')
    expect(html).toContain('class="h-9 border-t border-border-subtle')
    expect(html).toContain('leading-4')
    expect(html).not.toContain('Comment')
    expect(html).not.toContain('Description')
    expect(html).not.toContain('Cell</th>')
  })

  it('preserves raw inactive classification codes and marks them non-blockingly', () => {
    const html = renderTable([maximumLengthProject])
    const lineProcess = `${maximumLengthProject.line_id} / ${maximumLengthProject.process_id}`

    expect(html).toContain(`title="${maximumLengthProject.name}"`)
    expect(html).toContain(`>${maximumLengthProject.name}</a>`)
    expect(html).toContain(`title="${lineProcess}"`)
    expect(html).toContain(`>${lineProcess}</span>`)
    expect(html).toContain(`title="${maximumLengthProject.part_id}"`)
    expect(html).toContain(`>${maximumLengthProject.part_id}</span>`)
    expect(html).toContain('DEVICE_RAW_CODE')
    expect(html).toContain('Legacy category')
    expect(html.match(/사용 중지됨/g)).toHaveLength(2)
    expect(html).toContain('min-w-0 overflow-hidden')
    expect(html).toContain('truncate whitespace-nowrap')
    expect(html).not.toContain('text-[11px]')
  })

  it('hides Layer Total before Updated at narrower desktop breakpoints', () => {
    const html = renderTable([project])

    expect(html).toMatch(/<th[^>]*class="[^"]*hidden 2xl:table-cell[^"]*"[^>]*>Layer Total<\/th>/)
    expect(html).toMatch(/<th[^>]*class="[^"]*hidden xl:table-cell[^"]*"[^>]*>Updated<\/th>/)
    expect(html).toContain('>Lineage<')
    expect(html).toContain('>허용 액션<')
  })
})
