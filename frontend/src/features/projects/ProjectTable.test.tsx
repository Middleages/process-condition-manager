import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, StaticRouter } from 'react-router-dom'
import { JSDOM } from 'jsdom'
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
  version: 3,
  revision_root_id: 40,
  predecessor_project_id: 41,
  successor_project_id: 43,
  allowed_actions: ['request_review', 'approve'],
  device_type: { code: 'FOUNDRY', label: 'Foundry', is_active: true },
  project_category: { code: 'LOGIC', label: 'Logic', is_active: true },
  layer_total: '8',
  updated_at: '2026-07-14T02:30:00Z',
  layer_count: 8,
  cell_count: 128,
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
  it('uses Process and Part ID as primary identity within the selected LINE', () => {
    const html = renderTable([project])
    const headers = [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((match) =>
      match[1]?.replace(/<[^>]+>/g, '').trim(),
    )

    expect(html).toContain('<table')
    expect(headers).toEqual(['Process', 'Part ID', '상태', '수정일', '공정조건 열기'])
    expect(html).toContain('aria-label="L1 coat P-42 공정조건 열기"')
    expect(html).toContain('>coat</span>')
    expect(html).toContain('>P-42</span>')
    expect(html).toContain('>작성 중<')
    expect(html).not.toContain('프로젝트명')
    expect(html).not.toContain('Device Type')
    expect(html).not.toContain('Category')
    expect(html).not.toContain(project.name)
    expect(html).not.toContain(project.device_type.label)
    expect(html).not.toContain(project.project_category.label)
  })

  it('retains long identifiers and truthful archived status without truncation', () => {
    const identifier = 'LONG_PROCESS_IDENTIFIER_'.repeat(8)
    const document = new JSDOM(renderTable([{ ...project, process_id: identifier, status: 'archived' }])).window.document
    expect(document.querySelector('tbody td')?.textContent).toContain(identifier)
    expect(document.querySelector('tbody')?.textContent).toContain('보존')
    expect(document.querySelector('.truncate')).toBeNull()
  })

  it('keeps the open link route and return-focus data', () => {
    const html = renderTable([project])

    expect(html).toContain('href="/projects/42"')
    expect(html).toContain('data-project-id="42"')
  })

  it('uses a real open link, a noninteractive status badge and no lineage disclosure', () => {
    const opened: number[] = []
    const view = renderInteractiveTable(id => opened.push(id))
    try {
      const link = view.container.querySelector<HTMLAnchorElement>('[data-project-id="42"]')!
      expect(link.textContent).toBe('열기')
      expect(view.container.textContent).not.toContain('리비전 루트')
      expect(view.container.textContent).not.toContain('허용 액션')
      expect(view.container.querySelector('button')).toBeNull()
      act(() => link.dispatchEvent(new view.window.MouseEvent('click', { bubbles: true })))
      expect(opened).toEqual([42])
    } finally { view.cleanup() }
  })

})

function renderInteractiveTable(onProjectOpen: (projectId: number) => void) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://pcm.test/projects',
  })
  const container = dom.window.document.querySelector<HTMLDivElement>('#root')
  if (!container) throw new Error('Interactive test root is unavailable.')

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
      <MemoryRouter initialEntries={['/projects?query=coat']}>
        <ProjectTable projects={[project]} from="/projects?query=coat" onProjectOpen={onProjectOpen} />
      </MemoryRouter>,
    )
  })

  return {
    container,
    window: dom.window,
    cleanup: () => {
      act(() => root?.unmount())
      globals.window = previousGlobals.window
      globals.document = previousGlobals.document
      globals.HTMLElement = previousGlobals.HTMLElement
      globals.Node = previousGlobals.Node
      globals.IS_REACT_ACT_ENVIRONMENT = previousGlobals.IS_REACT_ACT_ENVIRONMENT
      dom.window.close()
    },
  }
}
