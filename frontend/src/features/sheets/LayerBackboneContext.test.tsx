import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ProjectLayerOut, ProjectOut } from '@/api/types'

import { LayerBackboneContext } from './LayerBackboneContext'

const layer: ProjectLayerOut = {
  id: 1,
  layer_key: 'L1::020::CLEAN',
  step_seq: '020',
  layer_id: 'CLEAN',
  eqp_type: null,
  eqp_type_desc: null,
  area_name: null,
  sort_order: 0,
  condition_count: 1,
  cell_count: 1,
  source_project_id: 17,
  source_layer_key: 'SOURCE::010::ACT',
}

const sourceProject: ProjectOut = {
  id: 17,
  line_id: 'LINE-02',
  process_id: 'COATING',
  part_id: 'A16-CATH-02',
  name: 'Coating Backbone',
  status: 'approved',
  version: 1,
  revision_root_id: null,
  predecessor_project_id: null,
  successor_project_id: null,
  allowed_actions: [],
  profile: {
    project_id: 17,
    process_name: 'Coating',
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
    created_at: '2026-08-14T00:00:00Z',
    updated_at: '2026-08-14T00:00:00Z',
  },
  layers: [
    {
      ...layer,
      id: 71,
      layer_key: 'SOURCE::010::ACT',
      step_seq: '010',
      layer_id: 'ACT',
      source_project_id: null,
      source_layer_key: null,
    },
  ],
}

function client(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryOnMount: false, staleTime: Number.POSITIVE_INFINITY },
    },
  })
}

function render(queryClient: QueryClient, currentLayer: ProjectLayerOut | null): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <LayerBackboneContext layer={currentLayer} />
    </QueryClientProvider>,
  )
}

function setQueryError(queryClient: QueryClient, error: Error): void {
  const query = queryClient.getQueryCache().build(queryClient, {
    queryKey: ['project', 17],
    queryFn: async () => undefined,
  })
  query.setState({
    ...query.state,
    dataUpdatedAt: 0,
    error,
    errorUpdatedAt: Date.now(),
    fetchStatus: 'idle',
    status: 'error',
  })
}

describe('LayerBackboneContext', () => {
  it('shows no Backbone when the current Layer has no source IDs', () => {
    expect(render(client(), { ...layer, source_project_id: null, source_layer_key: null }))
      .toContain('백본 없음')
  })

  it('shows the linked source project and Layer', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 17], sourceProject)

    const html = render(queryClient, layer)

    expect(html).toContain('LINE-02 / COATING / A16-CATH-02')
    expect(html).toContain('010 / ACT')
  })

  it('shows loading while the linked source project is pending', () => {
    const queryClient = client()
    const query = queryClient.getQueryCache().build(queryClient, {
      queryKey: ['project', 17],
      queryFn: () => new Promise<never>(() => undefined),
    })
    query.setState({ ...query.state, fetchStatus: 'fetching', status: 'pending' })

    expect(render(queryClient, layer)).toContain('백본 정보 불러오는 중')
  })

  it('shows unavailable when the linked source Layer is absent', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 17], { ...sourceProject, layers: [] })

    expect(render(queryClient, layer)).toContain('백본 정보를 불러올 수 없음')
  })

  it('shows unavailable when the linked source project request fails', () => {
    const queryClient = client()
    setQueryError(queryClient, new Error('source unavailable'))

    expect(render(queryClient, layer)).toContain('백본 정보를 불러올 수 없음')
  })
})
