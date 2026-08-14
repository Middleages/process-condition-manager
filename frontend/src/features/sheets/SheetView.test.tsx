import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { JSDOM } from 'jsdom'
import { act, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryRouter,
  Route,
  RouterProvider,
  Routes,
  StaticRouter,
} from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  HistoryCellHistoryOut,
  HistoryCoverageOut,
  HistoryDetailOut,
  HistoryTimelineItemOut,
} from '@/api/history'
import type { ProjectOut, SheetOut } from '@/api/types'
import type { ConditionGridHandle, ConditionGridProps } from '@/grid'

let mockScrollToCondition = vi.fn<(conditionId: string) => void>()
let mockScrollToCell = vi.fn<(conditionId: string, parameterCode: string) => void>()
let mockScrollToColumn = vi.fn<(parameterCode: string) => void>()

vi.mock('@/api/locks', () => ({
  acquireLock: vi.fn().mockResolvedValue({
    locked_by: 'test-user',
    lock_token: 'test-lock-token',
    locked_at: '2026-08-14T00:00:00Z',
    expires_at: '2026-08-14T00:01:00Z',
  }),
  heartbeatLock: vi.fn().mockResolvedValue({
    locked_by: 'test-user',
    lock_token: 'test-lock-token',
    locked_at: '2026-08-14T00:00:00Z',
    expires_at: '2026-08-14T00:01:00Z',
  }),
  releaseLock: vi.fn().mockResolvedValue(undefined),
  releaseLockOnUnload: vi.fn().mockReturnValue(true),
}))

vi.mock('@/api/conditions', () => ({
  addCondition: vi.fn(),
  deleteCondition: vi.fn(),
  setConditionPor: vi.fn(),
}))

vi.mock('@/api/cells', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/cells')>()
  return { ...actual, patchCells: vi.fn() }
})

vi.mock('@/api/sheets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/sheets')>()
  return { ...actual, getSheet: vi.fn() }
})

vi.mock('@/api/projects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/projects')>()
  return { ...actual, getProject: vi.fn() }
})

vi.mock('@/grid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/grid')>()
  return {
    ...actual,
    GlideConditionGrid: forwardRef(function FakeGrid(
      { data, callbacks }: ConditionGridProps,
      ref,
    ) {
      useImperativeHandle(
        ref,
        (): ConditionGridHandle => ({
          scrollToCondition: mockScrollToCondition,
          scrollToCell: mockScrollToCell,
          scrollToColumn: mockScrollToColumn,
        }),
      )
      return (
        <div
          data-testid="rendered-condition-grid"
          data-condition-ids={JSON.stringify(data.rows.map((row) => row.id))}
          data-condition-values={JSON.stringify(data.rows.map((row) => row.values))}
          data-invalid-drafts={JSON.stringify(data.invalidDrafts ?? [])}
          data-validation-statuses={JSON.stringify(data.statuses ?? [])}
          data-choice-resource-keys={JSON.stringify(Array.from(data.choiceResources?.keys() ?? []))}
        >
          {data.rows.map((row) => (
            <span key={row.id}>
              <button
                data-grid-cell-activate={row.id}
                onClick={() => callbacks?.onCellActivate?.({
                  conditionId: row.id,
                  layerKey: row.layerKey,
                  parameterCode: data.columns[0]?.key ?? '',
                })}
                type="button"
              >
                cell {row.id}
              </button>
              <button
                data-grid-condition-activate={row.id}
                onClick={() => callbacks?.onConditionActivate?.({
                  conditionId: row.id,
                  layerKey: row.layerKey,
                })}
                type="button"
              >
                condition {row.id}
              </button>
              <button
                data-grid-invalid={row.id}
                onClick={() => callbacks?.onCellInvalid?.({
                  conditionId: row.id,
                  parameterCode: data.columns[0]?.key ?? '',
                  rawValue: 'not-a-number',
                  code: 'invalid_decimal',
                  message: '숫자로 입력하세요',
                  constraint: null,
                })}
                type="button"
              >
                invalid {row.id}
              </button>
              <button
                data-grid-clear-invalid={row.id}
                onClick={() => callbacks?.onInvalidDraftClear?.(
                  row.id,
                  data.columns[0]?.key ?? '',
                )}
                type="button"
              >
                clear invalid {row.id}
              </button>
              <button
                data-grid-valid={row.id}
                onClick={() => {
                  const parameterCode = data.columns[0]?.key
                  if (parameterCode === undefined) return
                  callbacks?.onInvalidDraftClear?.(row.id, parameterCode)
                  callbacks?.onCellEdit?.({
                    conditionId: row.id,
                    parameterCode,
                    value: '21',
                  })
                }}
                type="button"
              >
                valid {row.id}
              </button>
            </span>
          ))}
          <button
            data-grid-stage-paste
            onClick={() => {
              const row = data.rows[0]
              const column = data.columns[0]
              if (row !== undefined && column !== undefined) {
                callbacks?.onPaste?.(
                  { conditionId: row.id, parameterCode: column.key },
                  '99',
                )
              }
            }}
            type="button"
          >
            stage paste
          </button>
        </div>
      )
    }),
  }
})

type MockSheetWorkbenchState = {
  mode: 'validation' | 'history' | 'backbone-diff' | null
  open: () => void
  close: () => void
  toggle: () => void
  selectMode: (mode: 'validation' | 'history' | 'backbone-diff') => void
  resizeBy: () => void
  setHeight: () => void
  panelHeight: number
}

type MockHistoryController = {
  state: HistoryWorkbenchState
  coverage: HistoryCoverageOut
  timelineStatus: 'idle' | 'loading' | 'ready' | 'error'
  timelineError: string | null
  nextPageError: string | null
  cellHistory: HistoryCellHistoryOut | null
  cellStatus: 'idle' | 'loading' | 'ready' | 'error'
  cellError: string | null
  cellNextPageError: string | null
  batchDetailStatus: 'idle' | 'loading' | 'ready' | 'error'
  batchDetailError: string | null
  batchDetailIsFetchingNextPage: boolean
  batchDetailNextPageError: string | null
  onFiltersChange: (filters: unknown) => void
  onModeChange: (mode: 'timeline' | 'cell') => void
  onBatchToggle: (item: HistoryTimelineItemOut, shouldRequestDetail: boolean) => void
  onRetryBatchDetail: (item: HistoryTimelineItemOut) => void
  onLoadMoreBatchDetail: (item: HistoryTimelineItemOut, cursor: string | null) => void
  onCellHistoryRequest: (target: { conditionId: string; parameterCode: string }) => boolean
  onLoadMoreTimeline: (cursor: string | null) => void
  onLoadMoreCell: (cursor: string | null) => void
  onRetryTimeline: () => void
  onRetryCell: () => void
}

let mockSheetWorkbenchState = createMockSheetWorkbenchState()
let mockHistoryWorkbenchController = createMockHistoryController()
let mockBackboneDiffWorkbenchController = createMockBackboneDiffWorkbenchController()

vi.mock('./SheetWorkbench', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./SheetWorkbench')>()
  return {
    ...actual,
    useSheetWorkbenchState: () => mockSheetWorkbenchState,
  }
})

vi.mock('./useHistoryWorkbenchController', () => ({
  useHistoryWorkbenchController: () => mockHistoryWorkbenchController,
}))
vi.mock('./useBackboneDiffWorkbenchController', () => ({
  useBackboneDiffWorkbenchController: () => mockBackboneDiffWorkbenchController,
}))

import { shouldFocusLiveSheetTitle, SheetView, SheetViewPage } from './SheetView'
import { patchCells } from '@/api/cells'
import { addCondition, deleteCondition, setConditionPor } from '@/api/conditions'
import { acquireLock, heartbeatLock, releaseLockOnUnload } from '@/api/locks'
import { getProject } from '@/api/projects'
import { getSheet } from '@/api/sheets'
import {
  appendHistoryWorkbenchPage,
  createHistoryWorkbenchState,
  getHistoryTimelineItemKey,
  openHistoryCellScope,
  storeHistoryBatchDetail,
  toggleHistoryBatchDetail,
  type HistoryWorkbenchState,
} from './historyWorkbenchState'
import type { BackboneDiffWorkbenchController } from './useBackboneDiffWorkbenchController'
import { dirtyKey, useEditStore } from './editStore'
import sheetViewSource from './SheetView.tsx?raw'

beforeEach(() => {
  useEditStore.getState().clearAll()
  mockScrollToCondition = vi.fn()
  mockScrollToCell = vi.fn()
  mockScrollToColumn = vi.fn()
  mockSheetWorkbenchState = createMockSheetWorkbenchState()
  mockHistoryWorkbenchController = createMockHistoryController()
  mockBackboneDiffWorkbenchController = createMockBackboneDiffWorkbenchController()
  vi.mocked(addCondition).mockReset()
  vi.mocked(deleteCondition).mockReset()
  vi.mocked(setConditionPor).mockReset()
  vi.mocked(getProject).mockReset()
  vi.mocked(getSheet).mockReset()
  vi.mocked(acquireLock).mockReset().mockResolvedValue({
    locked_by: 'test-user',
    lock_token: 'test-lock-token',
    locked_at: '2026-08-14T00:00:00Z',
    expires_at: '2026-08-14T00:01:00Z',
  })
  vi.mocked(heartbeatLock).mockReset().mockResolvedValue({
    locked_by: 'test-user',
    lock_token: 'test-lock-token',
    locked_at: '2026-08-14T00:00:00Z',
    expires_at: '2026-08-14T00:01:00Z',
  })
  vi.mocked(releaseLockOnUnload).mockReset().mockReturnValue(true)
  vi.mocked(patchCells).mockReset().mockImplementation(async (_projectId, cells) => ({
    cells,
    batch_id: 'sheet-view-test-batch',
  }))
  vi.mocked(deleteCondition).mockResolvedValue(undefined)
})

const project: ProjectOut = {
  id: 7,
  line_id: 'L1',
  process_id: 'etch',
  part_id: 'P-7',
  name: 'Etch qualification',
  status: 'draft',
  version: 1,
  revision_root_id: null,
  predecessor_project_id: null,
  successor_project_id: null,
  allowed_actions: ['request_review', 'approve'],
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

const sheet: SheetOut = {
  columns: [
    {
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
    },
  ],
  rows: [
    {
      condition_id: 11,
      layer_key: 'L1::10::ETCH',
      step_seq: '10',
      layer_id: 'ETCH',
      layer_label: 'ETCH (10)',
      condition_label: 'POR',
      is_por: true,
      layer_sort_order: 0,
      condition_index: 1,
      cells: { ETCH_P001: '12' },
    },
  ],
  lock: {
    locked_by: null,
    locked_at: null,
    expires_at: null,
    is_mine: false,
    heartbeat_seconds: 45,
  },
  validation_rules: [],
  validation_basis_hash: 'sha256:test',
}

function createMockSheetWorkbenchState(
  mode: MockSheetWorkbenchState['mode'] = null,
): MockSheetWorkbenchState {
  return {
    mode,
    open: () => undefined,
    close: () => undefined,
    toggle: () => undefined,
    selectMode: () => undefined,
    resizeBy: () => undefined,
    setHeight: () => undefined,
    panelHeight: 300,
  }
}

function createMockHistoryController(
  state: HistoryWorkbenchState = buildHistoryState(),
): MockHistoryController {
  return {
    state,
    coverage: {
      legacy_unresolved_layer_count: 1,
      legacy_detail_unavailable_count: 1,
    },
    timelineStatus: 'ready',
    timelineError: null,
    nextPageError: null,
    cellHistory: createCellHistory(),
    cellStatus: 'ready',
    cellError: null,
    cellNextPageError: null,
    batchDetailStatus: 'ready',
    batchDetailError: null,
    batchDetailIsFetchingNextPage: false,
    batchDetailNextPageError: null,
    onFiltersChange: () => undefined,
    onModeChange: () => undefined,
    onBatchToggle: () => undefined,
    onRetryBatchDetail: () => undefined,
    onLoadMoreBatchDetail: () => undefined,
    onCellHistoryRequest: () => true,
    onLoadMoreTimeline: () => undefined,
    onLoadMoreCell: () => undefined,
    onRetryTimeline: () => undefined,
    onRetryCell: () => undefined,
  }
}

function createMockBackboneDiffWorkbenchController(): BackboneDiffWorkbenchController {
  const onClearNavigationAnnouncement = vi.fn()
  return {
    state: {
      filters: {
        classification: ['added', 'changed', 'cleared', 'removed', 'unchanged'],
        layerKey: null,
        categoryCode: null,
        parameterCode: null,
        includeUnchanged: false,
        previewLimit: 20,
      },
      revision: 0,
      rootScope: null,
      rootBasisHash: null,
      rootCounts: {
        layer_count: 0,
        available_layer_count: 0,
        unavailable_layer_count: 0,
        row_count: 0,
        cell_count: 0,
        full_row_count: 0,
        full_cell_count: 0,
        ambiguous_lineage_count: 0,
        added_count: 0,
        changed_count: 0,
        cleared_count: 0,
        removed_count: 0,
        unchanged_count: 0,
      },
      layerSummaries: [],
      previewItems: [],
      mode: 'root',
      openLayerKey: null,
      branchScope: null,
      branchPages: [],
      branchNextCursor: null,
      openCellLayerKey: null,
      openCellRowRef: null,
      openCellScope: null,
      cellPages: [],
      cellNextCursor: null,
      navigationAnnouncement: null,
    },
    rootStatus: 'ready',
    rootError: null,
    rootNextPageError: null,
    branchStatus: 'ready',
    branchError: null,
    branchNextPageError: null,
    cellStatus: 'ready',
    cellError: null,
    cellNextPageError: null,
    onFiltersChange: () => undefined,
    onOpenBranch: () => undefined,
    onCloseBranch: () => undefined,
    onOpenCell: () => undefined,
    onCloseCell: () => undefined,
    onModeChange: () => undefined,
    onLoadMoreConditions: () => undefined,
    onLoadMoreCells: () => undefined,
    onRetryRoot: () => undefined,
    onRetryBranch: () => undefined,
    onRetryCell: () => undefined,
    onClearNavigationAnnouncement,
  }
}

function buildHistoryState(): HistoryWorkbenchState {
  const initial = createHistoryWorkbenchState({ actor: 'dev-admin' })
  const cellScoped = openHistoryCellScope(initial, {
    conditionId: 11,
    parameterCode: 'ETCH_P001',
  })
  const page = appendHistoryWorkbenchPage(cellScoped, {
    items: [createDeletedEvent(), createExpandedBatchItem()],
    nextCursor: 'cursor-2',
  })
  const expanded = toggleHistoryBatchDetail(
    page,
    getHistoryTimelineItemKey(createExpandedBatchItem()),
  )
  return storeHistoryBatchDetail(
    expanded,
    getHistoryTimelineItemKey(createExpandedBatchItem()),
    createDetail(),
  )
}

function createDeletedEvent(): HistoryTimelineItemOut {
  return {
    kind: 'event',
    cursor_id: 1,
    event_types: ['cell_update'],
    actors: ['dev-admin'],
    origins: ['manual'],
    started_at: '2026-07-17T00:00:00Z',
    occurred_at: '2026-07-17T00:00:00Z',
    layer_keys: ['L1::10::ETCH'],
    source_project_id: null,
    batch_id: null,
    matched_event_count: 1,
    total_event_count: 1,
    summary: 'event-1',
    jump_target: {
      layer_key: 'L1::10::ETCH',
      condition_id: 11,
      parameter_code: 'ETCH_P001',
      cell_ref: 'R11C3',
      jump_status: 'deleted',
    },
    detail_status: 'available',
    detail_scope: null,
    metadata_status: 'complete',
  }
}

function createExpandedBatchItem(): HistoryTimelineItemOut {
  return {
    kind: 'batch',
    cursor_id: 2,
    event_types: ['backbone_copy', 'cell_update'],
    actors: ['dev-admin'],
    origins: ['manual'],
    started_at: '2026-07-17T01:00:00Z',
    occurred_at: '2026-07-17T02:00:00Z',
    layer_keys: ['L1::10::ETCH'],
    source_project_id: 17,
    batch_id: 'batch-2',
    matched_event_count: 2,
    total_event_count: 3,
    summary: 'batch-2',
    jump_target: {
      layer_key: 'L1::10::ETCH',
      condition_id: 11,
      parameter_code: 'ETCH_P001',
      cell_ref: 'R11C3',
      jump_status: 'available',
    },
    detail_status: 'available',
    detail_scope: 'scope-2',
    metadata_status: 'legacy_partial',
  }
}

function createDetail(): HistoryDetailOut {
  return {
    order_kind: 'event_desc',
    detail_status: 'available',
    items: [
      {
        event_id: 21,
        old_code: 'OLD',
        new_code: 'NEW',
        copied_value: null,
        choice_label: 'choice',
        actor: 'dev-admin',
        origin: 'manual',
        created_at: '2026-07-17T00:00:00Z',
        layer_key: 'L1::10::ETCH',
        jump_target: {
          layer_key: 'L1::10::ETCH',
          condition_id: 11,
          parameter_code: 'ETCH_P001',
          cell_ref: 'R11C3',
          jump_status: 'available',
        },
        domain_coordinate: null,
        capture_tuple: null,
        metadata_status: 'complete',
      },
    ],
    reason: null,
    next_cursor: null,
  }
}

function createCellHistory(): HistoryCellHistoryOut {
  return {
    items: [
      {
        event_id: 31,
        old_code: 'OLD',
        new_code: 'NEW',
        choice_label: 'choice',
        actor: 'dev-admin',
        origin: 'manual',
        created_at: '2026-07-17T00:00:00Z',
        layer_key: 'L1::10::ETCH',
        jump_status: 'deleted',
        metadata_status: 'complete',
      },
    ],
    baseline_entry: null,
    initial_entry: null,
    initial_state_unavailable: true,
    next_cursor: 'cell-cursor-2',
  }
}

function client(): QueryClient {
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

function setQueryError(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  error: Error,
  data?: unknown,
): void {
  const query = queryClient.getQueryCache().build(queryClient, {
    queryKey,
    queryFn: async () => data,
  })
  query.setState({
    ...query.state,
    data,
    dataUpdatedAt: data === undefined ? 0 : Date.now(),
    error,
    errorUpdatedAt: Date.now(),
    fetchStatus: 'idle',
    status: 'error',
  })
}

function renderSheet(queryClient: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <StaticRouter location="/projects/7/sheet">
        <SheetView projectId={7} />
      </StaticRouter>
    </QueryClientProvider>,
  )
}

describe('SheetView focus shell integration', () => {
  it('restores the live header only when the replaced fallback left focus behind', () => {
    const body = { isConnected: true } as unknown as HTMLElement
    const disconnectedFallback = { isConnected: false } as unknown as HTMLElement
    const connectedControl = { isConnected: true } as unknown as HTMLElement

    expect(shouldFocusLiveSheetTitle(null, body)).toBe(true)
    expect(shouldFocusLiveSheetTitle(body, body)).toBe(true)
    expect(shouldFocusLiveSheetTitle(disconnectedFallback, body)).toBe(true)
    expect(shouldFocusLiveSheetTitle(connectedControl, body)).toBe(false)
  })

  it('keeps programmatic H1 focus ownership without drawing an outline or ring', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 7], project)
    queryClient.setQueryData(['sheet', 7], sheet)

    const html = renderSheet(queryClient)
    const headingTag = html.match(/<h1[^>]*data-page-title[^>]*>/)?.[0]

    expect(headingTag).toBeDefined()
    expect(headingTag).toContain('tabindex="-1"')
    expect(headingTag).toContain('focus:outline-none')
    expect(headingTag).not.toMatch(/focus:(?:outline-(?:2|offset|brand)|ring)/)
  })

  it('keeps loading inside the 40px fallback header without mounting an editing session', () => {
    const queryClient = client()
    const html = renderSheet(queryClient)

    expect(html).toContain('data-sheet-focus-header="true"')
    expect(html).toContain('h-10')
    expect(html).toContain('프로젝트 #7')
    expect(html).toContain('시트를 불러오는 중')
    expect(html).not.toContain('data-sheet-editing-status')
    expect(html).not.toContain('data-sheet-editor')
    expect(queryClient.getQueryCache().find({ queryKey: ['project', 7] })).toBeDefined()
  })

  it('renders invalid and empty routes through the same frame without a grid or workbench', () => {
    const invalidClient = client()
    const invalidHtml = renderToStaticMarkup(
      <QueryClientProvider client={invalidClient}>
        <StaticRouter location="/projects/nope/sheet">
          <Routes>
            <Route path="/projects/:projectId/sheet" element={<SheetViewPage />} />
          </Routes>
        </StaticRouter>
      </QueryClientProvider>,
    )

    const emptyClient = client()
    emptyClient.setQueryData(['project', 7], project)
    emptyClient.setQueryData(['sheet', 7], { ...sheet, rows: [] })
    const emptyHtml = renderSheet(emptyClient)

    expect(invalidHtml).toContain('프로젝트 #?')
    expect(invalidHtml).toContain('올바른 프로젝트 ID')
    expect(invalidHtml).not.toContain('data-sheet-editing-status')
    expect(emptyHtml).toContain('Etch qualification')
    expect(emptyHtml).toContain('표시할 컬럼 또는 조건 행이 없습니다')
    expect(emptyHtml).not.toContain('data-sheet-editor')
    expect(emptyHtml).not.toContain('data-sheet-workbench')
  })

  it('keeps valid sheet data mounted when project metadata fails and falls back to the ID title', () => {
    const queryClient = client()
    queryClient.setQueryData(['sheet', 7], sheet)
    setQueryError(queryClient, ['project', 7], new Error('metadata unavailable'))

    const html = renderSheet(queryClient)

    expect(html).toContain('프로젝트 #7')
    expect(html).toContain('프로젝트 정보 조회에 실패')
    expect(html).toContain('metadata unavailable')
    expect(html).toContain('data-sheet-read-only="true"')
    expect(html).not.toContain('data-sheet-editor="true"')
    expect(html).not.toContain('data-sheet-editing-status="true"')
    expect(html).toContain('data-testid="rendered-condition-grid"')
    expect(html).not.toContain('data-testid="validation-definitions-pending"')
    expect(html).not.toContain('data-testid="validation-configuration-alert"')
  })

  it('renders project definition loading neutrally and disables explicit validation', () => {
    const queryClient = client()
    queryClient.setQueryData(['sheet', 7], sheet)

    const html = renderSheet(queryClient)
    expect(html).not.toContain('data-testid="validation-definitions-pending"')
    expect(html).not.toContain('검증 규칙을 불러오는 중')
    expect(html).not.toContain('data-testid="validation-configuration-alert"')
    expect(html).not.toContain('data-testid="sheet-explicit-validation"')
  })

  it('keeps an error-free ChoiceSet load pending instead of reporting configuration failure', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 7], {
      ...project,
      layers: [
        {
          id: 1,
          layer_key: 'L1::10::ETCH',
          step_seq: '10',
          layer_id: 'ETCH',
          eqp_type: null,
          eqp_type_desc: null,
          area_name: null,
          sort_order: 0,
          condition_count: 1,
          cell_count: 1,
          source_project_id: null,
          source_layer_key: null,
        },
      ],
    })
    queryClient.setQueryData(['sheet', 7], {
      ...sheet,
      columns: [
        {
          ...sheet.columns[0],
          value_type: 'choice',
          choice_set_code: 'equipment_mode',
          choice_set_version: 1,
        },
      ],
      rows: [{ ...sheet.rows[0], cells: { ETCH_P001: 'AUTO' } }],
    })

    const html = renderSheet(queryClient)

    expect(html).toContain('data-testid="validation-definitions-pending"')
    expect(html).toContain('검증 규칙을 불러오는 중')
    expect(html).not.toContain('data-testid="validation-configuration-alert"')
    expect(html).not.toContain('bg-success-surface')
  })

  it('uses project metadata for the editor header and preserves a cached sheet on refetch failure', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 7], project)
    setQueryError(queryClient, ['sheet', 7], new Error('sheet refetch failed'), sheet)

    const html = renderSheet(queryClient)

    expect(html).toContain('Etch qualification')
    expect(html).toContain('초안')
    expect(html).toContain('최신 시트 조회에 실패')
    expect(html).toContain('data-sheet-editor="true"')
    expect(html).toContain('h-full min-h-0 min-w-0')
    expect(html).not.toContain('h-[70vh]')
  })

  it('keeps one editing hook call and projectId as the only editor remount key', () => {
    const hookCalls = sheetViewSource.match(/\buseSheetEditing\s*\(/g) ?? []
    const sheetEditorKeys = sheetViewSource.match(/<SheetEditor\s+key=\{[^}]+\}/g) ?? []

    expect(hookCalls).toHaveLength(1)
    expect(sheetEditorKeys.map((match) => match.replace(/\s+/g, ' '))).toEqual([
      '<SheetEditor key={projectId}',
    ])
    expect(sheetViewSource).not.toMatch(/<SheetEditor\s+key=\{(?:sheet|category|paste|header)/)
    expect(sheetViewSource).toMatch(
      /const commitSaved = useCallback\([\s\S]*?\[queryClient, projectId\],\s*\)/,
    )
  })

  it('renders a dedicated read-only sheet path for non-draft project metadata', () => {
    const queryClient = client()
    const projectStatus = {
      ...project,
      status: 'approved' as const,
      allowed_actions: [],
    }
    queryClient.setQueryData(['project', 7], projectStatus)
    queryClient.setQueryData(['sheet', 7], {
      ...sheet,
      rows: [
        {
          ...sheet.rows[0],
          condition_id: 21,
          layer_label: 'RO-1',
          condition_label: 'POR',
          cells: { ETCH_P001: '42' },
        },
      ],
    })

    const html = renderSheet(queryClient)

    expect(html).not.toContain('data-sheet-editor="true"')
    expect(html).not.toContain('data-sheet-editing-status="true"')
    expect(html).toContain('data-sheet-read-only')
    expect(html).toContain('읽기 전용 모드입니다')
    expect(html).toContain('data-testid="sheet-category-tabs"')
    expect(html).not.toContain('data-testid="sheet-explicit-validation"')
    expect(html).not.toContain('data-testid="condition-row-manager"')
  })

  it('uses frozen choice resources for read-only sheets without editor hooks', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 7], {
      ...project,
      status: 'approved' as const,
      allowed_actions: [],
    })
    queryClient.setQueryData(['sheet', 7], {
      ...sheet,
      columns: [
        {
          ...sheet.columns[0],
          value_type: 'choice',
          choice_set_code: 'equipment_mode',
          choice_set_version: 5,
        },
      ],
      frozen_choice_sets: [
        {
          set_code: 'equipment_mode',
          version: 5,
          is_active: true,
          items: [{ code: 'AUTO', label: 'Automatic', sort_order: 1, is_active: true }],
        },
      ],
      rows: [
        {
          ...sheet.rows[0],
          condition_id: 21,
          layer_label: 'RO-1',
          condition_label: 'POR',
          cells: { ETCH_P001: 'AUTO' },
        },
      ],
    })

    const html = renderSheet(queryClient)

    expect(html).toContain('data-choice-resource-keys="[&quot;equipment_mode&quot;]"')
    expect(html).toContain('data-sheet-read-only')
  })

  it('fails closed when project metadata is unavailable (not draft)', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 7], { ...project, status: undefined } as unknown as ProjectOut)
    queryClient.setQueryData(['sheet', 7], {
      ...sheet,
      columns: [
        {
          ...sheet.columns[0],
          value_type: 'choice',
          choice_set_code: 'equipment_mode',
          choice_set_version: 5,
        },
      ],
      frozen_choice_sets: [
        {
          set_code: 'equipment_mode',
          version: 5,
          is_active: true,
          items: [{ code: 'AUTO', label: 'Automatic', sort_order: 1, is_active: true }],
        },
      ],
      rows: [
        {
          ...sheet.rows[0],
          condition_id: 21,
          layer_label: 'RO-1',
          condition_label: 'POR',
          cells: { ETCH_P001: 'AUTO' },
        },
      ],
    })

    const html = renderSheet(queryClient)

    expect(html).not.toContain('data-sheet-editor="true"')
    expect(html).toContain('data-sheet-read-only')
  })

  it('fails closed on malformed Sheet choice bindings before mounting the editing lock', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 7], project)
    queryClient.setQueryData(['sheet', 7], {
      ...sheet,
      columns: [
        {
          ...sheet.columns[0],
          value_type: 'choice',
          choice_set_code: 'equipment_mode',
          choice_set_version: null,
        },
      ],
    })

    const html = renderSheet(queryClient)

    expect(html).toContain('시트 컬럼 정보가 완전하지 않습니다')
    expect(html).not.toContain('data-sheet-editor="true"')
    expect(html).not.toContain('data-sheet-editing-status="true"')
    expect(sheetViewSource).toContain('sheetQuery.refetch')
  })

  it('transports one shared resource map and reconciles canonical responses against request revisions', () => {
    expect(sheetViewSource.match(/useSheetChoiceSets\(sheet\.columns\)/g)).toHaveLength(1)
    expect(sheetViewSource).toContain('buildReadOnlySheetChoiceResources(')
    expect(sheetViewSource).toContain('choiceResources')
    expect(sheetViewSource).toMatch(
      /buildPasteStaging\([\s\S]*?visibleColumns,[\s\S]*?persistableDisplayRows,[\s\S]*?choiceResources/,
    )
    expect(sheetViewSource).toContain('reconcileSuccessfulPatch(')
    expect(sheetViewSource).toContain('commitSaved')
    expect(sheetViewSource).not.toContain('onPersisted: commitSaved')
    expect(sheetViewSource).toContain('sheetChoiceAuthorizationEpoch(choiceResources)')
    expect(sheetViewSource).toContain('revalidatePasteStaging(')
    expect(sheetViewSource).toContain('persistablePasteCells(latestPaste, current.rows)')
    expect(sheetViewSource).toMatch(
      /await applyPaste\(pasteIdentity,[\s\S]*?\(\) => \{[\s\S]*?revalidatePasteStaging\([\s\S]*?return validCells/,
    )
    expect(sheetViewSource).toContain("Symbol('sheet-paste-review')")
    expect(sheetViewSource).toContain('abandonPaste(pasteIdentity)')
  })

  it('wires the exact Task 6 definitions and committed display buffer into validation orchestration', () => {
    expect(sheetViewSource).toContain('AdaptedConditionGridData')
    expect(sheetViewSource).toContain('toValidationInput(')
    expect(sheetViewSource).toContain('useSheetValidation({')
    expect(sheetViewSource).toContain('displayRows')
    expect(sheetViewSource).toContain('displayGeneration: editing.displayGeneration')
    expect(sheetViewSource).toContain('persistedGeneration: editing.persistedGeneration')
    expect(sheetViewSource).toContain('persistenceIdle: editing.persistenceIdle')
    expect(sheetViewSource).toContain('waitForPersistence: editing.waitForPersistence')
    expect(sheetViewSource).toContain('refetchSheet: refetchSheetForValidation')
    expect(sheetViewSource).toContain('statuses: validation.statuses')
    expect(sheetViewSource).not.toContain('toCellStatuses(dirtyCells)')
    expect(sheetViewSource).toContain("queryKey: ['project', projectId]")
  })

  it('projects provisional evaluator issues into composite grid statuses on the committed render', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 7], {
      ...project,
      layers: [
        {
          id: 1,
          layer_key: 'L1::10::ETCH',
          step_seq: '10',
          layer_id: 'ETCH',
          eqp_type: null,
          eqp_type_desc: null,
          area_name: null,
          sort_order: 0,
          condition_count: 1,
          cell_count: 0,
          source_project_id: null,
          source_layer_key: null,
        },
      ],
    })
    queryClient.setQueryData(['sheet', 7], {
      ...sheet,
      columns: [{ ...sheet.columns[0], required: true }],
      rows: [{ ...sheet.rows[0], cells: {} }],
    })

    const html = renderSheet(queryClient)

    expect(html).toContain('data-validation-statuses=')
    expect(html).toContain('Pressure 값을 입력해 주세요.')
    expect(html).toContain('&quot;dirty&quot;:false')
  })

  it('shows the compact 증거 패널 toggle for real validation issues without server-rendering the panel', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 7], {
      ...project,
      layers: [
        {
          id: 1,
          layer_key: 'L1::10::ETCH',
          step_seq: '10',
          layer_id: 'ETCH',
          eqp_type: null,
          eqp_type_desc: null,
          area_name: null,
          sort_order: 0,
          condition_count: 1,
          cell_count: 0,
          source_project_id: null,
          source_layer_key: null,
        },
      ],
    })
    queryClient.setQueryData(['sheet', 7], {
      ...sheet,
      columns: [{ ...sheet.columns[0], required: true }],
      rows: [{ ...sheet.rows[0], cells: {} }],
    })

    const html = renderSheet(queryClient)

    expect(html).toContain('data-testid="sheet-workbench-toggle"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('증거 패널')
    expect(html).not.toContain('data-sheet-workbench')
  })

  it('keeps the workbench host absent before issues or explicit completion while exposing 검증 outside it', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 7], {
      ...project,
      layers: [
        {
          id: 1,
          layer_key: 'L1::10::ETCH',
          step_seq: '10',
          layer_id: 'ETCH',
          eqp_type: null,
          eqp_type_desc: null,
          area_name: null,
          sort_order: 0,
          condition_count: 1,
          cell_count: 1,
          source_project_id: null,
          source_layer_key: null,
        },
      ],
    })
    queryClient.setQueryData(['sheet', 7], sheet)

    const html = renderSheet(queryClient)

    expect(html).toContain('data-testid="sheet-workbench-toggle"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-testid="sheet-explicit-validation"')
    expect(html).toContain('>검증<')
    expect(html).not.toContain('data-sheet-workbench')
    expect(html).not.toContain('data-validation-workbench')
  })

  it('renders the history workbench host from the shared controller when history scope is opened', () => {
    mockSheetWorkbenchState = createMockSheetWorkbenchState('history')
    mockHistoryWorkbenchController = createMockHistoryController(
      openHistoryCellScope(createHistoryWorkbenchState({ actor: 'dev-admin' }), {
        conditionId: 11,
        parameterCode: 'ETCH_P001',
      }),
    )

    const queryClient = client()
    queryClient.setQueryData(['project', 7], project)
    queryClient.setQueryData(['sheet', 7], sheet)

    const html = renderSheet(queryClient)

    expect(html).toContain('data-sheet-evidence-panel')
    expect(html).toContain('data-history-workbench')
    expect(html).toContain('condition #11')
    expect(html).toContain('parameter ETCH_P001')
    expect(html).toContain('초기 상태')
    expect(html).toContain('상세')
    expect(html).toContain('삭제된 대상이라 위치로 이동할 수 없습니다.')
    expect(html).toContain('더 보기')
    expect(html).toContain('aria-expanded="true"')
  })

  it('renders the backbone diff workbench in the same shared host without a second resizer', () => {
    mockSheetWorkbenchState = createMockSheetWorkbenchState('backbone-diff')

    const queryClient = client()
    queryClient.setQueryData(['project', 7], project)
    queryClient.setQueryData(['sheet', 7], sheet)

    const html = renderSheet(queryClient)

    expect(html).toContain('data-sheet-evidence-panel')
    expect(html).toContain('aria-label="백본 비교 워크벤치"')
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain('id="sheet-workbench-panel-backbone-diff"')
    expect(html).toContain('aria-controls="sheet-workbench-panel-backbone-diff"')
    expect(html).toContain('id="sheet-workbench-tab-backbone-diff"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('role="separator"')
  })

  it('renders one host/resizer and keeps workbench content closed until opened', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 7], project)
    queryClient.setQueryData(['sheet', 7], sheet)

    const unopened = renderSheet(queryClient)

    expect(unopened).not.toContain('data-backbone-diff-workbench')
    expect(unopened).not.toContain('role="separator"')
    expect(unopened).not.toContain('data-sheet-workbench')

    mockSheetWorkbenchState = createMockSheetWorkbenchState('backbone-diff')
    const opened = renderSheet(queryClient)

    const separatorCount = (opened.match(/role="separator"/g) ?? []).length
    expect(separatorCount).toBe(1)
    expect(opened).toContain('data-sheet-evidence-panel')
    expect(opened).toContain('aria-label="백본 비교 워크벤치"')
    expect(opened).not.toContain('data-history-workbench')
  })

  it('keeps history selected while passively showing a newly available validation issue count', () => {
    mockSheetWorkbenchState = createMockSheetWorkbenchState('history')
    const queryClient = client()
    queryClient.setQueryData(['project', 7], {
      ...project,
      layers: [
        {
          id: 1,
          layer_key: 'L1::10::ETCH',
          step_seq: '10',
          layer_id: 'ETCH',
          eqp_type: null,
          eqp_type_desc: null,
          area_name: null,
          sort_order: 0,
          condition_count: 1,
          cell_count: 0,
          source_project_id: null,
          source_layer_key: null,
        },
      ],
    })
    queryClient.setQueryData(['sheet', 7], {
      ...sheet,
      columns: [{ ...sheet.columns[0], required: true }],
      rows: [{ ...sheet.rows[0], cells: {} }],
    })

    const html = renderSheet(queryClient)
    const validationTab = html.match(
      /<button[^>]*id="sheet-workbench-tab-validation"[^>]*>/,
    )?.[0]
    const historyTab = html.match(/<button[^>]*id="sheet-workbench-tab-history"[^>]*>/)?.[0]

    expect(html).toContain('data-testid="sheet-workbench-validation-count"')
    expect(html).toContain('aria-label="검증 이슈 1건"')
    expect(validationTab).toContain('aria-selected="false"')
    expect(historyTab).toContain('aria-selected="true"')
    expect(html).toContain('data-history-workbench')
  })

  it('wires a shared jump seam into validation, history, and backbone-diff workbench content', () => {
    expect(sheetViewSource).toContain('const activateWorkbenchJumpTarget = useCallback(')
    expect(sheetViewSource).toContain('onIssueActivate={activateValidationIssue}')
    expect(sheetViewSource).toContain('onActivateTarget={activateHistoryJumpTarget}')
    expect(sheetViewSource).toContain('onActivateTarget={onBackboneActivateTarget}')
    expect(sheetViewSource).toContain('backboneDiffContent={')
    expect(sheetViewSource).toContain('<BackboneDiffWorkbench')
  })

  it('orders hidden validation navigation across a committed category change without timer races', () => {
    const categoryChange = sheetViewSource.indexOf(
      'setActiveCategory(navigation.categoryCode)',
    )
    const pendingPublication = sheetViewSource.indexOf(
      'setPendingCoordinateJump(navigation.target)',
    )
    const committedJump = sheetViewSource.indexOf(
      'gridRef.current?.scrollToCell(conditionId, parameterCode)',
    )

    expect(categoryChange).toBeGreaterThan(-1)
    expect(pendingPublication).toBeGreaterThan(categoryChange)
    expect(committedJump).toBeGreaterThan(-1)
    expect(sheetViewSource).toMatch(
      /useEffect\(\(\) => \{[\s\S]*?pendingCoordinateJump[\s\S]*?visibleColumns\.some\([\s\S]*?const conditionId = String\(pendingCoordinateJump\.conditionId\)[\s\S]*?scrollToCell\(conditionId, parameterCode\)/,
    )
    expect(sheetViewSource).toContain('resolveWorkbenchCoordinateNavigation(')
    expect(sheetViewSource).toContain('visibleColumns.some(')
    expect(sheetViewSource).not.toMatch(/setTimeout\([\s\S]*?scrollToCell/)
  })

  it('uses one navigation path with zero missing calls and one direct or committed-hidden call', () => {
    const start = sheetViewSource.indexOf('const activateWorkbenchCoordinate = useCallback(')
    const end = sheetViewSource.indexOf('const activateValidationIssue = useCallback(', start)
    const navigationBody = sheetViewSource.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(navigationBody.match(/gridRef\.current\?\.scrollToCell/g)).toHaveLength(1)
    expect(navigationBody).toMatch(
      /setPendingCoordinateJump\(null\)[\s\S]*?navigation\.kind === 'missing-target'[\s\S]*?setCoordinateNavigationStatus\('이동할 대상 셀을 찾지 못했습니다\.'\)[\s\S]*?return/,
    )
    expect(navigationBody).toMatch(
      /navigation\.kind === 'reveal-category'[\s\S]*?setActiveCategory\(navigation\.categoryCode\)[\s\S]*?setPendingCoordinateJump\(navigation\.target\)[\s\S]*?return/,
    )
    expect(sheetViewSource.match(/gridRef\.current\?\.scrollToCell/g)).toHaveLength(2)
  })

  it('wires the history controller and cell-history grid request into the shared host', () => {
    expect(sheetViewSource).toMatch(
      /useHistoryWorkbenchController\(\s*projectId,\s*workbenchState\.mode === 'history',\s*historyMutationRevision,\s*\)/,
    )
    expect(sheetViewSource).toContain('historyContent={')
    expect(sheetViewSource).toContain('<HistoryWorkbench')
    expect(sheetViewSource).toContain('onCellHistoryRequest: (payload) => {')
    expect(sheetViewSource).toMatch(
      /if \(historyWorkbench\.onCellHistoryRequest\(payload\)\) \{\s*workbenchState\.selectMode\('history'\)/,
    )
    expect(sheetViewSource).toContain('activateWorkbenchCoordinate')
    expect(sheetViewSource).toContain('onRetryBatchDetail={historyWorkbench.onRetryBatchDetail}')
    expect(sheetViewSource).toContain('navigationStatus={coordinateNavigationStatus}')
  })

  it('invalidates every same-project history view after cell and structural mutation success', () => {
    expect(sheetViewSource).toContain(
      'const [historyMutationRevision, setHistoryMutationRevision] = useState(0)',
    )
    expect(sheetViewSource).toContain(
      'invalidateProjectHistoryAfterMutation(queryClient, projectId)',
    )
    expect(sheetViewSource).toContain(
      'setHistoryMutationRevision((current) => current + 1)',
    )
    expect(sheetViewSource).toMatch(
      /await reconcileSuccessfulPatch\([\s\S]*?invalidateProjectHistory\(\)/,
    )
    expect(sheetViewSource).toMatch(
      /const result = await runStructuralChange\(fn\)[\s\S]*?invalidateProjectHistory\(\)[\s\S]*?return result/,
    )
  })

  it('adds a backbone diff mutation revision that is passed to the controller and fenced on success', () => {
    expect(sheetViewSource).toContain(
      'const [backboneDiffMutationRevision, setBackboneDiffMutationRevision] = useState(0)',
    )
    expect(sheetViewSource).toContain('invalidateProjectBackboneDiffAfterMutation(queryClient, projectId)')
    expect(sheetViewSource).toContain(
      'const invalidateProjectBackboneDiff = useCallback(() => {',
    )
    expect(sheetViewSource).toContain('setBackboneDiffMutationRevision((current) => current + 1)')
    expect(sheetViewSource).toMatch(
      /useBackboneDiffWorkbenchController\(\s*projectId,\s*workbenchState\.mode === 'backbone-diff',\s*backboneDiffMutationRevision,?\s*\)/,
    )
    expect(sheetViewSource).toContain('invalidateProjectBackboneDiff()')
    expect(sheetViewSource).toContain('invalidateProjectBackboneDiff()')
  })

  it('passes backbone diff close-navigation callbacks and announcement clear contract to the shared workbench', () => {
    expect(sheetViewSource).toContain('onCloseBranch={backboneDiffWorkbench.onCloseBranch}')
    expect(sheetViewSource).toContain('onCloseCell={backboneDiffWorkbench.onCloseCell}')
    expect(sheetViewSource).toContain('onClearBackboneNavigationAnnouncement?.()')
  })

  it('resets backbone-diff announcement via a stable clear callback, not full controller object', () => {
    expect(sheetViewSource).toMatch(
      /const \{ onClearNavigationAnnouncement: onClearBackboneNavigationAnnouncement \}\s*=\s*backboneDiffWorkbench/,
    )
    expect(sheetViewSource).toContain('onClearBackboneNavigationAnnouncement?.()')
    expect(sheetViewSource).toContain('const onBackboneRefreshAnnouncementReset = useCallback(() => {')
    const refreshAnnouncementResetStart = sheetViewSource.indexOf(
      'const onBackboneRefreshAnnouncementReset = useCallback(() => {',
    )
    expect(refreshAnnouncementResetStart).toBeGreaterThan(-1)
    const refreshAnnouncementResetBlock = sheetViewSource.slice(
      refreshAnnouncementResetStart,
      refreshAnnouncementResetStart + 220,
    )
    expect(refreshAnnouncementResetBlock).toContain('}, [onClearBackboneNavigationAnnouncement])')
    const fullControllerDependency = /}, \[backboneDiffWorkbench\]\)/.exec(refreshAnnouncementResetBlock)
    expect(fullControllerDependency).toBeNull()
  })

  it('maps backbone diff preview, condition, and cell data fields to the shared contracts', () => {
    expect(sheetViewSource).toContain('rowStatus: preview.row_status')
    expect(sheetViewSource).toContain('parameterCode: preview.parameter_code')
    expect(sheetViewSource).toContain('rowStatus: condition.row_status')
    expect(sheetViewSource).toContain('rowMetadata: mapBackboneDiffConditionRowMetadata(condition.row_metadata)')
    expect(sheetViewSource).toContain('labelChanged: metadata.label_changed')
    expect(sheetViewSource).toContain('indexChanged: metadata.index_changed')
    expect(sheetViewSource).toContain('porChanged: metadata.por_changed')
    expect(sheetViewSource).toContain('baselineValue: cell.baseline_value')
    expect(sheetViewSource).toContain('currentValue: cell.current_value')
  })

  it('uses exact baseline-unavailable announcement copy in backbone diff mode', () => {
    expect(sheetViewSource).toContain(
      'const BACKBONE_DIFF_ROOT_UNAVAILABLE_MESSAGE =',
    )
    expect(sheetViewSource).toContain(
      '저장된 기준 백본이 없어 일부 레이어의 비교 상세를 제공할 수 없습니다',
    )
    expect(sheetViewSource).not.toContain('not available')
    expect(sheetViewSource).not.toContain('더이상')
  })

  it('renders truthful read-only discovery controls with accessible pressed and status semantics', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 7], project)
    queryClient.setQueryData(['sheet', 7], sheet)

    const html = renderSheet(queryClient)

    expect(html).toMatch(/<label[^>]*for="sheet-column-search"/)
    expect(html).toContain('컬럼 검색</label>')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('id="sheet-column-search-status"')
    expect(html).toContain('role="status"')
    expect(html).toContain('잠금을 확인 중입니다')
    expect(html).not.toContain('범위 복사 Ctrl+C')
    expect(html).not.toContain('POR 이양')
  })

  it('gates every sheet mutation through one policy and delays hidden-column scrolling', () => {
    expect(sheetViewSource.match(/resolveSheetInteraction\s*\(/g)).toHaveLength(1)
    expect(sheetViewSource).toContain('if (!interaction.canEditCells) return')
    expect(sheetViewSource).toContain('if (!interaction.canStagePaste')
    expect(sheetViewSource).toContain('if (!interaction.canTransferPor) return')
    expect(sheetViewSource.match(/if \(!interaction\.canManageConditions\) return/g)).toHaveLength(3)
    expect(sheetViewSource).toContain('if (!interaction.canApplyPaste')
    expect(sheetViewSource).toContain('if (!interaction.canCancelPaste')
    expect(sheetViewSource).toContain('readOnly: !interaction.canEditCells')
    expect(sheetViewSource).toMatch(
      /useIsomorphicLayoutEffect\(\(\) => \{\s*commitPasteCallbackRuntime\(pasteCallbackRuntimeRef/,
    )
    expect(sheetViewSource).not.toContain('pasteCallbackRuntimeRef.current =')
    expect(sheetViewSource).toMatch(
      /isCurrentPasteCallback\([\s\S]*?pasteCallbackGeneration[\s\S]*?current\.generation[\s\S]*?current\.canStagePaste[\s\S]*?\)[\s\S]*?buildPasteStaging/,
    )

    const categoryChange = sheetViewSource.indexOf('setPendingColumnJump(result.parameterCode)')
    const effectScroll = sheetViewSource.indexOf(
      'gridRef.current?.scrollToColumn(pendingColumnJump)',
    )
    expect(categoryChange).toBeGreaterThan(-1)
    expect(effectScroll).toBeGreaterThan(-1)
    expect(sheetViewSource).toMatch(
      /if \(result\.requiresCategoryChange\) \{[\s\S]*?setPendingColumnJump\(result\.parameterCode\)[\s\S]*?setActiveCategory\(result\.categoryCode\)[\s\S]*?return\s*\}\s*gridRef\.current\?\.scrollToColumn\(result\.parameterCode\)/,
    )
  })

  it('uses the approved controls, POR copy, and semantic sheet palette', () => {
    expect(sheetViewSource).toContain('적용 또는 취소 후 계속')
    expect(sheetViewSource).toContain('빈 원(○)을 선택하면 POR 이양')
    expect(sheetViewSource).toContain('aria-describedby={COLUMN_SEARCH_STATUS_ID}')
    expect(sheetViewSource).toContain('aria-pressed={active}')
    expect(sheetViewSource).toContain('columnSearchRef.current?.focus()')
    expect(sheetViewSource.indexOf('columnSearchRef.current?.focus()')).toBeLessThan(
      sheetViewSource.indexOf("if (result.kind === 'empty')"),
    )
    expect(sheetViewSource).not.toMatch(
      /(?:cyan|slate|emerald|amber|rose|blue)-(?:[1-9]00|50)/,
    )
  })

  it('composes every Layer row into the Grid by default', () => {
    const queryClient = client()
    queryClient.setQueryData(['project', 7], {
      ...project,
      layers: [
        {
          id: 1,
          layer_key: 'L1::10::ETCH',
          step_seq: '10',
          layer_id: 'ETCH',
          eqp_type: null,
          eqp_type_desc: null,
          area_name: null,
          sort_order: 0,
          condition_count: 1,
          cell_count: 1,
          source_project_id: null,
          source_layer_key: null,
        },
        {
          id: 2,
          layer_key: 'L1::20::CLEAN',
          step_seq: '20',
          layer_id: 'CLEAN',
          eqp_type: null,
          eqp_type_desc: null,
          area_name: null,
          sort_order: 1,
          condition_count: 1,
          cell_count: 1,
          source_project_id: null,
          source_layer_key: null,
        },
      ],
    })
    queryClient.setQueryData(['sheet', 7], {
      ...sheet,
      rows: [
        sheet.rows[0],
        {
          ...sheet.rows[0],
          condition_id: 22,
          layer_key: 'L1::20::CLEAN',
          step_seq: '20',
          layer_id: 'CLEAN',
          layer_label: 'CLEAN (20)',
        },
      ],
    })

    const html = renderSheet(queryClient)

    expect(html).toContain(
      'data-condition-ids="[&quot;11&quot;,&quot;22&quot;]"',
    )
  })

  it('wires current-only as a controlled row view without replacing the continuous source', () => {
    const interactive = renderInteractiveSheet()

    try {
      expect(renderedConditionIds(interactive.container)).toEqual(['11', '22', '33'])

      click(interactive, layerButton(interactive.container, 'L1::20::CLEAN'))
      expect(mockScrollToCondition).toHaveBeenLastCalledWith('22')

      mockScrollToCondition.mockClear()
      click(interactive, currentOnlyButton(interactive.container))
      expect(renderedConditionIds(interactive.container)).toEqual(['22'])
      expect(mockScrollToCondition).toHaveBeenLastCalledWith('22')

      mockScrollToCondition.mockClear()
      click(interactive, currentOnlyButton(interactive.container))
      expect(renderedConditionIds(interactive.container)).toEqual(['11', '22', '33'])
      expect(mockScrollToCondition).toHaveBeenLastCalledWith('22')
    } finally {
      interactive.cleanup()
    }
  })

  it('shows the Backbone source for the active Layer instead of the first Layer', async () => {
    const interactive = renderInteractiveSheet()
    const sourceProject: ProjectOut = {
      ...project,
      id: 17,
      line_id: 'LINE-02',
      process_id: 'COATING',
      part_id: 'A16-CATH-02',
      layers: [
        {
          id: 71,
          layer_key: 'SOURCE::010::ACT',
          step_seq: '010',
          layer_id: 'ACT',
          eqp_type: null,
          eqp_type_desc: null,
          area_name: null,
          sort_order: 0,
          condition_count: 1,
          cell_count: 1,
          source_project_id: null,
          source_layer_key: null,
        },
      ],
    }

    try {
      await act(async () => {
        interactive.queryClient.setQueryData(['project', 7], {
          ...interactive.project,
          layers: interactive.project.layers.map((layer) =>
            layer.layer_key === 'L1::20::CLEAN'
              ? {
                  ...layer,
                  source_project_id: 17,
                  source_layer_key: 'SOURCE::010::ACT',
                }
              : layer,
          ),
        })
        interactive.queryClient.setQueryData(['project', 17], sourceProject)
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(interactive.container.textContent).toContain('백본 없음')

      click(interactive, layerButton(interactive.container, 'L1::20::CLEAN'))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(interactive.container.textContent).toContain('LINE-02 / COATING / A16-CATH-02')
      expect(interactive.container.textContent).toContain('010 / ACT')
    } finally {
      interactive.cleanup()
    }
  })

  it('synchronizes Backbone evidence to Layer activation while preserving other filters', () => {
    const onFiltersChange = vi.fn()
    mockSheetWorkbenchState = createMockSheetWorkbenchState('backbone-diff')
    mockBackboneDiffWorkbenchController = createMockBackboneDiffWorkbenchController()
    mockBackboneDiffWorkbenchController.state = {
      ...mockBackboneDiffWorkbenchController.state,
      filters: {
        ...mockBackboneDiffWorkbenchController.state.filters,
        categoryCode: 'process',
        parameterCode: 'ETCH_P001',
        includeUnchanged: true,
      },
    }
    mockBackboneDiffWorkbenchController.onFiltersChange = onFiltersChange
    const interactive = renderInteractiveSheet()

    try {
      onFiltersChange.mockClear()
      click(interactive, layerButton(interactive.container, 'L1::20::CLEAN'))

      expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({
        layerKey: 'L1::20::CLEAN',
        categoryCode: 'process',
        parameterCode: 'ETCH_P001',
        includeUnchanged: true,
      }))
    } finally {
      interactive.cleanup()
    }
  })

  it('shows Validation evidence only for the active Layer', () => {
    mockSheetWorkbenchState = createMockSheetWorkbenchState('validation')
    const interactive = renderInteractiveSheet({ requiredConditionIds: [11, 22, 33] })

    try {
      expect(validationIssueLabels(interactive.container)).toEqual([
        expect.stringContaining('ETCH (10)'),
      ])

      click(interactive, layerButton(interactive.container, 'L1::20::CLEAN'))

      expect(validationIssueLabels(interactive.container)).toEqual([
        expect.stringContaining('CLEAN (20)'),
      ])
    } finally {
      interactive.cleanup()
    }
  })

  it('does not treat navigation across existing global issues as a new issue generation', () => {
    const selectMode = vi.fn()
    mockSheetWorkbenchState = {
      ...createMockSheetWorkbenchState(),
      selectMode,
    }
    const interactive = renderInteractiveSheet({ requiredConditionIds: [22] })

    try {
      selectMode.mockClear()
      click(interactive, layerButton(interactive.container, 'L1::20::CLEAN'))

      expect(selectMode).not.toHaveBeenCalled()
    } finally {
      interactive.cleanup()
    }
  })

  it('recovers with prior order when Project and Sheet removals commit separately', async () => {
    const interactive = renderInteractiveSheet()

    try {
      click(interactive, layerButton(interactive.container, 'L1::20::CLEAN'))
      click(interactive, currentOnlyButton(interactive.container))
      mockScrollToCondition.mockClear()

      await act(async () => {
        interactive.queryClient.setQueryData(['project', 7], {
          ...interactive.project,
          layers: interactive.project.layers.filter(
            (layer) => layer.layer_key !== 'L1::20::CLEAN',
          ),
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(renderedConditionIds(interactive.container)).toEqual(['22'])
      expect(
        interactive.container.querySelector('[data-layer-row="L1::20::CLEAN"]'),
      ).toBeNull()

      await act(async () => {
        interactive.queryClient.setQueryData(['sheet', 7], {
          ...interactive.sheet,
          rows: interactive.sheet.rows.filter((row) => row.condition_id !== 22),
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(activeLayerKey(interactive.container)).toBe('L1::30::CMP')
      expect(mockScrollToCondition).toHaveBeenLastCalledWith('33')
    } finally {
      interactive.cleanup()
    }
  })

  it('synchronizes Layer, viewport, and evidence from Grid cell and condition callbacks', () => {
    const onFiltersChange = vi.fn()
    mockSheetWorkbenchState = createMockSheetWorkbenchState('backbone-diff')
    mockBackboneDiffWorkbenchController = createMockBackboneDiffWorkbenchController()
    mockBackboneDiffWorkbenchController.onFiltersChange = onFiltersChange
    const interactive = renderInteractiveSheet()

    try {
      onFiltersChange.mockClear()
      click(interactive, gridCallbackButton(interactive.container, 'cell', '22'))
      expect(activeLayerKey(interactive.container)).toBe('L1::20::CLEAN')
      expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({
        layerKey: 'L1::20::CLEAN',
      }))

      click(interactive, currentOnlyButton(interactive.container))
      expect(renderedConditionIds(interactive.container)).toEqual(['22'])
      click(interactive, currentOnlyButton(interactive.container))

      onFiltersChange.mockClear()
      click(interactive, gridCallbackButton(interactive.container, 'condition', '33'))
      expect(activeLayerKey(interactive.container)).toBe('L1::30::CMP')
      expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({
        layerKey: 'L1::30::CMP',
      }))
    } finally {
      interactive.cleanup()
    }
  })

  it.each([
    ['빈 행 추가', 'condition-add', null, 44],
    ['복제', 'condition-duplicate', 11, 45],
  ] as const)(
    '%s waits for refreshed rows, then focuses the returned condition once',
    async (_label, actionTestId, sourceConditionId, newConditionId) => {
      const interactive = renderInteractiveSheet()
      const sheetRefresh = deferred<SheetOut>()
      const refreshedSheet: SheetOut = {
        ...interactive.sheet,
        rows: [
          interactive.sheet.rows[0],
          {
            ...interactive.sheet.rows[0],
            condition_id: newConditionId,
            condition_label: 'C2',
            condition_index: 2,
            is_por: false,
          },
          ...interactive.sheet.rows.slice(1),
        ],
      }
      vi.mocked(getSheet).mockImplementation(() => sheetRefresh.promise)
      vi.mocked(addCondition).mockResolvedValue({
        id: newConditionId,
        layer_key: 'L1::10::ETCH',
        label: 'C2',
        condition_index: 2,
        is_por: false,
      })

      try {
        await settleInteractiveSheet()
        click(interactive, gridCallbackButton(interactive.container, 'condition', '11'))
        mockScrollToCondition.mockClear()

        click(interactive, conditionActionButton(interactive.container, actionTestId))
        await settleInteractiveSheet()

        expect(addCondition).toHaveBeenCalledWith(
          7,
          'L1::10::ETCH',
          sourceConditionId,
          'test-lock-token',
        )
        expect(getSheet).toHaveBeenCalledTimes(1)
        expect(renderedConditionIds(interactive.container)).not.toContain(String(newConditionId))
        expect(mockScrollToCondition).not.toHaveBeenCalled()

        await act(async () => {
          sheetRefresh.resolve(refreshedSheet)
          await sheetRefresh.promise
          await new Promise((resolve) => setTimeout(resolve, 10))
        })

        expect(renderedConditionIds(interactive.container)).toContain(String(newConditionId))
        expect(mockScrollToCondition).toHaveBeenCalledTimes(1)
        expect(mockScrollToCondition).toHaveBeenCalledWith(String(newConditionId))
      } finally {
        interactive.cleanup()
      }
    },
  )

  it('preserves a successful add and offers refresh recovery without re-running the mutation', async () => {
    const interactive = renderInteractiveSheet({ firstLayerConditionIds: [11, 12] })
    const refreshMessage = 'refreshed Sheet unavailable'
    const createdId = 44
    const laterSheet: SheetOut = {
      ...interactive.sheet,
      rows: [
        ...interactive.sheet.rows.slice(0, 2),
        {
          ...interactive.sheet.rows[0],
          condition_id: createdId,
          condition_label: 'C3',
          condition_index: 3,
          is_por: false,
        },
        ...interactive.sheet.rows.slice(2),
      ],
    }
    vi.mocked(addCondition).mockResolvedValue({
      id: createdId,
      layer_key: 'L1::10::ETCH',
      label: 'C3',
      condition_index: 3,
      is_por: false,
    })
    vi.mocked(getSheet)
      .mockRejectedValueOnce(new Error(refreshMessage))
      .mockResolvedValue(laterSheet)

    try {
      await settleInteractiveSheet()
      click(interactive, gridCallbackButton(interactive.container, 'condition', '11'))
      click(interactive, currentOnlyButton(interactive.container))
      mockScrollToCondition.mockClear()

      click(interactive, conditionActionButton(interactive.container, 'condition-add'))
      await settleInteractiveSheet()

      expect(activeLayerKey(interactive.container)).toBe('L1::10::ETCH')
      expect(renderedConditionIds(interactive.container)).toEqual(['11', '12'])
      expect(interactive.container.textContent).toContain('Layer/조건 셀을 클릭해 대상 행을 선택합니다.')
      expect(
        interactive.container.querySelector('[data-testid="condition-refresh-warning"]')?.textContent,
      ).toContain('변경은 저장되었지만 최신 시트를 불러오지 못했습니다')
      expect(interactive.container.textContent).toContain(refreshMessage)
      expect(mockScrollToCondition).not.toHaveBeenCalled()
      expect(addCondition).toHaveBeenCalledTimes(1)

      click(interactive, buttonByText(interactive.container, '다시 불러오기'))
      await settleInteractiveSheet()

      expect(addCondition).toHaveBeenCalledTimes(1)
      expect(getSheet).toHaveBeenCalledTimes(2)
      expect(mockScrollToCondition).toHaveBeenCalledTimes(1)
      expect(mockScrollToCondition).toHaveBeenCalledWith(String(createdId))
      expect(activeLayerKey(interactive.container)).toBe('L1::10::ETCH')
      expect(renderedConditionIds(interactive.container)).toEqual(['11', '12', '44'])
      expect(interactive.container.textContent).toContain('선택: ETCH (10) · C3')
    } finally {
      interactive.cleanup()
    }
  })

  it.each([
    ['next', [11, 12, 13], 12, 13],
    ['previous', [11, 12], 12, 11],
  ] as const)(
    'successful non-POR delete restores focus to the %s row once',
    async (_direction, conditionIds, deletedId, expectedFocusId) => {
      const interactive = renderInteractiveSheet({ firstLayerConditionIds: conditionIds })
      vi.mocked(getSheet).mockResolvedValue({
        ...interactive.sheet,
        rows: interactive.sheet.rows.filter((row) => row.condition_id !== deletedId),
      })

      try {
        await settleInteractiveSheet()
        click(
          interactive,
          gridCallbackButton(interactive.container, 'condition', String(deletedId)),
        )
        mockScrollToCondition.mockClear()

        click(interactive, conditionActionButton(interactive.container, 'condition-delete'))
        await settleInteractiveSheet()

        expect(deleteCondition).toHaveBeenCalledWith(7, deletedId, 'test-lock-token')
        expect(mockScrollToCondition).toHaveBeenCalledTimes(1)
        expect(mockScrollToCondition).toHaveBeenCalledWith(String(expectedFocusId))
        expect(renderedConditionIds(interactive.container)).not.toContain(String(deletedId))
        expect(mockScrollToCondition).toHaveBeenCalledTimes(1)
      } finally {
        interactive.cleanup()
      }
    },
  )

  it('keeps the active row, Layer, and viewport when the server rejects POR deletion', async () => {
    const interactive = renderInteractiveSheet({ firstLayerConditionIds: [11, 12] })
    const message = 'POR 조건 행은 다른 행에 POR을 지정한 후 삭제할 수 있다'
    vi.mocked(deleteCondition).mockRejectedValue(new Error(message))

    try {
      await settleInteractiveSheet()
      click(interactive, gridCallbackButton(interactive.container, 'condition', '11'))
      click(interactive, currentOnlyButton(interactive.container))
      mockScrollToCondition.mockClear()

      click(interactive, conditionActionButton(interactive.container, 'condition-delete'))
      await settleInteractiveSheet()

      expect(activeLayerKey(interactive.container)).toBe('L1::10::ETCH')
      expect(renderedConditionIds(interactive.container)).toEqual(['11', '12'])
      expect(interactive.container.textContent).toContain('선택: ETCH (10) · POR')
      expect(interactive.container.textContent).toContain(message)
      expect(mockScrollToCondition).not.toHaveBeenCalled()
    } finally {
      interactive.cleanup()
    }
  })

  it('blocks Layer activation during paste review without changing state or scrolling', async () => {
    mockSheetWorkbenchState = createMockSheetWorkbenchState('validation')
    const interactive = renderInteractiveSheet()

    try {
      await act(async () => {
        await Promise.resolve()
      })
      click(interactive, gridPasteButton(interactive.container))
      expect(interactive.container.querySelector('[data-testid="paste-staging-panel"]')).not.toBeNull()

      mockScrollToCondition.mockClear()
      click(interactive, layerButton(interactive.container, 'L1::20::CLEAN'))

      expect(activeLayerKey(interactive.container)).toBe('L1::10::ETCH')
      expect(renderedConditionIds(interactive.container)).toEqual(['11', '22', '33'])
      expect(mockScrollToCondition).not.toHaveBeenCalled()
      expect(interactive.container.textContent).toContain(
        '붙여넣기를 적용 또는 취소한 뒤 이동해 주세요.',
      )
    } finally {
      interactive.cleanup()
    }
  })

  it('keeps the workbench toggle outside validation gating', () => {
    expect(sheetViewSource).toContain('const workbenchState = useSheetWorkbenchState()')
    expect(sheetViewSource).toContain('expanded={workbenchState.mode !== null}')
    expect(sheetViewSource).toContain('workbenchState.mode !== null ? (')
    expect(sheetViewSource).not.toContain('workbenchState.visible')
    expect(sheetViewSource).not.toContain('showValidationWorkbench ? (')
  })

  it('keeps rejected raw input out of persistence and saves a later valid correction through autosave', async () => {
    const interactive = renderInteractiveSheet()

    try {
      await settleInteractiveSheet()
      click(interactive, gridDraftButton(interactive.container, 'invalid', '11'))

      expect(useEditStore.getState().invalidDrafts.get(dirtyKey('11', 'ETCH_P001')))
        .toMatchObject({ rawValue: 'not-a-number', code: 'invalid_decimal' })
      expect(useEditStore.getState().dirtyCells.size).toBe(0)
      expect(renderedValues(interactive.container)[0]?.ETCH_P001).toBe('1')
      expect(renderedInvalidDrafts(interactive.container)).toHaveLength(1)
      expect(
        interactive.container.querySelector('[data-validation-statuses]')
          ?.getAttribute('data-validation-statuses'),
      ).not.toContain('not-a-number')
      interactive.window.dispatchEvent(new interactive.window.Event('beforeunload'))
      expect(releaseLockOnUnload).not.toHaveBeenCalled()
      expect(patchCells).not.toHaveBeenCalled()

      click(interactive, gridDraftButton(interactive.container, 'valid', '11'))
      expect(useEditStore.getState().invalidDrafts.size).toBe(0)

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 3_100))
      })

      expect(patchCells).toHaveBeenCalledTimes(1)
      expect(patchCells).toHaveBeenCalledWith(
        7,
        [{ condition_id: 11, parameter_code: 'ETCH_P001', value: '21' }],
        'manual',
        'test-lock-token',
      )
    } finally {
      interactive.cleanup()
    }
  }, 8_000)

  it('passes persistable rows to the Grid while invalid drafts carry rejected display input', async () => {
    mockSheetWorkbenchState = createMockSheetWorkbenchState('validation')
    const interactive = renderInteractiveSheet({ minimumValue: '10' })

    try {
      await settleInteractiveSheet()
      click(interactive, gridDraftButton(interactive.container, 'invalid', '11'))

      expect(renderedValues(interactive.container)[0]?.ETCH_P001).toBe('1')
      expect(renderedInvalidDrafts(interactive.container)).toEqual([
        expect.objectContaining({ rawValue: 'not-a-number' }),
      ])
      const issue = interactive.container.querySelector<HTMLButtonElement>(
        '[data-validation-workbench] button[aria-label]',
      )
      expect(issue?.textContent).toContain('현재 1')
      expect(issue?.getAttribute('aria-label')).toContain('현재 값 1.')
      expect(issue?.textContent).not.toContain('not-a-number')
      expect(issue?.getAttribute('aria-label')).not.toContain('not-a-number')
    } finally {
      interactive.cleanup()
    }
  })

  it('treats paste over an invalid draft as a real correction and clears only persisted coordinates', async () => {
    const interactive = renderInteractiveSheet()

    try {
      await settleInteractiveSheet()
      act(() => {
        useEditStore.getState().setInvalidDraft(testInvalidDraft('99'))
        useEditStore.getState().setInvalidDraft({
          ...testInvalidDraft('kept-on-other-row'),
          conditionId: '22',
        })
      })

      click(interactive, gridPasteButton(interactive.container))
      click(interactive, pasteApplyButton(interactive.container))
      await settleInteractiveSheet()

      expect(patchCells).toHaveBeenCalledWith(
        7,
        [{ condition_id: 11, parameter_code: 'ETCH_P001', value: '99' }],
        'paste',
        'test-lock-token',
      )
      expect(useEditStore.getState().invalidDrafts.has(dirtyKey('11', 'ETCH_P001'))).toBe(false)
      expect(useEditStore.getState().invalidDrafts.get(dirtyKey('22', 'ETCH_P001'))?.rawValue)
        .toBe('kept-on-other-row')
    } finally {
      interactive.cleanup()
    }
  })

  it('preserves invalid drafts when paste persistence fails or the review is cancelled', async () => {
    vi.mocked(patchCells).mockRejectedValueOnce(new Error('paste offline'))
    const interactive = renderInteractiveSheet()

    try {
      await settleInteractiveSheet()
      act(() => useEditStore.getState().setInvalidDraft(testInvalidDraft('99')))

      click(interactive, gridPasteButton(interactive.container))
      click(interactive, pasteApplyButton(interactive.container))
      await settleInteractiveSheet()

      expect(interactive.container.textContent).toContain('paste offline')
      expect(useEditStore.getState().invalidDrafts.get(dirtyKey('11', 'ETCH_P001'))?.rawValue)
        .toBe('99')

      click(interactive, buttonByText(interactive.container, '취소'))
      expect(useEditStore.getState().invalidDrafts.get(dirtyKey('11', 'ETCH_P001'))?.rawValue)
        .toBe('99')
    } finally {
      interactive.cleanup()
    }
  })

  it('preserves drafts across authoritative refreshes and prunes only removed row or column identities', async () => {
    const interactive = renderInteractiveSheet()

    try {
      await settleInteractiveSheet()
      click(interactive, layerButton(interactive.container, 'L1::20::CLEAN'))
      click(interactive, currentOnlyButton(interactive.container))
      click(interactive, gridDraftButton(interactive.container, 'invalid', '22'))

      click(interactive, layerButton(interactive.container, 'L1::10::ETCH'))
      expect(renderedConditionIds(interactive.container)).toEqual(['11'])
      expect(useEditStore.getState().invalidDrafts.has(dirtyKey('22', 'ETCH_P001'))).toBe(true)

      await act(async () => {
        interactive.queryClient.setQueryData(['sheet', 7], {
          ...interactive.sheet,
          rows: interactive.sheet.rows.map((row) =>
            row.condition_id === 22
              ? { ...row, cells: { ...row.cells, ETCH_P001: 'server-refresh' } }
              : row,
          ),
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
      expect(useEditStore.getState().invalidDrafts.has(dirtyKey('22', 'ETCH_P001'))).toBe(true)

      await act(async () => {
        interactive.queryClient.setQueryData(['sheet', 7], {
          ...interactive.sheet,
          rows: interactive.sheet.rows.filter((row) => row.condition_id !== 22),
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
      expect(useEditStore.getState().invalidDrafts.has(dirtyKey('22', 'ETCH_P001'))).toBe(false)

      click(interactive, gridDraftButton(interactive.container, 'invalid', '11'))
      await act(async () => {
        interactive.queryClient.setQueryData(['sheet', 7], {
          ...interactive.sheet,
          columns: [{ ...interactive.sheet.columns[0], parameter_code: 'OTHER' }],
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
      expect(useEditStore.getState().invalidDrafts.has(dirtyKey('11', 'ETCH_P001'))).toBe(false)
    } finally {
      interactive.cleanup()
    }
  })

  it('blocks invalid draft installation and clearing in read-only, lost-lock, and paste-review modes', async () => {
    vi.mocked(acquireLock).mockRejectedValue(lockConflict('other-editor'))
    const readOnly = renderInteractiveSheet()
    try {
      await settleInteractiveSheet()
      click(readOnly, gridDraftButton(readOnly.container, 'invalid', '11'))
      expect(useEditStore.getState().invalidDrafts.size).toBe(0)
      act(() => useEditStore.getState().setInvalidDraft(testInvalidDraft('kept-readonly')))
      click(readOnly, gridDraftButton(readOnly.container, 'clear', '11'))
      expect(useEditStore.getState().invalidDrafts.get(dirtyKey('11', 'ETCH_P001'))?.rawValue)
        .toBe('kept-readonly')
    } finally {
      readOnly.cleanup()
    }

    vi.mocked(acquireLock).mockResolvedValue({
      locked_by: 'test-user',
      lock_token: 'test-lock-token',
      locked_at: '2026-08-14T00:00:00Z',
      expires_at: '2026-08-14T00:01:00Z',
    })
    vi.mocked(heartbeatLock).mockRejectedValue(lockConflict('lock-taker'))
    const lost = renderInteractiveSheet({ heartbeatSeconds: 0.001 })
    try {
      await settleInteractiveSheet()
      expect(lost.container.textContent).toContain('잠금 상실')
      act(() => useEditStore.getState().setInvalidDraft(testInvalidDraft('kept-lost')))
      click(lost, gridDraftButton(lost.container, 'invalid', '11'))
      click(lost, gridDraftButton(lost.container, 'clear', '11'))
      expect(useEditStore.getState().invalidDrafts.get(dirtyKey('11', 'ETCH_P001'))?.rawValue)
        .toBe('kept-lost')
    } finally {
      lost.cleanup()
    }

    vi.mocked(heartbeatLock).mockResolvedValue({
      locked_by: 'test-user',
      lock_token: 'test-lock-token',
      locked_at: '2026-08-14T00:00:00Z',
      expires_at: '2026-08-14T00:01:00Z',
    })
    const pasteReview = renderInteractiveSheet()
    try {
      await settleInteractiveSheet()
      click(pasteReview, gridPasteButton(pasteReview.container))
      act(() => useEditStore.getState().setInvalidDraft(testInvalidDraft('kept-paste')))
      click(pasteReview, gridDraftButton(pasteReview.container, 'invalid', '11'))
      click(pasteReview, gridDraftButton(pasteReview.container, 'clear', '11'))
      expect(useEditStore.getState().invalidDrafts.get(dirtyKey('11', 'ETCH_P001'))?.rawValue)
        .toBe('kept-paste')
    } finally {
      pasteReview.cleanup()
    }
  })

  it('reports invalid and persistable counts separately and explicit discard clears both', async () => {
    const interactive = renderInteractiveSheet()

    try {
      await settleInteractiveSheet()
      click(interactive, gridDraftButton(interactive.container, 'invalid', '11'))
      click(interactive, gridDraftButton(interactive.container, 'valid', '22'))

      expect(interactive.container.textContent).toContain('입력 오류 1')
      expect(interactive.container.textContent).toContain('미저장 1')
      click(interactive, buttonByText(interactive.container, '변경 취소'))
      expect(useEditStore.getState().invalidDrafts.size).toBe(0)
      expect(useEditStore.getState().dirtyCells.size).toBe(0)
      expect(patchCells).not.toHaveBeenCalled()
    } finally {
      interactive.cleanup()
    }
  })

  it('guards invalid-only route changes, preserving cancel and clearing on confirmed unmount', async () => {
    const interactive = renderInteractiveSheet()

    try {
      await settleInteractiveSheet()
      click(interactive, gridDraftButton(interactive.container, 'invalid', '11'))
      const confirm = vi.spyOn(window, 'confirm')
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true)

      click(interactive, detailLink(interactive.container))
      await settleInteractiveSheet()
      expect(confirm).toHaveBeenNthCalledWith(
        1,
        '저장되지 않은 입력이 있습니다. 조건표를 나갈까요?',
      )
      expect(interactive.router.state.location.pathname).toBe('/projects/7/sheet')
      expect(useEditStore.getState().invalidDrafts.size).toBe(1)

      click(interactive, detailLink(interactive.container))
      await settleInteractiveSheet()
      expect(confirm).toHaveBeenCalledTimes(2)
      expect(interactive.router.state.location.pathname).toBe('/projects/7')
      expect(interactive.container.textContent).toContain('project detail')
      expect(useEditStore.getState().invalidDrafts.size).toBe(0)
    } finally {
      interactive.cleanup()
    }
  })

  it('keeps the same project session across heartbeat refreshes but clears on project change', async () => {
    const interactive = renderInteractiveSheet()

    try {
      await settleInteractiveSheet()
      click(interactive, gridDraftButton(interactive.container, 'invalid', '11'))
      expect(acquireLock).toHaveBeenCalledTimes(1)

      await act(async () => {
        interactive.queryClient.setQueryData(['sheet', 7], {
          ...interactive.sheet,
          lock: { ...interactive.sheet.lock, heartbeat_seconds: 30 },
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      expect(useEditStore.getState().invalidDrafts.size).toBe(1)
      expect(acquireLock).toHaveBeenCalledTimes(1)

      await act(async () => {
        await interactive.router.navigate('/projects/8/sheet')
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(useEditStore.getState().invalidDrafts.size).toBe(0)
      expect(interactive.router.state.location.pathname).toBe('/projects/8/sheet')
    } finally {
      interactive.cleanup()
    }
  })
})

function renderInteractiveSheet({
  requiredConditionIds = [],
  firstLayerConditionIds = [11],
  heartbeatSeconds = 45,
  minimumValue = null,
}: {
  requiredConditionIds?: readonly number[]
  firstLayerConditionIds?: readonly number[]
  heartbeatSeconds?: number
  minimumValue?: string | null
} = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://pcm.test/projects/7/sheet',
  })
  const container = dom.window.document.querySelector<HTMLDivElement>('#root')
  if (container === null) throw new Error('Interactive Sheet root is unavailable.')

  const layers = [
    ['L1::10::ETCH', '10', 'ETCH', 0],
    ['L1::20::CLEAN', '20', 'CLEAN', 1],
    ['L1::30::CMP', '30', 'CMP', 2],
  ] as const
  const interactiveProject: ProjectOut = {
    ...project,
    layers: layers.map(([layerKey, stepSeq, layerId, sortOrder], index) => ({
      id: index + 1,
      layer_key: layerKey,
      step_seq: stepSeq,
      layer_id: layerId,
      eqp_type: null,
      eqp_type_desc: null,
      area_name: null,
      sort_order: sortOrder,
      condition_count: index === 0 ? firstLayerConditionIds.length : 1,
      cell_count: requiredConditionIds.includes(11 * (index + 1)) ? 0 : 1,
      source_project_id: null,
      source_layer_key: null,
    })),
  }
  const interactiveSheet: SheetOut = {
    ...sheet,
    lock: { ...sheet.lock, heartbeat_seconds: heartbeatSeconds },
    columns: [{
      ...sheet.columns[0],
      required: requiredConditionIds.length > 0,
      min_value: minimumValue,
    }],
    rows: layers.flatMap((
      [layerKey, stepSeq, layerId, sortOrder],
      layerIndex,
    ): SheetOut['rows'] => {
      const conditionIds = layerIndex === 0 ? firstLayerConditionIds : [11 * (layerIndex + 1)]
      return conditionIds.map((conditionId, conditionIndex): SheetOut['rows'][number] => ({
        ...sheet.rows[0],
        condition_id: conditionId,
        layer_key: layerKey,
        step_seq: stepSeq,
        layer_id: layerId,
        layer_label: `${layerId} (${stepSeq})`,
        condition_label: conditionIndex === 0 ? 'POR' : `C${conditionIndex + 1}`,
        is_por: conditionIndex === 0,
        condition_index: conditionIndex + 1,
        layer_sort_order: sortOrder,
        cells: requiredConditionIds.includes(conditionId)
          ? {}
          : { ETCH_P001: String(layerIndex + 1) },
      }))
    }),
  }
  const queryClient = client()
  queryClient.setQueryData(['project', 7], interactiveProject)
  queryClient.setQueryData(['sheet', 7], interactiveSheet)
  vi.mocked(getProject).mockResolvedValue(interactiveProject)
  vi.mocked(getSheet).mockResolvedValue(interactiveSheet)
  const globals = globalThis as unknown as {
    document?: Document
    HTMLElement?: typeof HTMLElement
    Node?: typeof Node
    window?: Window
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  const previousGlobals = {
    document: globals.document,
    HTMLElement: globals.HTMLElement,
    Node: globals.Node,
    window: globals.window,
    IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT,
  }
  let root: Root | null = null

  globals.window = dom.window as unknown as Window
  globals.document = dom.window.document
  globals.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement
  globals.Node = dom.window.Node as unknown as typeof Node
  globals.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.confirm = vi.fn(() => true)
  const router = createMemoryRouter(
    [
      { path: '/projects/:projectId/sheet', element: <SheetViewPage /> },
      { path: '/projects/:projectId', element: <div>project detail</div> },
    ],
    { initialEntries: ['/projects/7/sheet'] },
  )

  act(() => {
    root = createRoot(container)
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
  })

  return {
    container,
    project: interactiveProject,
    queryClient,
    router,
    sheet: interactiveSheet,
    window: dom.window,
    cleanup: () => {
      act(() => root?.unmount())
      queryClient.clear()
      globals.window = previousGlobals.window
      globals.document = previousGlobals.document
      globals.HTMLElement = previousGlobals.HTMLElement
      globals.Node = previousGlobals.Node
      globals.IS_REACT_ACT_ENVIRONMENT = previousGlobals.IS_REACT_ACT_ENVIRONMENT
      dom.window.close()
    },
  }
}

async function settleInteractiveSheet(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function click(
  interactive: ReturnType<typeof renderInteractiveSheet>,
  element: Element,
): void {
  act(() => {
    element.dispatchEvent(new interactive.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }))
  })
}

function layerButton(container: HTMLElement, layerKey: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[data-layer-row="${layerKey}"]`)
  if (button === null) throw new Error(`Layer button ${layerKey} is unavailable.`)
  return button
}

function currentOnlyButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === '현재만',
  )
  if (button === undefined) throw new Error('Current-only button is unavailable.')
  return button
}

function gridCallbackButton(
  container: HTMLElement,
  callback: 'cell' | 'condition',
  conditionId: string,
): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `[data-grid-${callback}-activate="${conditionId}"]`,
  )
  if (button === null) throw new Error(`${callback} callback for ${conditionId} is unavailable.`)
  return button
}

function gridPasteButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('[data-grid-stage-paste]')
  if (button === null) throw new Error('Grid paste control is unavailable.')
  return button
}

function pasteApplyButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>(
    '[data-testid="paste-staging-panel"] button',
  )].find((candidate) => candidate.textContent?.trim().startsWith('적용'))
  if (button === undefined) throw new Error('Paste apply control is unavailable.')
  return button
}

function gridDraftButton(
  container: HTMLElement,
  action: 'invalid' | 'clear' | 'valid',
  conditionId: string,
): HTMLButtonElement {
  const attribute = action === 'clear' ? 'data-grid-clear-invalid' : `data-grid-${action}`
  const button = container.querySelector<HTMLButtonElement>(`[${attribute}="${conditionId}"]`)
  if (button === null) throw new Error(`${action} draft callback for ${conditionId} is unavailable.`)
  return button
}

function renderedValues(container: HTMLElement): Array<Record<string, string | null>> {
  return JSON.parse(
    container.querySelector('[data-condition-values]')?.getAttribute('data-condition-values') ?? '[]',
  ) as Array<Record<string, string | null>>
}

function renderedInvalidDrafts(container: HTMLElement): unknown[] {
  return JSON.parse(
    container.querySelector('[data-invalid-drafts]')?.getAttribute('data-invalid-drafts') ?? '[]',
  ) as unknown[]
}

function detailLink(container: HTMLElement): HTMLAnchorElement {
  const link = container.querySelector<HTMLAnchorElement>('a[aria-label="프로젝트 상세로 돌아가기"]')
  if (link === null) throw new Error('Project detail link is unavailable.')
  return link
}

function testInvalidDraft(rawValue: string) {
  return {
    conditionId: '11',
    parameterCode: 'ETCH_P001',
    rawValue,
    code: 'invalid_decimal' as const,
    message: '숫자로 입력하세요',
    constraint: null,
  }
}

function lockConflict(lockedBy: string) {
  return {
    isAxiosError: true,
    message: 'lock conflict',
    response: {
      status: 409,
      data: {
        code: 'lock_conflict',
        message: 'lock conflict',
        details: { locked_by: lockedBy },
      },
    },
  }
}

function conditionActionButton(container: HTMLElement, testId: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
  if (button === null) throw new Error(`Condition action ${testId} is unavailable.`)
  return button
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (button === undefined) throw new Error(`Button ${label} is unavailable.`)
  return button
}

function renderedConditionIds(container: HTMLElement): string[] {
  return JSON.parse(
    container.querySelector('[data-condition-ids]')?.getAttribute('data-condition-ids') ?? '[]',
  ) as string[]
}

function activeLayerKey(container: HTMLElement): string | null {
  return container.querySelector('[data-layer-row][aria-selected="true"]')?.getAttribute(
    'data-layer-row',
  ) ?? null
}

function validationIssueLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-validation-workbench] button')]
    .map((button) => button.getAttribute('aria-label'))
    .filter((label): label is string => label !== null)
}
