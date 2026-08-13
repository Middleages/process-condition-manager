import { renderToStaticMarkup } from 'react-dom/server'
import { Route, Routes, StaticRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { AppLayout } from './AppLayout'

function renderLayout(): string {
  return renderToStaticMarkup(
    <StaticRouter location="/projects">
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="projects" element={<div>project child</div>} />
        </Route>
      </Routes>
    </StaticRouter>,
  )
}

describe('AppLayout', () => {
  it('renders the product rail navigation with compact destination codes', () => {
    const html = renderLayout()
    const primaryNavigation = html.match(/<nav aria-label="주요 메뉴"[^>]*>([\s\S]*?)<\/nav>/)?.[1]

    expect(primaryNavigation).toBeDefined()
    expect(primaryNavigation).toContain('href="/projects"')
    expect(primaryNavigation).toContain('href="/processes"')
    expect(primaryNavigation).toContain('href="/parameters"')
    expect(primaryNavigation).toContain('aria-current="page"')
    expect(primaryNavigation).toContain('PRJ')
    expect(primaryNavigation).toContain('PCS')
    expect(primaryNavigation).toContain('PAR')
  })

  it('keeps a 76px rail, skip link, and one main outlet boundary', () => {
    const html = renderLayout()
    const mainTag = html.match(/<main[^>]*id="main-content"[^>]*>/)?.[0]

    expect(html).toContain('grid-cols-[76px_minmax(0,1fr)]')
    expect(html).toContain('w-[76px]')
    expect(html).toContain('href="#main-content"')
    expect(html).toContain('본문으로 건너뛰기')
    expect(mainTag).toBeDefined()
    expect(mainTag).toContain('w-full')
    expect(mainTag).not.toContain('max-w-')
    expect(html.match(/project child/g)).toHaveLength(1)
  })
})
