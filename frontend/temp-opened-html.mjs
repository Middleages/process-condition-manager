import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import React from 'react'
import { SheetView } from './src/features/sheets/SheetView.tsx'

function client() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        retryOnMount: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  })
}

const project = {
  id: 7,
  line_id: 'L1',
  process_id: 'etch',
  part_id: 'P-7',
  name: 'Etch qualification',
  status: 'draft',
  profile: {
    project_id: 7,
    process_name: 'Etch',
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
  layers: [],
}
const sheet = {
  columns: [{
    parameter_code: 'ETCH_P001',
    display_name: 'Pressure',
    value_type: 'number',
    category_code: 'process',
    unit: 'mTorr',
    min_value: null,
    max_value: null,
    required: false,
    pattern: null,
    pattern_hint: null,
    description: null,
    choice_set_code: null,
    choice_set_version: null,
    sort_order: 1,
  }],
  rows: [{
    condition_id: 11,
    layer_key: 'L1::10::ETCH',
    layer_label: 'ETCH (10)',
    condition_label: 'POR',
    is_por: true,
    layer_sort_order: 0,
    condition_index: 1,
    cells: { ETCH_P001: '12' },
  }],
  lock: { locked_by: null, locked_at: null, expires_at: null, is_mine: false, heartbeat_seconds: 45 },
  validation_rules: [],
  validation_basis_hash: 'sha256:test',
}

const qc = client()
qc.setQueryData(['project', 7], project)
qc.setQueryData(['sheet', 7], sheet)

const html = renderToStaticMarkup(
  React.createElement(
    QueryClientProvider,
    { client: qc },
    React.createElement(StaticRouter, { location: '/projects/7/sheet' }, React.createElement(SheetView, { projectId: 7 })),
  ),
)

console.log('includes', html.includes('data-sheet-workbench'))
console.log('count', (html.match(/data-sheet-workbench/g) || []).length)
console.log('indices', [...html.matchAll(/data-sheet-workbench/g)].map((m) => m.index))
console.log('separator count', (html.match(/role="separator"/g) || []).length)
console.log('separator indices', [...html.matchAll(/role="separator"/g)].map((m) => m.index))
