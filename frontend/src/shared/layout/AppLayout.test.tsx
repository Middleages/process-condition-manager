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
  it('keeps the approved 52px global shell, navigation, and full-width main boundary', () => {
    const html = renderLayout()
    const headerTag = html.match(/<header[^>]*>/)?.[0]
    const mainTag = html.match(/<main[^>]*id="main-content"[^>]*>/)?.[0]

    expect(headerTag).toBeDefined()
    expect(headerTag).toContain('h-[52px]')
    expect(html).toContain('href="#main-content"')
    expect(html).toContain('본문으로 건너뛰기')
    expect(html).toContain('aria-label="주요 메뉴"')
    expect(html).toContain('aria-label="좁은 화면 주요 메뉴"')
    expect(html).toContain('aria-label="PCM 프로젝트"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('프로젝트')
    expect(html).toContain('공정 카탈로그')
    expect(html).toContain('파라미터 관리')
    expect(html).toContain('lg:hidden')
    expect(mainTag).toBeDefined()
    expect(mainTag).toContain('w-full')
    expect(mainTag).not.toContain('max-w-')
    expect(html).toContain('project child')
  })
})
