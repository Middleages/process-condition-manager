import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider, StaticRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type {
  BackboneCandidateOut,
  MatchPreviewOut,
  ProcessDetailOut,
  ProcessListOut,
  ProjectProfileOut,
} from '@/api/types'
import type { ChoiceSetOptionsResource } from '@/features/choiceSets/useChoiceSetOptions'

import { ProjectCreatePage } from './ProjectCreatePage'
import { ProjectCreateWizard, RequiredProfileChoiceField } from './ProjectCreateWizard'
import { previewFingerprint } from './wizardState'

const directProcess: ProcessDetailOut = {
  key: 'LINE Z::outside first page',
  line_id: 'LINE Z',
  process_id: 'outside first page',
  display_name: 'LINE Z / outside first page',
  step_count: 4,
  area_names: ['ETCH'],
  has_project: false,
  project_count: 0,
}

const firstPage: ProcessListOut = {
  items: [
    {
      key: 'LINE A::first',
      line_id: 'LINE A',
      process_id: 'first',
      display_name: 'LINE A / first',
      sort_order: 1,
      has_project: false,
    },
  ],
  next_cursor: null,
}

const preview: MatchPreviewOut = {
  match_rate: 0,
  matched_count: 0,
  unmatched_count: 1,
  copy_condition_count: 0,
  copy_cell_count: 0,
  matches: [
    {
      target_layer_key: '4::ETCH',
      source_layer_key: null,
      match_type: 'unmatched',
    },
  ],
}

const automaticPreview: MatchPreviewOut = {
  match_rate: 1,
  matched_count: 1,
  unmatched_count: 0,
  copy_condition_count: 1,
  copy_cell_count: 2,
  matches: [
    {
      target_layer_key: '4::ETCH',
      source_layer_key: 'SOURCE::AUTO',
      match_type: 'auto',
    },
  ],
}

const backboneCandidate: BackboneCandidateOut = {
  id: 17,
  name: 'Reference backbone',
  line_id: directProcess.line_id,
  process_id: directProcess.process_id,
  part_id: 'REF-17',
  status: 'draft',
  layer_count: 4,
  match_rate: 0.75,
  matched_count: 3,
  unmatched_count: 1,
}

const projectProfile: ProjectProfileOut = {
  project_id: 7,
  process_name: 'Source',
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
}

function renderWizard(
  location: string,
  seedSelectedProcess: boolean,
  routeElement: ReactElement = <ProjectCreateWizard onCreated={vi.fn()} />,
): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(['processes', 'picker', ''], {
    pages: [firstPage],
    pageParams: [null],
  })

  if (seedSelectedProcess) {
    queryClient.setQueryData(['process', directProcess.key], directProcess)
    queryClient.setQueryData(
      ['backbone-candidates', directProcess.line_id, directProcess.process_id],
      [backboneCandidate],
    )
    queryClient.setQueryData(
      ['backbone-preview', previewFingerprint(directProcess.key, null, {})],
      {
        fingerprint: previewFingerprint(directProcess.key, null, {}),
        preview,
      },
    )
  }

  const router = createMemoryRouter(
    [
      {
        path: '/projects/new',
        element: routeElement,
      },
    ],
    { initialEntries: [location] },
  )

  const originalConsoleError = console.error
  const consoleError = vi.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (String(message).includes('useLayoutEffect does nothing on the server')) return
    originalConsoleError(message, ...args)
  })

  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
  } finally {
    consoleError.mockRestore()
  }
}

function renderAutomaticBackbonePreview(): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  const fingerprint = previewFingerprint(directProcess.key, 7, {})
  queryClient.setQueryData(['processes', 'picker', ''], {
    pages: [firstPage],
    pageParams: [null],
  })
  queryClient.setQueryData(['process', directProcess.key], directProcess)
  queryClient.setQueryData(['project', 7], {
    id: 7,
    line_id: 'SOURCE',
    process_id: 'BASE',
    part_id: 'BASE-1',
    name: 'Source backbone',
    status: 'draft',
    profile: projectProfile,
    layers: [
      {
        id: 70,
        layer_key: 'SOURCE::AUTO',
        step_seq: '10',
        layer_id: 'AUTO',
        eqp_type: null,
        eqp_type_desc: null,
        area_name: null,
        sort_order: 1,
        condition_count: 1,
        cell_count: 2,
        source_project_id: null,
        source_layer_key: null,
      },
      {
        id: 71,
        layer_key: 'SOURCE::MANUAL',
        step_seq: '20',
        layer_id: 'MANUAL',
        eqp_type: null,
        eqp_type_desc: null,
        area_name: null,
        sort_order: 2,
        condition_count: 0,
        cell_count: 0,
        source_project_id: null,
        source_layer_key: null,
      },
    ],
  })
  queryClient.setQueryData(['backbone-preview', fingerprint], {
    fingerprint,
    preview: automaticPreview,
  })

  const params = new URLSearchParams({
    step: '3',
    process: directProcess.key,
    backbone: '7',
  })
  const router = createMemoryRouter(
    [
      {
        path: '/projects/new',
        element: <ProjectCreateWizard onCreated={vi.fn()} />,
      },
    ],
    { initialEntries: [`/projects/new?${params}`] },
  )

  const originalConsoleError = console.error
  const consoleError = vi.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (String(message).includes('useLayoutEffect does nothing on the server')) return
    originalConsoleError(message, ...args)
  })

  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
  } finally {
    consoleError.mockRestore()
  }
}

describe('ProjectCreateWizard route restoration', () => {
  it('restores a direct Process outside picker results without selecting the first result', () => {
    const params = new URLSearchParams({ step: '3', process: directProcess.key })
    const html = renderWizard(`/projects/new?${params}`, true)

    expect(html).toContain('LINE Z / outside first page')
    expect(html).not.toContain('LINE A / first')
    expect(html).toContain('매칭 확인 · 프로젝트 정보</h2>')
    expect(html).toContain('현재 3/3')
    expect(html).toContain('완료')
  })

  it('keeps a direct step three visible while its Process detail is pending', () => {
    const params = new URLSearchParams({ step: '3', process: directProcess.key })
    const html = renderWizard(`/projects/new?${params}`, false)

    expect(html).toContain('매칭 확인 · 프로젝트 정보</h2>')
    expect(html).toContain('URL에서 선택한 Process를 복원하는 중입니다.')
    expect(html).toMatch(
      /<input(?=[^>]*id="project-part-id")(?=[^>]*disabled="")[^>]*>/,
    )
    expect(html).toMatch(
      /<input(?=[^>]*id="project-name")(?=[^>]*disabled="")[^>]*>/,
    )
  })

  it('uses the approved tokenized focus ring on a programmatically focused step heading', () => {
    const params = new URLSearchParams({ step: '3', process: directProcess.key })
    const html = renderWizard(`/projects/new?${params}`, true)

    expect(html).toMatch(
      /<h2(?=[^>]*tabindex="-1")(?=[^>]*focus:outline-2)(?=[^>]*focus:outline-offset-2)(?=[^>]*focus:outline-brand-700)[^>]*>/,
    )
  })

  it('uses one restrained work frame and a compact step progress contract', () => {
    const params = new URLSearchParams({ step: '3', process: directProcess.key })
    const html = renderWizard(`/projects/new?${params}`, true)

    expect(html).toContain('aria-label="프로젝트 생성 진행"')
    expect(html).toContain('aria-current="step"')
    expect(html).toContain('현재 3/3')
    expect(html).not.toContain('>3단계<')
    expect(html).not.toContain('shadow-sm')
  })

  it('presents Process results as one scan list with a sticky selected summary', () => {
    const html = renderWizard('/projects/new', false)

    expect(html).toContain('aria-label="Process 선택 목록"')
    expect(html).toContain('aria-label="선택한 Process 요약"')
    expect(html).not.toContain('class="grid gap-2 md:grid-cols-2"')
    expect(html).toMatch(
      /<ul(?=[^>]*aria-label="Process 선택 목록")(?=[^>]*max-h-\[32rem\])(?=[^>]*overflow-y-auto)[^>]*>/,
    )
    expect(html).toMatch(
      /<aside(?=[^>]*aria-label="선택한 Process 요약")(?=[^>]*xl:sticky)(?=[^>]*xl:top-5)[^>]*>/,
    )
  })

  it('keeps the sole Process continue action inside the selected summary', () => {
    const html = renderWizard('/projects/new', false)

    const selectedSummary = html.match(
      /<aside(?=[^>]*aria-label="선택한 Process 요약")[\s\S]*?<\/aside>/,
    )?.[0]
    expect(selectedSummary).toContain('백본 선택으로')
    expect(html.match(/백본 선택으로/g)).toHaveLength(1)
  })

  it('presents backbone choices as one compact comparison list with no backbone first', () => {
    const params = new URLSearchParams({ step: '2', process: directProcess.key })
    const html = renderWizard(`/projects/new?${params}`, true)

    expect(html).toContain('aria-label="백본 선택 목록"')
    expect(html).toContain('백본 없이 시작')
    expect(html.indexOf('백본 없이 시작')).toBeLessThan(html.indexOf(backboneCandidate.name))
    expect(html).toContain('REF-17 · Layer 3/4')
    expect(html).toContain('매칭 75% · 미매칭 1')
    expect(html).toContain('aria-pressed="true"')
  })

  it('frames the full creation route with a clear title and project-list return action', () => {
    const html = renderWizard('/projects/new', false, <ProjectCreatePage />)

    expect(html).toContain('새 프로젝트 만들기')
    expect(html).toContain('href="/projects"')
    expect(html).toContain('프로젝트 목록')
    expect(html).toContain('max-w-[1440px]')
    expect(html).toContain('class="btn-secondary gap-2"')
  })

  it('offers a manual override for an automatic match with an accurate default', () => {
    const html = renderAutomaticBackbonePreview()

    expect(html).toContain('aria-label="4::ETCH 수동 매칭"')
    expect(html).toContain('<option value="" selected="">자동 매칭 유지 · SOURCE::AUTO</option>')
    expect(html).toContain('value="SOURCE::MANUAL"')
  })

  it('keeps the W1 third step and adds only the core Profile inputs', () => {
    const params = new URLSearchParams({ step: '3', process: directProcess.key })
    const html = renderWizard(`/projects/new?${params}`, true)

    expect(html).toContain('매칭 확인 · 프로젝트 정보</h2>')
    expect(html).toContain('LINE')
    expect(html).toContain('LINE Z')
    expect(html).toContain('Device Type')
    expect(html).toContain('Project Category')
    expect(html).toContain('Comment')
    expect(html).not.toContain('Gross Die')
    expect(html).not.toContain('Pitch X')
  })
})

function choiceResource(
  patch: Partial<ChoiceSetOptionsResource> = {},
): ChoiceSetOptionsResource {
  return {
    setCode: 'device_type',
    version: 1,
    setIsActive: true,
    displayOptions: [{ code: 'FOUNDRY', label: 'Foundry', sort_order: 0, is_active: true }],
    selectableOptions: [
      { code: 'FOUNDRY', label: 'Foundry', sort_order: 0, is_active: true },
    ],
    selectionReady: true,
    loading: false,
    refreshing: false,
    error: null,
    prepareToOpen: vi.fn().mockResolvedValue(undefined),
    refetchSummary: vi.fn().mockResolvedValue(undefined),
    retryOptions: vi.fn().mockResolvedValue(undefined),
    ...patch,
  }
}

function renderRequiredChoice(
  resource: ChoiceSetOptionsResource,
  value = '',
): string {
  return renderToStaticMarkup(
    <StaticRouter location="/projects/new">
      <RequiredProfileChoiceField
        id="project-device-type"
        label="Device Type"
        value={value}
        resource={resource}
        adminHref="/parameters/choice-sets/device_type"
        disabled={false}
        onChange={vi.fn()}
      />
    </StaticRouter>,
  )
}

describe('RequiredProfileChoiceField', () => {
  it('renders an active managed option without a free-text fallback', () => {
    const html = renderRequiredChoice(choiceResource(), 'FOUNDRY')

    expect(html).toContain('FOUNDRY · Foundry')
    expect(html).toContain('role="combobox"')
    expect(html).not.toContain('관리 화면에서 활성화')
  })

  it('owns loading and retryable error states while retaining the raw draft', () => {
    const loading = renderRequiredChoice(
      choiceResource({ loading: true, selectionReady: false }),
      'RAW-DRAFT',
    )
    const error = renderRequiredChoice(
      choiceResource({
        error: '선택지를 불러오지 못했습니다.',
        selectionReady: false,
        displayOptions: [],
        selectableOptions: [],
      }),
      'RAW-DRAFT',
    )

    expect(loading).toContain('선택지를 불러오는 중입니다.')
    expect(loading).toContain('RAW-DRAFT')
    expect(error).toContain('선택지를 불러오지 못했습니다.')
    expect(error).toContain('다시 시도')
    expect(error).toContain('RAW-DRAFT')
  })

  it.each([
    ['inactive', { setIsActive: false, selectionReady: false }, '다시 활성화'],
    [
      'empty',
      { displayOptions: [], selectableOptions: [], selectionReady: true },
      '활성 선택지를 추가',
    ],
  ] as const)('links an %s set state to its admin page', (_label, patch, copy) => {
    const html = renderRequiredChoice(choiceResource(patch))

    expect(html).toContain(copy)
    expect(html).toContain('href="/parameters/choice-sets/device_type"')
  })

  it('preserves a selection that disappeared from the active options and blocks it visibly', () => {
    const html = renderRequiredChoice(
      choiceResource({
        displayOptions: [
          { code: 'MEMORY', label: 'Memory', sort_order: 1, is_active: true },
        ],
        selectableOptions: [
          { code: 'MEMORY', label: 'Memory', sort_order: 1, is_active: true },
        ],
      }),
      'STALE_RAW_CODE',
    )

    expect(html).toContain('STALE_RAW_CODE')
    expect(html).toContain('최신 활성 선택지에 없습니다')
    expect(html).toContain('href="/parameters/choice-sets/device_type"')
  })
})
