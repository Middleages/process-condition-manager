import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { CsvImportDialog } from './CsvImportDialog'

describe('CsvImportDialog', () => {
  it('documents choice_set_code and explicitly rejects the removed options column', () => {
    const queryClient = new QueryClient()
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <CsvImportDialog open onClose={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(html).toContain('for="parameter-csv-text"')
    expect(html).toContain('id="parameter-csv-text"')
    expect(html).toContain('미리보기 (dry-run)')
    expect(html).toContain('적용')
    expect(html).toContain('disabled=""')
    expect(html).toContain('choice_set_code')
    expect(html).toContain('equipment_mode')
    expect(html).toContain('options')
    expect(html).toContain('거부')
    expect(html).toContain('pitch')
  })
})
