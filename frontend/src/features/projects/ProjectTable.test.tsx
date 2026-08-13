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
  it('uses LINE, PROCESS, and PART ID as the primary project identity', () => {
    const html = renderTable([project])
    const headers = [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((match) =>
      match[1]?.replace(/<[^>]+>/g, '').trim(),
    )

    expect(html).toContain('<table')
    expect(headers).toEqual(['LINE', 'PROCESS', 'PART ID', '상태', 'UPDATED', ''])
    expect(html).toContain('>L1</a>')
    expect(html).toContain('>coat</span>')
    expect(html).toContain('>P-42</span>')
    expect(html).toContain('>초안<')
    expect(html).not.toContain('프로젝트명')
    expect(html).not.toContain('Device Type')
    expect(html).not.toContain('Category')
    expect(html).not.toContain(project.name)
    expect(html).not.toContain(project.device_type.label)
    expect(html).not.toContain(project.project_category.label)
  })

  it('keeps the LINE link route and return-focus data', () => {
    const html = renderTable([project])

    expect(html).toContain('href="/projects/42"')
    expect(html).toContain('data-project-id="42"')
  })

  it('opens and closes the disclosure row and invokes the real LINE link callback', () => {
    const openedProjectIds: number[] = []
    const interactive = renderInteractiveTable((projectId) => openedProjectIds.push(projectId))

    try {
      const disclosure = interactive.container.querySelector('button')
      const details = interactive.container.querySelector('#project-details-42')
      const lineLink = interactive.container.querySelector<HTMLAnchorElement>('[data-project-id="42"]')

      expect(disclosure).not.toBeNull()
      expect(details).not.toBeNull()
      expect(lineLink).not.toBeNull()
      expect(disclosure?.getAttribute('aria-expanded')).toBe('false')
      expect(disclosure?.getAttribute('aria-controls')).toBe('project-details-42')
      expect(details?.hasAttribute('hidden')).toBe(true)

      act(() => disclosure?.dispatchEvent(new interactive.window.MouseEvent('click', { bubbles: true })))

      expect(disclosure?.getAttribute('aria-expanded')).toBe('true')
      expect(details?.hasAttribute('hidden')).toBe(false)
      expect(details?.textContent).toContain('리비전 루트')
      expect(details?.textContent).toContain('허용 액션')
      expect(details?.textContent).toContain('요청')
      expect(details?.textContent).toContain('승인')

      act(() => disclosure?.dispatchEvent(new interactive.window.MouseEvent('click', { bubbles: true })))

      expect(disclosure?.getAttribute('aria-expanded')).toBe('false')
      expect(details?.hasAttribute('hidden')).toBe(true)

      act(() => lineLink?.dispatchEvent(new interactive.window.MouseEvent('click', { bubbles: true })))

      expect(openedProjectIds).toEqual([42])
    } finally {
      interactive.cleanup()
    }
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
