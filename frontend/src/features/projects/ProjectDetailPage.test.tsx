import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { Route, Routes, StaticRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { ProjectOut } from '@/api/types'

import { ProjectDetailPage } from './ProjectDetailPage'

const maximumLayerId = 'L'.repeat(64)
const maximumStepSequence = 'S'.repeat(64)
const maximumAreaName = 'A'.repeat(128)
const maximumSourceKey = 'K'.repeat(256)

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
  layers: [
    {
      id: 7,
      layer_key: 'X'.repeat(256),
      step_seq: maximumStepSequence,
      layer_id: maximumLayerId,
      eqp_type: null,
      eqp_type_desc: null,
      area_name: maximumAreaName,
      sort_order: 0,
      condition_count: 2,
      cell_count: 24,
      source_project_id: 41,
      source_layer_key: maximumSourceKey,
    },
  ],
}

function renderDetail(): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  })
  queryClient.setQueryData(['project', 42], project)

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <StaticRouter location="/projects/42">
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        </Routes>
      </StaticRouter>
    </QueryClientProvider>,
  )
}

describe('ProjectDetailPage', () => {
  it('uses compact layer rows with an exact 36px replace target', () => {
    const html = renderDetail()

    expect(html).toContain('<tr class="h-9">')
    expect(html).toContain(
      'class="h-9 shadow-[inset_0_1px_0_var(--color-border-subtle)]',
    )
    expect(html).toMatch(/<button[^>]*class="[^"]*h-9[^"]*"[^>]*>/)
  })

  it('does not announce the entire resolved detail table as a live region', () => {
    expect(renderDetail()).not.toContain('aria-live="polite"')
  })

  it('contains maximum-length Layer fields without losing their accessible text', () => {
    const html = renderDetail()
    const layerLabel = `${maximumLayerId} (${maximumStepSequence})`
    const sourceLabel = `#41 · ${maximumSourceKey}`

    expect(html).toContain('table-fixed')
    expect(html).toContain(`title="${layerLabel}"`)
    expect(html).toContain(`>${layerLabel}</span>`)
    expect(html).toContain(`title="${maximumAreaName}"`)
    expect(html).toContain(`>${maximumAreaName}</span>`)
    expect(html).toContain(`title="${sourceLabel}"`)
    expect(html).toContain(`>${sourceLabel}</span>`)
    expect(html).toContain('min-w-0 overflow-hidden')
    expect(html).toContain('truncate whitespace-nowrap')
  })

  it('renders all fixed Profile values in six explicit groups before the Layer table', () => {
    const html = renderDetail()
    const profileIndex = html.indexOf('id="project-profile-title"')
    const layersIndex = html.indexOf('id="project-layers-title"')

    expect(profileIndex).toBeGreaterThan(-1)
    expect(layersIndex).toBeGreaterThan(profileIndex)
    expect(html).toContain('data-profile-group="identity"')
    expect(html).toContain('data-profile-group="product"')
    expect(html).toContain('data-profile-group="direction"')
    expect(html).toContain('data-profile-group="die-shot"')
    expect(html).toContain('data-profile-group="wafer-position"')
    expect(html).toContain('data-profile-group="layer-summary"')

    for (const label of [
      'LINE',
      'Process ID',
      'PARTID',
      'Process Name',
      'Device Type',
      'Category',
      'Comment',
      'Active Direction',
      'Gate Direction',
      'Gross Die',
      'Pitch X',
      'Pitch Y',
      'Shot X',
      'Shot Y',
      'Slit Occupancy',
      'Lens Occupancy',
      'Shot Count',
      'Full Shot',
      'Map Offset X',
      'Map Offset Y',
      'Scribe Lane X',
      'Scribe Lane Y',
      'Layer Total',
      'EUV',
      'IMM',
      'ARF',
      'KRF',
      'I-line',
      'SOH',
      'PSPI',
      'Metal Layer Count',
    ]) {
      expect(html, label).toContain(`>${label}<`)
    }
  })

  it('keeps identity read-only and exposes the fenced Profile edit trigger', () => {
    const html = renderDetail()
    const identity = html.match(
      /<section[^>]*data-profile-group="identity"[\s\S]*?<\/section>/,
    )?.[0]

    expect(identity).toBeDefined()
    expect(identity).toContain('>L1<')
    expect(identity).toContain('>coat<')
    expect(identity).toContain('>P-42<')
    expect(identity).not.toContain('<input')
    expect(identity).not.toContain('<textarea')
    expect(html).toContain('기본정보 편집')
    expect(html).toContain('FOUNDRY · Foundry')
    expect(html).not.toContain('Device Ref')
  })
})
