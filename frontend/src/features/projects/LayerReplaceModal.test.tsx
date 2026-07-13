import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { ProjectLayerOut, ProjectOut } from '@/api/types'

import { LayerReplaceModal } from './LayerReplaceModal'
import layerReplaceModalSource from './LayerReplaceModal.tsx?raw'

const targetLayer: ProjectLayerOut = {
  id: 7,
  layer_key: 'coat:1',
  step_seq: '10',
  layer_id: 'COAT',
  eqp_type: null,
  eqp_type_desc: null,
  area_name: null,
  sort_order: 0,
  condition_count: 2,
  cell_count: 8,
  source_project_id: null,
  source_layer_key: null,
}

const project: ProjectOut = {
  id: 42,
  line_id: 'L1',
  process_id: 'coat',
  part_id: 'P-42',
  name: 'Coat baseline',
  description: null,
  status: 'draft',
  layers: [targetLayer],
}

function renderModal(): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  })
  queryClient.setQueryData(['projects', ''], { items: [] })

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <LayerReplaceModal project={project} targetLayer={targetLayer} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('LayerReplaceModal semantic UI contract', () => {
  it('keeps screen-local production markup free of raw Tailwind palette classes', () => {
    expect(layerReplaceModalSource).not.toMatch(
      /\b(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    )
  })

  it('uses the shared alert and button semantics for errors and apply availability', () => {
    const html = renderModal()

    expect(layerReplaceModalSource).toMatch(/<InlineAlert[^>]*tone="error"/)
    expect(layerReplaceModalSource).toContain('loading={replaceMutation.isPending}')
    expect(html).toContain('bg-brand-700')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*교체 적용.*<\/button>/)
  })
})
