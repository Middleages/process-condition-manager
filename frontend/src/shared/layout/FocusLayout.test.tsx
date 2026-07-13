import { renderToStaticMarkup } from 'react-dom/server'
import { Route, Routes, StaticRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { FocusLayout } from './FocusLayout'

describe('FocusLayout', () => {
  it('provides a definite min-zero viewport chain without the normal application nav', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/projects/7/sheet">
        <Routes>
          <Route element={<FocusLayout />}>
            <Route path="projects/:projectId/sheet" element={<div>sheet child</div>} />
          </Route>
        </Routes>
      </StaticRouter>,
    )

    expect(html).toContain('h-dvh min-h-0 min-w-0 overflow-hidden')
    expect(html).toContain(
      '<main id="main-content" class="h-full min-h-0 min-w-0" tabindex="-1">',
    )
    expect(html).toContain('sheet child')
    expect(html).not.toContain('<nav')
  })

  it('keeps the skip link fixed and off-canvas until focus', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/">
        <Routes>
          <Route element={<FocusLayout />}>
            <Route index element={<div />} />
          </Route>
        </Routes>
      </StaticRouter>,
    )

    expect(html).toContain('조건표로 건너뛰기')
    expect(html).toContain('fixed left-4 top-1')
    expect(html).toContain('-translate-y-14')
    expect(html).toContain('focus:translate-y-0')
  })
})
