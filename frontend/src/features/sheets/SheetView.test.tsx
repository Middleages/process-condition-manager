import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { forwardRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Route, Routes, StaticRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { ProjectOut, SheetOut } from '@/api/types'

vi.mock('@/grid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/grid')>()
  return {
    ...actual,
    GlideConditionGrid: forwardRef(function FakeGrid() {
      return <div data-testid="rendered-condition-grid">grid</div>
    }),
  }
})

import { shouldFocusLiveSheetTitle, SheetView, SheetViewPage } from './SheetView'
import sheetViewSource from './SheetView.tsx?raw'

const project: ProjectOut = {
  id: 7,
  line_id: 'L1',
  process_id: 'etch',
  part_id: 'P-7',
  name: 'Etch qualification',
  description: null,
  status: 'draft',
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
      description: null,
      choice_options: [],
      sort_order: 1,
    },
  ],
  rows: [
    {
      condition_id: 11,
      layer_key: 'L1::10::ETCH',
      layer_label: 'ETCH (10)',
      condition_label: 'POR',
      is_por: true,
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
    const editingStatusTag = html.match(
      /<div[^>]*data-sheet-editing-status="true"[^>]*>/,
    )?.[0]
    expect(editingStatusTag).toBeDefined()
    expect(editingStatusTag).toContain('role="status"')
    expect(editingStatusTag).toContain('aria-live="polite"')
    expect(editingStatusTag).toContain('aria-atomic="false"')
    expect(html).toContain('data-sheet-editor="true"')
    expect(html).toContain('data-sheet-editing-status="true"')
    expect(html).toContain('data-testid="rendered-condition-grid"')
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
})
