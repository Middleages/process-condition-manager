import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { ParameterSectionNav } from './ParameterSectionNav'

describe('ParameterSectionNav', () => {
  it('renders a horizontal two-item section nav with only the exact section current', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let html: string
    try {
      html = renderToStaticMarkup(
        <MemoryRouter initialEntries={['/parameters/choice-sets']}>
          <ParameterSectionNav />
        </MemoryRouter>,
      )
    } finally {
      consoleError.mockRestore()
    }

    expect(html).toContain('aria-label="파라미터 관리 섹션"')
    expect(html).toContain('href="/parameters"')
    expect(html).toContain('href="/parameters/choice-sets"')
    expect(html).toContain('파라미터')
    expect(html).toContain('선택지 집합')
    expect((html.match(/aria-current="page"/g) ?? [])).toHaveLength(1)
    expect(html).toContain('overflow-x-auto')
  })
})
