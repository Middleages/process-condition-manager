import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { ProjectLayerOut, ProjectOut } from '@/api/types'
import { Button } from '@/shared/components/Button'

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
  status: 'draft',
  profile: {
    project_id: 42,
    process_name: 'Coat',
    device_type: { code: 'FOUNDRY', label: 'Foundry', is_active: true },
    project_category: { code: 'LOGIC', label: 'Logic', is_active: true },
    comment: null,
    active_direction: null,
    gate_direction: null,
    gross_die: null,
    pitch_x: null,
    pitch_y: null,
    shot_x: null,
    shot_y: null,
    slit_occupancy: null,
    lens_occupancy: null,
    map_offset_x: null,
    map_offset_y: null,
    scribe_lane_x: null,
    scribe_lane_y: null,
    shot_count: null,
    full_shot: null,
    layer_total: null,
    euv: null,
    imm: null,
    arf: null,
    krf: null,
    iline: null,
    soh: null,
    pspi: null,
    metal_layer_count: null,
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  },
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

  it('keeps the apply name and reserved width stable while loading', () => {
    const loadingButtonHtml = renderToStaticMarkup(<Button loading>교체 적용</Button>)

    expect(layerReplaceModalSource).toMatch(
      /loading=\{replaceMutation\.isPending\}[\s\S]*?>\s*교체 적용\s*<\/Button>/,
    )
    expect(layerReplaceModalSource).not.toContain('교체 중...')
    expect(loadingButtonHtml).toContain('aria-busy="true"')
    expect(loadingButtonHtml).toContain('disabled=""')
    expect(loadingButtonHtml).toMatch(/<span class="[^"]*opacity-0[^"]*">교체 적용<\/span>/)
    expect(loadingButtonHtml).toContain('aria-hidden="true"')
  })
})
