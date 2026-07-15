import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { CategoryCreateDialog } from './CategoryCreateDialog'

describe('CategoryCreateDialog', () => {
  it('offers category creation without update or deactivation controls', () => {
    const queryClient = new QueryClient()
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <CategoryCreateDialog open onClose={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(html).toContain('카테고리 코드')
    expect(html).toContain('표시명')
    expect(html).toContain('카테고리 만들기')
    expect(html).not.toContain('카테고리 수정')
    expect(html).not.toContain('비활성화')
  })
})
