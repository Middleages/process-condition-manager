import { act, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import {
  CompactSelection,
  GridCellKind,
  type DataEditorProps,
  type DataEditorRef,
  type EditableGridCell,
  type GridSelection,
  type Rectangle,
} from '@glideapps/glide-data-grid'

import type { ConditionGridProps, SheetChoiceResource } from './types'
import { makeChoiceCell } from './choiceCell'
import { makeDecimalCell } from './decimalCell'

const dataEditorHarness = vi.hoisted(() => ({
  props: undefined as DataEditorProps | undefined,
  getBounds: vi.fn<(col?: number, row?: number) => Rectangle | undefined>(
    () => ({ x: 300, y: 120, width: 150, height: 32 }),
  ),
}))

vi.mock('@glideapps/glide-data-grid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@glideapps/glide-data-grid')>()
  return {
    ...actual,
    DataEditor: forwardRef<DataEditorRef, DataEditorProps>(function FakeDataEditor(props, ref) {
      dataEditorHarness.props = props
      useImperativeHandle(ref, () => ({
        appendRow: async () => undefined,
        updateCells: vi.fn(),
        getBounds: dataEditorHarness.getBounds,
        focus: vi.fn(),
        emit: async () => undefined,
        scrollTo: vi.fn(),
        remeasureColumns: vi.fn(),
      }))
      return <div data-testid="data-editor" />
    }),
  }
})

import {
  cellHistoryMenuActionForKey,
  closeCellHistoryMenuState,
  cellStatusMarkerFacts,
  cellStatusTooltip,
  cellStatusVisualPriority,
  currentGridSelectionForLayout,
  gridLayoutAuthority,
  gridSelectionActivation,
  isCellHistoryMenuInvocation,
  porCellBehavior,
  porCellAccessibility,
  requestPorTransfer,
  resolveCellHistoryMenuPosition,
  resolveCellHistoryRequest,
  invalidDraftPopoverPlacement,
} from './GlideConditionGrid'
import { GlideConditionGrid } from './GlideConditionGrid'
import source from './GlideConditionGrid.tsx?raw'

describe('composite cell status rendering priority', () => {
  it('describes POR as a Layer-scoped single-selection state for Glide accessibility', () => {
    expect(porCellAccessibility('L1', 'POR', true)).toBe(
      'Layer L1, 조건 POR, POR 선택됨, 단일 선택',
    )
    expect(porCellAccessibility('L1', 'C2', false)).toBe(
      'Layer L1, 조건 C2, POR 선택 안 됨, 단일 선택',
    )
  })

  it('keeps a single-row POR selected and non-actionable', () => {
    const onPorChange = vi.fn()
    expect(porCellBehavior(true, 1)).toEqual({ mark: '●', canTransfer: false })
    requestPorTransfer({ id: '11', layerKey: 'L1', isPor: true }, 1, onPorChange)
    requestPorTransfer({ id: '11', layerKey: 'L1', isPor: false }, 1, onPorChange)
    expect(onPorChange).not.toHaveBeenCalled()
    expect(source).toMatch(
      /const behavior = porCellBehavior\([\s\S]*?data: porCellAccessibility\([\s\S]*?displayData: behavior\.mark/,
    )
  })

  it('calls onPorChange for a non-POR click in a multi-row Layer', () => {
    const onPorChange = vi.fn()
    expect(porCellBehavior(false, 2)).toEqual({ mark: '○', canTransfer: true })
    requestPorTransfer({ id: '11', layerKey: 'L1', isPor: true }, 2, onPorChange)
    requestPorTransfer({ id: '12', layerKey: 'L1', isPor: false }, 2, onPorChange)
    expect(onPorChange).toHaveBeenCalledTimes(1)
    expect(onPorChange).toHaveBeenCalledWith('L1', '12')
  })

  it('freezes four identity columns, uses POR column 3, and includes optional units in parameter headers', () => {
    const handleCellClicked = source.match(
      /const handleCellClicked = useCallback\([\s\S]*?(?=\n  useImperativeHandle)/,
    )?.[0]
    const parameterHeaders = [
      { headerName: 'ZONE TEMP.', unit: '°C' },
      { headerName: 'PRESSURE', unit: null },
    ].map((column) => column.unit ? `${column.headerName} · ${column.unit}` : column.headerName)

    expect(parameterHeaders).toEqual(['ZONE TEMP. · °C', 'PRESSURE'])
    expect(source).toContain('freezeColumns={IDENTITY_COLUMN_COUNT}')
    expect(handleCellClicked).toMatch(/if \(col === 3\)[\s\S]*?callbacks\?\.onPorChange/)
    expect(source).toContain("title: column.unit ? `${column.headerName} · ${column.unit}` : column.headerName")
    expect(source).toContain('groupMeta.isGroupStart[row] ? rowData.stepSeq :')
    expect(source).toContain('groupMeta.isGroupStart[row] ? rowData.layerId :')
  })

  it('renders validation error above warning, dirty, and comment without requiring exclusive state', () => {
    expect(
      cellStatusVisualPriority({
        conditionId: '1',
        parameterCode: 'amount',
        validation: { severity: 'error', count: 2, message: 'invalid' },
        dirty: true,
        commentCount: 3,
      }),
    ).toBe('error')
    expect(
      cellStatusVisualPriority({
        conditionId: '1',
        parameterCode: 'amount',
        validation: { severity: 'warning', count: 1, message: 'review' },
        dirty: true,
        commentCount: 3,
      }),
    ).toBe('warning')
  })

  it('renders dirty above comment and preserves comment-only fallback', () => {
    expect(
      cellStatusVisualPriority({
        conditionId: '1',
        parameterCode: 'amount',
        dirty: true,
        commentCount: 1,
      }),
    ).toBe('dirty')
    expect(
      cellStatusVisualPriority({
        conditionId: '1',
        parameterCode: 'amount',
        dirty: false,
        commentCount: 1,
      }),
    ).toBe('comment')
  })

  it('keeps dirty and comment markers independently perceivable under validation', () => {
    const status = {
      conditionId: '1',
      parameterCode: 'amount',
      validation: { severity: 'error' as const, count: 2, message: '입력 값을 확인해 주세요.' },
      dirty: true,
      commentCount: 3,
    }

    expect(cellStatusMarkerFacts(status)).toEqual({ dirty: true, comment: true })
    expect(cellStatusTooltip(status)).toBe(
      '오류 2건 · 입력 값을 확인해 주세요. · 저장되지 않은 변경 · 댓글 3개',
    )
  })

  it('makes scrollToCell scroll, select, and focus through Glide only inside the adapter', () => {
    const command = source.match(
      /scrollToCell\(conditionId, parameterCode\)[\s\S]*?(?=\n      scrollToColumn)/,
    )?.[0]
    expect(command).toMatch(/scrollTo\([\s\S]*?setSelectionState\(/)
    expect(command).not.toContain('gridRef.current?.focus()')
    expect(source).toMatch(
      /requestedFocusRef\.current = null\s+gridRef\.current\?\.focus\(\)/,
    )
    expect(source).toContain('gridSelection={effectiveGridSelection}')
    expect(source).toContain('onGridSelectionChange={handleGridSelectionChange}')
  })

  it('makes scrollToCondition scroll vertically, select Step Seq, and request Grid focus', () => {
    const command = source.match(
      /scrollToCondition\(conditionId\)[\s\S]*?(?=\n      scrollToCell)/,
    )?.[0]

    expect(command).toMatch(/conditionRowScrollTarget\(conditionId, rows\)/)
    expect(command).toMatch(/scrollTo\(target\.col, target\.row, 'vertical'/)
    expect(command).toContain('requestedFocusRef.current = [target.col, target.row]')
    expect(command).toContain(
      'selection: selectionForCell(target.col, target.row)',
    )
    expect(command).not.toContain('gridRef.current?.focus()')
  })

  it('invalidates controlled selection when visible keys or row identity/order changes', () => {
    const columns = [{ key: 'amount' }, { key: 'equipment' }]
    const rows = [{ id: '11' }, { id: '12' }]
    const original = gridLayoutAuthority(columns, rows)

    expect(gridLayoutAuthority(columns, [{ id: '11' }, { id: '12' }])).toBe(original)
    expect(gridLayoutAuthority([{ key: 'equipment' }], rows)).not.toBe(original)
    expect(gridLayoutAuthority(columns, [...rows].reverse())).not.toBe(original)
    expect(
      currentGridSelectionForLayout(
        { layoutAuthority: original, selection: 'stale coordinate' },
        gridLayoutAuthority([{ key: 'equipment' }], rows),
        'empty selection',
      ),
    ).toBe('empty selection')
  })

  it('preserves selection across value-only row changes with stable row ids and visible keys', () => {
    const columns = [{ key: 'amount' }]
    const before = [{ id: '11', values: { amount: '7' } }]
    const dirty = [{ id: '11', values: { amount: '8' } }]
    const authority = gridLayoutAuthority(columns, before)

    expect(gridLayoutAuthority(columns, dirty)).toBe(authority)
    expect(
      currentGridSelectionForLayout(
        { layoutAuthority: authority, selection: 'selected cell' },
        authority,
        'empty selection',
      ),
    ).toBe('selected cell')
  })

  it.each([0, 1, 2, 3])(
    'activates the row Layer when keyboard selection lands on fixed column %i',
    (column) => {
      expect(gridSelectionActivation(column, 0, [], [{
        id: 'condition-11',
        layerKey: 'layer-1',
        stepSeq: '010',
        layerId: 'L1',
        layerLabel: 'Layer 1',
        conditionLabel: 'POR',
        isPor: true,
        values: {},
      }])).toEqual({
        condition: { conditionId: 'condition-11', layerKey: 'layer-1' },
        cell: null,
      })
    },
  )

  it('publishes one parameter activation without also treating it as a fixed-column row activation', () => {
    expect(gridSelectionActivation(4, 0, [{ key: 'amount' }], [{
      id: 'condition-11',
      layerKey: 'layer-1',
      stepSeq: '010',
      layerId: 'L1',
      layerLabel: 'Layer 1',
      conditionLabel: 'POR',
      isPor: true,
      values: { amount: '7' },
    }])).toEqual({
      condition: null,
      cell: { conditionId: 'condition-11', parameterCode: 'amount', layerKey: 'layer-1' },
    })
  })

  it('publishes navigation selection against the current layout authority after a category commit', () => {
    expect(source).toContain('layoutAuthority, selection: selectionForCell(target.col, target.row)')
    expect(source).toMatch(
      /selectionState\.layoutAuthority !== layoutAuthority[\s\S]*?setSelectionState\(\{[\s\S]*?layoutAuthority,[\s\S]*?selection: EMPTY_GRID_SELECTION/,
    )
  })
})

describe('cell-history context action boundary', () => {
  const columns = [
    {
      key: 'amount',
      headerName: 'Amount',
      valueType: 'number' as const,
      categoryCode: null,
      choiceSetCode: null,
      choiceSetVersion: null, required: false, minValue: null, maxValue: null,
    },
  ]
  const rows = [
    {
      id: 'condition-11',
      layerKey: 'layer-1',
      stepSeq: '010',
      layerId: 'Layer 1',
      layerLabel: 'Layer 1',
      conditionLabel: 'Condition 11',
      isPor: true,
      values: { amount: '7' },
    },
  ]

  it('resolves only parameter cells to a domain coordinate', () => {
    expect(resolveCellHistoryRequest([4, 0], columns, rows)).toEqual({
      conditionId: 'condition-11',
      layerKey: 'layer-1',
      parameterCode: 'amount',
    })
    expect(resolveCellHistoryRequest([0, 0], columns, rows)).toBeNull()
    expect(resolveCellHistoryRequest([1, 0], columns, rows)).toBeNull()
    expect(resolveCellHistoryRequest([2, 0], columns, rows)).toBeNull()
    expect(resolveCellHistoryRequest([3, 0], columns, rows)).toBeNull()
    expect(resolveCellHistoryRequest([4, 1], columns, rows)).toBeNull()
  })

  it('recognizes both accessible context-menu keyboard conventions', () => {
    expect(isCellHistoryMenuInvocation('F10', true)).toBe(true)
    expect(isCellHistoryMenuInvocation('ContextMenu', false)).toBe(true)
    expect(isCellHistoryMenuInvocation('Menu', false)).toBe(true)
    expect(isCellHistoryMenuInvocation('F10', false)).toBe(false)
    expect(isCellHistoryMenuInvocation('Enter', false)).toBe(false)
  })

  it('clamps the fixed menu horizontally and flips above a bottom-edge anchor', () => {
    expect(
      resolveCellHistoryMenuPosition(
        { x: 980, y: 730, height: 30 },
        { width: 1024, height: 768 },
      ),
    ).toEqual({ x: 864, y: 682 })
    expect(
      resolveCellHistoryMenuPosition(
        { x: -20, y: 120, height: 28 },
        { width: 1024, height: 768 },
      ),
    ).toEqual({ x: 8, y: 148 })
  })

  it('clamps vertically when neither the below nor above placement fits', () => {
    expect(
      resolveCellHistoryMenuPosition(
        { x: 20, y: 20, height: 30 },
        { width: 320, height: 60 },
      ),
    ).toEqual({ x: 20, y: 8 })
  })

  it('maps Enter to activation and Escape to one idempotent focus-restoring close', () => {
    expect(cellHistoryMenuActionForKey('Enter')).toBe('activate')
    expect(cellHistoryMenuActionForKey('Escape')).toBe('close')
    expect(cellHistoryMenuActionForKey('ArrowDown')).toBeNull()

    const open = {
      target: {
        conditionId: 'condition-11',
        layerKey: 'layer-1',
        parameterCode: 'amount',
      },
      x: 10,
      y: 20,
    }
    const firstClose = closeCellHistoryMenuState(open)
    expect(firstClose).toEqual({ next: null, restoreFocus: true })
    expect(closeCellHistoryMenuState(firstClose.next)).toEqual({
      next: null,
      restoreFocus: false,
    })
  })

  it('keeps Glide events and pixel positions local while wiring mouse and keyboard access', () => {
    expect(source).toContain('onCellContextMenu={handleCellContextMenu}')
    expect(source).toContain('onKeyDown={handleGridKeyDown}')
    expect(source).toContain("role=\"menu\"")
    expect(source).toContain("role=\"menuitem\"")
    expect(source).toContain('변경 이력 보기')
    expect(source).toMatch(
      /handleCellContextMenu[\s\S]*?resolveCellHistoryRequest[\s\S]*?event\.preventDefault\(\)/,
    )
    expect(source).toContain('callbacks?.onCellHistoryRequest?.(cellHistoryMenu.target)')
    expect(source).toContain("document.addEventListener('pointerdown', handleOutsidePointerDown)")
    expect(source).toContain('closeCellHistoryMenu()')
    const openMenu = source.slice(
      source.indexOf('const openCellHistoryMenu = useCallback('),
      source.indexOf('const layoutAuthority = useMemo('),
    )
    expect(openMenu.match(/resolveCellHistoryMenuPosition/g)).toHaveLength(1)
    expect(source).toMatch(
      /handleCellContextMenu[\s\S]*?openCellHistoryMenu\(target, event\.bounds\)/,
    )
    expect(source).toMatch(
      /handleGridKeyDown[\s\S]*?openCellHistoryMenu\(target, event\.bounds\)/,
    )
  })
})

describe('invalid draft Glide boundary', () => {
  it('publishes an invalid draft and never publishes persistence for a rejected edit', () => {
    const onCellInvalid = vi.fn()
    const onCellEdit = vi.fn()
    const grid = renderGrid({
      data: gridData(),
      callbacks: { onCellInvalid, onCellEdit },
    })
    try {
      dataEditorProps().onCellEdited?.([4, 0], textCell('abc'))

      expect(onCellInvalid).toHaveBeenCalledWith(expect.objectContaining({
        conditionId: '1',
        parameterCode: 'pressure',
        rawValue: 'abc',
        code: 'invalid_decimal',
        message: '숫자로 입력하세요',
        constraint: null,
      }))
      expect(onCellEdit).not.toHaveBeenCalled()
    } finally {
      grid.cleanup()
    }
  })

  it('clears one invalid draft before publishing one valid correction', () => {
    const calls: string[] = []
    const onInvalidDraftClear = vi.fn(() => calls.push('clear'))
    const onCellEdit = vi.fn(() => calls.push('edit'))
    const grid = renderGrid({
      data: gridData(),
      callbacks: { onInvalidDraftClear, onCellEdit },
    })
    try {
      dataEditorProps().onCellEdited?.([4, 0], textCell('120'))

      expect(onInvalidDraftClear).toHaveBeenCalledWith('1', 'pressure')
      expect(onCellEdit).toHaveBeenCalledTimes(1)
      expect(onCellEdit).toHaveBeenCalledWith({
        conditionId: '1',
        parameterCode: 'pressure',
        value: '120',
      })
      expect(calls).toEqual(['clear', 'edit'])
    } finally {
      grid.cleanup()
    }
  })

  it('clears a retained draft without persistence when correction equals the underlying value', () => {
    const onInvalidDraftClear = vi.fn()
    const onCellEdit = vi.fn()
    const grid = renderGrid({
      data: gridData({ invalid: true }),
      callbacks: { onInvalidDraftClear, onCellEdit },
    })
    try {
      dataEditorProps().onCellEdited?.([4, 0], makeDecimalCell('100', 'kPa', false))

      expect(onInvalidDraftClear).toHaveBeenCalledWith('1', 'pressure')
      expect(onCellEdit).not.toHaveBeenCalled()
    } finally {
      grid.cleanup()
    }
  })

  it('validates a retained exact raw number against refreshed constraints', () => {
    const onInvalidDraftClear = vi.fn()
    const onCellEdit = vi.fn()
    const draft = invalidDraft('pressure', '00501.0', 'number_out_of_range', '허용 범위를 벗어났습니다')
    const initial = gridData({ invalidDrafts: [draft] })
    const grid = renderGrid({
      data: initial,
      callbacks: { onInvalidDraftClear, onCellEdit },
    })
    try {
      grid.rerender({
        data: {
          ...initial,
          columns: initial.columns.map((column) =>
            column.key === 'pressure' ? { ...column, maxValue: '600' } : column,
          ),
        },
        callbacks: { onInvalidDraftClear, onCellEdit },
      })
      dataEditorProps().onCellEdited?.([4, 0], makeDecimalCell('00501.0', 'kPa', false))

      expect(onInvalidDraftClear).toHaveBeenCalledWith('1', 'pressure')
      expect(onCellEdit).toHaveBeenCalledWith({
        conditionId: '1',
        parameterCode: 'pressure',
        value: '501',
      })
    } finally {
      grid.cleanup()
    }
  })

  it.each([
    {
      label: 'Text required whitespace',
      item: [6, 0] as const,
      cell: textCell('   '),
      rawValue: '   ',
      code: 'required_value',
    },
    {
      label: 'Choice unknown whitespace',
      item: [5, 0] as const,
      cell: makeChoiceCell('  BOGUS  ', availableChoiceResource(), false),
      rawValue: '  BOGUS  ',
      code: 'choice_unknown',
    },
  ])('retains the exact rejected raw string for $label', ({ item, cell, rawValue, code }) => {
    const onCellInvalid = vi.fn()
    const data = gridData({ choiceResource: availableChoiceResource() })
    const grid = renderGrid({ data, callbacks: { onCellInvalid } })
    try {
      dataEditorProps().onCellEdited?.(item, cell)
      expect(onCellInvalid).toHaveBeenCalledWith(expect.objectContaining({ rawValue, code }))
    } finally {
      grid.cleanup()
    }
  })

  it('does not publish invalid or persistence callbacks when a Choice resource is unavailable', () => {
    const onCellInvalid = vi.fn()
    const onCellEdit = vi.fn()
    const grid = renderGrid({
      data: gridData(),
      callbacks: { onCellInvalid, onCellEdit },
    })
    try {
      dataEditorProps().onCellEdited?.([5, 0], textCell('AUTO'))
      expect(onCellInvalid).not.toHaveBeenCalled()
      expect(onCellEdit).not.toHaveBeenCalled()
    } finally {
      grid.cleanup()
    }
  })

  it('does not expose the Glide edit callback in read-only mode', () => {
    const grid = renderGrid({ data: gridData(), view: { readOnly: true } })
    try {
      expect(dataEditorProps().onCellEdited).toBeUndefined()
    } finally {
      grid.cleanup()
    }
  })

  it('uses invalid raw input for display/copy and exposes the full accessible coordinate and state', () => {
    const grid = renderGrid({ data: gridData({ invalid: true }) })
    try {
      const cell = dataEditorProps().getCellContent([4, 0])
      expect(cell).toMatchObject({
        kind: GridCellKind.Text,
        displayData: 'abc',
        copyData: 'abc',
      })
      const accessible = cell.kind === GridCellKind.Text ? cell.data : ''
      expect(accessible).toContain('Layer: Layer 1')
      expect(accessible).toContain('조건 Condition 1')
      expect(accessible).toContain('파라미터 Pressure')
      expect(accessible).toContain('입력값 "abc"')
      expect(accessible).toContain('오류 숫자로 입력하세요')
      expect(accessible).toContain('저장되지 않음')
    } finally {
      grid.cleanup()
    }
  })

  it('describes an empty raw draft explicitly for accessibility', () => {
    const grid = renderGrid({
      data: gridData({
        invalidDrafts: [invalidDraft('pressure', '', 'required_value', '필수값을 입력하세요')],
      }),
    })
    try {
      const cell = dataEditorProps().getCellContent([4, 0])
      expect(cell.kind === GridCellKind.Text ? cell.data : '').toContain('입력값 비어 있음')
    } finally {
      grid.cleanup()
    }
  })

  it('keeps the Decimal editor for an invalid number cell', () => {
    const grid = renderGrid({ data: gridData({ invalid: true }) })
    let editor: ReturnType<typeof renderProvidedEditor> | null = null
    try {
      editor = renderProvidedEditor(grid, dataEditorProps().getCellContent([4, 0]))
      const input = editor.container.querySelector<HTMLInputElement>('input')
      expect(input?.inputMode).toBe('decimal')
      expect(input?.value).toBe('abc')
    } finally {
      editor?.cleanup()
      grid.cleanup()
    }
  })

  it('preserves single-click activation only for an editable invalid Choice cell', () => {
    const resource = availableChoiceResource()
    const data = gridData({
      choiceResource: resource,
      invalidDrafts: [
        invalidDraft('pressure', 'abc', 'invalid_decimal', '숫자로 입력하세요'),
        invalidDraft('mode', 'BOGUS', 'choice_unknown', '현재 선택지에 없는 코드입니다.'),
        invalidDraft('note', 'raw note', 'required_value', '필수값을 입력하세요'),
      ],
    })
    const grid = renderGrid({ data })
    try {
      expect(dataEditorProps().getCellContent([4, 0]).activationBehaviorOverride).toBeUndefined()
      expect(dataEditorProps().getCellContent([5, 0]).activationBehaviorOverride).toBe(
        'single-click',
      )
      expect(dataEditorProps().getCellContent([6, 0]).activationBehaviorOverride).toBeUndefined()

      grid.rerender({ data, view: { readOnly: true } })
      expect(dataEditorProps().getCellContent([5, 0]).activationBehaviorOverride).toBeUndefined()
    } finally {
      grid.cleanup()
    }
  })

  it('keeps a required Choice draft in SearchableChoice and repairs it through the picker path', () => {
    const resource = availableChoiceResource()
    const onCellInvalid = vi.fn()
    const onInvalidDraftClear = vi.fn()
    const onCellEdit = vi.fn()
    const data = gridData({ choiceResource: resource, choiceRequired: true, choiceValue: 'AUTO' })
    const grid = renderGrid({
      data,
      callbacks: { onCellInvalid, onInvalidDraftClear, onCellEdit },
    })
    let editor: ReturnType<typeof renderProvidedEditor> | null = null
    try {
      dataEditorProps().onCellEdited?.([5, 0], makeChoiceCell('', resource, false))
      const retained = onCellInvalid.mock.calls[0]?.[0]
      expect(retained).toMatchObject({ rawValue: '', code: 'required_value' })

      grid.rerender({
        data: { ...data, invalidDrafts: [retained] },
        callbacks: { onCellInvalid, onInvalidDraftClear, onCellEdit },
      })
      editor = renderProvidedEditor(grid, dataEditorProps().getCellContent([5, 0]))
      expect(editor.container.querySelector('[role="combobox"]')).not.toBeNull()

      dataEditorProps().onCellEdited?.([5, 0], makeChoiceCell('MANUAL', resource, false))
      expect(onInvalidDraftClear).toHaveBeenCalledWith('1', 'mode')
      expect(onCellEdit).toHaveBeenCalledWith({
        conditionId: '1',
        parameterCode: 'mode',
        value: 'MANUAL',
      })
    } finally {
      editor?.cleanup()
      grid.cleanup()
    }
  })

  it('keeps Choice loading behavior and blocks callbacks when a retained draft resource is unavailable', () => {
    const prepareToOpen = vi.fn(() => new Promise<void>(() => undefined))
    const resource = {
      ...unavailableChoiceResource(),
      loading: false,
      error: '목록 연결 실패',
      prepareToOpen,
    }
    const onCellInvalid = vi.fn()
    const onCellEdit = vi.fn()
    const data = gridData({
      choiceResource: resource,
      invalidDrafts: [invalidDraft('mode', 'BOGUS', 'choice_unknown', '현재 선택지에 없는 코드입니다.')],
    })
    const grid = renderGrid({ data, callbacks: { onCellInvalid, onCellEdit } })
    let editor: ReturnType<typeof renderProvidedEditor> | null = null
    try {
      editor = renderProvidedEditor(grid, dataEditorProps().getCellContent([5, 0]))
      expect(editor.container.querySelector('[role="combobox"]')).not.toBeNull()
      expect(editor.container.textContent).toContain('목록 연결 실패')
      const retry = [...editor.container.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === '다시 시도')
      expect(retry).toBeDefined()
      act(() => retry?.dispatchEvent(new grid.container.ownerDocument.defaultView!.MouseEvent(
        'click',
        { bubbles: true },
      )))
      expect(prepareToOpen).toHaveBeenCalledTimes(2)

      dataEditorProps().onCellEdited?.([5, 0], makeChoiceCell('AUTO', resource, false))
      expect(onCellInvalid).not.toHaveBeenCalled()
      expect(onCellEdit).not.toHaveBeenCalled()
    } finally {
      editor?.cleanup()
      grid.cleanup()
    }
  })

  it('uses printable-key initialValue as invalid Decimal edit authority through Enter', () => {
    const grid = renderGrid({ data: gridData({ invalid: true }) })
    let editorRoot: Root | null = null
    try {
      const cell = dataEditorProps().getCellContent([4, 0])
      const provided = dataEditorProps().provideEditor?.(cell)
      expect(provided).toBeDefined()
      expect(typeof provided).toBe('object')
      if (provided === undefined || typeof provided !== 'object') return

      const editorHost = grid.container.ownerDocument.createElement('div')
      grid.container.ownerDocument.body.append(editorHost)
      installLegacyInputFocusStubs(grid.container.ownerDocument)
      const Editor = provided.editor
      const onChange = vi.fn()
      const onFinishedEditing = vi.fn()
      editorRoot = createRoot(editorHost)
      act(() => {
        editorRoot?.render(
          <Editor
            forceEditMode
            initialValue="9"
            isHighlighted={false}
            onChange={onChange}
            onFinishedEditing={onFinishedEditing}
            target={{ x: 300, y: 120, width: 150, height: 32 }}
            theme={{} as never}
            value={cell as EditableGridCell}
          />,
        )
      })

      const input = editorHost.querySelector<HTMLInputElement>('input')
      expect(input?.value).toBe('9')
      expect(input?.inputMode).toBe('decimal')
      expect(grid.container.ownerDocument.activeElement).toBe(input)
      expect(onChange).not.toHaveBeenCalled()

      act(() => {
        setInputValue(input, '99')
        if (input !== null) Simulate.change(input)
      })
      expect(input?.value).toBe('99')
      expect(onChange).not.toHaveBeenCalled()

      act(() => {
        input?.dispatchEvent(new grid.container.ownerDocument.defaultView!.KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
        }))
      })
      expect(onFinishedEditing).toHaveBeenCalledWith(expect.objectContaining({
        copyData: '99',
        data: expect.objectContaining({ kind: 'decimal-cell', value: '99' }),
      }))
    } finally {
      act(() => editorRoot?.unmount())
      grid.cleanup()
    }
  })

  it('keeps the raw Text editor and cancels Escape without clearing its retained draft', () => {
    const grid = renderGrid({
      data: gridData({
        invalidDrafts: [invalidDraft('note', '  raw note  ', 'required_value', '필수값을 입력하세요')],
      }),
    })
    let editorRoot: Root | null = null
    try {
      const cell = dataEditorProps().getCellContent([6, 0])
      const provided = dataEditorProps().provideEditor?.(cell)
      expect(provided).toBeDefined()
      expect(typeof provided).toBe('object')
      if (provided === undefined || typeof provided !== 'object') return

      const editorHost = grid.container.ownerDocument.createElement('div')
      grid.container.ownerDocument.body.append(editorHost)
      installLegacyInputFocusStubs(grid.container.ownerDocument)
      const Editor = provided.editor
      const onFinishedEditing = vi.fn()
      editorRoot = createRoot(editorHost)
      act(() => {
        editorRoot?.render(
          <Editor
            forceEditMode
            isHighlighted={false}
            onChange={vi.fn()}
            onFinishedEditing={onFinishedEditing}
            target={{ x: 300, y: 120, width: 150, height: 32 }}
            theme={{} as never}
            value={cell as EditableGridCell}
          />,
        )
      })

      const input = editorHost.querySelector<HTMLInputElement>('input')
      expect(input?.value).toBe('  raw note  ')
      expect(input?.inputMode).toBe('')
      expect(grid.container.ownerDocument.activeElement).toBe(input)
      act(() => {
        input?.dispatchEvent(new grid.container.ownerDocument.defaultView!.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }))
      })
      expect(onFinishedEditing).toHaveBeenCalledTimes(1)
      expect(onFinishedEditing).toHaveBeenCalledWith(undefined)
    } finally {
      act(() => editorRoot?.unmount())
      grid.cleanup()
    }
  })

  it('draws an inset invalid boundary and non-color marker without changing row geometry', () => {
    const grid = renderGrid({ data: gridData({ invalid: true }) })
    try {
      const strokeRect = vi.fn()
      const fillText = vi.fn()
      const drawContent = vi.fn()
      dataEditorProps().drawCell?.({
        col: 4,
        row: 0,
        cell: dataEditorProps().getCellContent([4, 0]),
        ctx: {
          save: vi.fn(),
          restore: vi.fn(),
          strokeRect,
          fillText,
        },
        rect: { x: 10, y: 20, width: 150, height: 32 },
      } as never, drawContent)

      expect(drawContent).toHaveBeenCalledTimes(1)
      expect(strokeRect).toHaveBeenCalledWith(12, 22, 146, 28)
      expect(fillText).toHaveBeenCalledWith('!', 17, 36)
      expect(dataEditorProps().rowHeight).toBe(32)
    } finally {
      grid.cleanup()
    }
  })

  it('keeps paste staging as the complete visual-surface priority', () => {
    const grid = renderGrid({
      data: gridData({ invalid: true }),
      pasteStaging: [{
        conditionId: '1',
        parameterCode: 'pressure',
        value: '130',
        valid: true,
      }],
    })
    try {
      const strokeRect = vi.fn()
      dataEditorProps().drawCell?.({
        col: 4,
        row: 0,
        cell: dataEditorProps().getCellContent([4, 0]),
        ctx: { save: vi.fn(), restore: vi.fn(), strokeRect, fillText: vi.fn() },
        rect: { x: 10, y: 20, width: 150, height: 32 },
      } as never, vi.fn())
      expect(dataEditorProps().getCellContent([4, 0]).copyData).toBe('130')
      expect(strokeRect).not.toHaveBeenCalled()
    } finally {
      grid.cleanup()
    }
  })

  it('shows one selected invalid alert without clearing the retained draft', () => {
    const onInvalidDraftClear = vi.fn()
    const grid = renderGrid({
      data: gridData({ invalid: true }),
      callbacks: { onInvalidDraftClear },
    })
    try {
      act(() => dataEditorProps().onGridSelectionChange?.(selection([4, 0])))
      const alert = grid.container.querySelector('[role="alert"]')
      expect(alert?.textContent).toContain('숫자로 입력하세요')
      expect(alert?.textContent).toContain('입력값은 저장되지 않았습니다')
      expect(alert?.textContent).toContain('값을 수정하면 저장됩니다')
      expect(grid.container.querySelectorAll('[role="alert"]')).toHaveLength(1)
      expect(dataEditorHarness.getBounds).toHaveBeenLastCalledWith(4, 0)

      act(() => dataEditorProps().onGridSelectionChange?.(selection([0, 0])))
      expect(grid.container.querySelector('[role="alert"]')).toBeNull()
      expect(onInvalidDraftClear).not.toHaveBeenCalled()

      act(() => dataEditorProps().onGridSelectionChange?.(selection([4, 0])))
      expect(grid.container.querySelectorAll('[role="alert"]')).toHaveLength(1)
      expect(onInvalidDraftClear).not.toHaveBeenCalled()
    } finally {
      grid.cleanup()
    }
  })

  it('keeps a fixed separation gap below and above the active cell', () => {
    const upperCell = { x: 300, y: 120, width: 120, height: 32 }
    const below = invalidDraftPopoverPlacement(
      upperCell,
      { width: 1024, height: 768 },
      { width: 280, height: 104 },
    )
    expect(below).toMatchObject({ placement: 'below', y: 160 })
    expect(below.y - (upperCell.y + upperCell.height)).toBe(8)

    const lowerCell = { x: 300, y: 700, width: 120, height: 32 }
    const above = invalidDraftPopoverPlacement(
      lowerCell,
      { width: 1024, height: 768 },
      { width: 280, height: 104 },
    )
    expect(above).toMatchObject({ placement: 'above', y: 588 })
    expect(lowerCell.y - (above.y + 104)).toBe(8)
  })

  it('refreshes invalid popover only after Glide commits the next-frame scroll layout', () => {
    const grid = renderGrid({ data: gridData({ invalid: true }) })
    const scheduledFrames: FrameRequestCallback[] = []
    const window = grid.container.ownerDocument.defaultView!
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        scheduledFrames.push(callback)
        return scheduledFrames.length
      }),
    })
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: vi.fn(),
    })
    try {
      act(() => dataEditorProps().onGridSelectionChange?.(selection([4, 0])))
      const callsBeforeVisibleChange = dataEditorHarness.getBounds.mock.calls.length
      dataEditorHarness.getBounds.mockReturnValue({ x: 300, y: 700, width: 150, height: 32 })

      act(() => dataEditorProps().onVisibleRegionChanged?.(
        { x: 0, y: 0, width: 8, height: 10 },
        0,
        0,
        { selected: [4, 0] },
      ))
      expect(dataEditorHarness.getBounds).toHaveBeenCalledTimes(callsBeforeVisibleChange)

      expect(scheduledFrames).toHaveLength(1)
      act(() => scheduledFrames.shift()?.(16))
      expect(dataEditorHarness.getBounds).toHaveBeenCalledTimes(callsBeforeVisibleChange)

      dataEditorHarness.getBounds.mockReturnValue({ x: 460, y: 420, width: 150, height: 32 })
      expect(scheduledFrames).toHaveLength(1)
      act(() => scheduledFrames.shift()?.(32))

      const alert = grid.container.querySelector<HTMLElement>('[role="alert"]')
      expect(dataEditorHarness.getBounds).toHaveBeenLastCalledWith(4, 0)
      expect(alert?.dataset.anchorY).toBe('420')
      expect(alert?.style.left).toBe('460px')
      expect(alert?.style.top).toBe('460px')
    } finally {
      grid.cleanup()
    }
  })
})

function installLegacyInputFocusStubs(document: Document): void {
  const elementPrototype = document.defaultView?.HTMLElement.prototype
  if (elementPrototype === undefined) return
  Object.defineProperties(elementPrototype, {
    attachEvent: { configurable: true, value: vi.fn() },
    detachEvent: { configurable: true, value: vi.fn() },
  })
}

function setInputValue(input: HTMLInputElement | null, value: string): void {
  if (input === null) return
  const setter = Object.getOwnPropertyDescriptor(input.ownerDocument.defaultView!.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
}

function dataEditorProps(): DataEditorProps {
  if (dataEditorHarness.props === undefined) throw new Error('DataEditor props were not captured.')
  return dataEditorHarness.props
}

function selection(cell: readonly [number, number]): GridSelection {
  return {
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
    current: {
      cell,
      range: { x: cell[0], y: cell[1], width: 1, height: 1 },
      rangeStack: [],
    },
  }
}

function textCell(value: string): EditableGridCell {
  return {
    kind: GridCellKind.Text,
    allowOverlay: true,
    data: value,
    displayData: value,
  }
}

function unavailableChoiceResource(): SheetChoiceResource {
  return {
    setCode: 'modes',
    targetVersion: 1,
    summaryVersion: null,
    setIsActive: null,
    displayAggregate: null,
    selectableAggregate: null,
    selectionReady: false,
    isStale: false,
    loading: true,
    error: null,
    prepareToOpen: () => new Promise<void>(() => undefined),
    retry: async () => undefined,
  }
}

function gridData(options: {
  invalid?: boolean
  invalidDrafts?: ConditionGridProps['data']['invalidDrafts']
  choiceResource?: SheetChoiceResource
  choiceRequired?: boolean
  choiceValue?: string | null
} = {}): ConditionGridProps['data'] {
  return {
    columns: [
      {
        key: 'pressure',
        headerName: 'Pressure',
        valueType: 'number',
        categoryCode: null,
        unit: 'kPa',
        choiceSetCode: null,
        choiceSetVersion: null,
        required: true,
        minValue: '0',
        maxValue: '500',
      },
      {
        key: 'mode',
        headerName: 'Mode',
        valueType: 'choice',
        categoryCode: null,
        choiceSetCode: 'modes',
        choiceSetVersion: 1,
        required: options.choiceRequired ?? false,
        minValue: null,
        maxValue: null,
      },
      {
        key: 'note',
        headerName: 'Note',
        valueType: 'text',
        categoryCode: null,
        choiceSetCode: null,
        choiceSetVersion: null,
        required: true,
        minValue: null,
        maxValue: null,
      },
    ],
    rows: [{
      id: '1',
      layerKey: 'layer-1',
      stepSeq: '010',
      layerId: 'L1',
      layerLabel: 'Layer 1',
      conditionLabel: 'Condition 1',
      isPor: true,
      values: { pressure: '100', mode: options.choiceValue ?? null, note: 'saved note' },
    }],
    choiceResources: new Map([['modes', options.choiceResource ?? unavailableChoiceResource()]]),
    invalidDrafts: options.invalidDrafts ?? (options.invalid ? [{
      conditionId: '1',
      parameterCode: 'pressure',
      rawValue: 'abc',
      code: 'invalid_decimal',
      message: '숫자로 입력하세요',
      constraint: null,
    }] : undefined),
  }
}

function renderGrid(props: ConditionGridProps) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const container = dom.window.document.querySelector<HTMLDivElement>('#root')
  if (container === null) throw new Error('Grid root is unavailable.')
  const globals = globalThis as unknown as {
    document?: Document
    HTMLElement?: typeof HTMLElement
    Node?: typeof Node
    window?: Window
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  const previous = {
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
  dataEditorHarness.props = undefined
  dataEditorHarness.getBounds.mockClear()
  act(() => {
    root = createRoot(container)
    root.render(<GlideConditionGrid {...props} />)
  })
  return {
    container,
    rerender: (next: ConditionGridProps) => {
      act(() => root?.render(<GlideConditionGrid {...next} />))
    },
    cleanup: () => {
      act(() => root?.unmount())
      globals.window = previous.window
      globals.document = previous.document
      globals.HTMLElement = previous.HTMLElement
      globals.Node = previous.Node
      globals.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT
      dom.window.close()
    },
  }
}

function invalidDraft(
  parameterCode: string,
  rawValue: string,
  code: 'invalid_decimal' | 'required_value' | 'number_out_of_range' | 'choice_unknown',
  message: string,
) {
  return {
    conditionId: '1',
    parameterCode,
    rawValue,
    code,
    message,
    constraint: code === 'number_out_of_range' ? '0–500 kPa 범위로 입력하세요' : null,
  }
}

function availableChoiceResource(): SheetChoiceResource {
  const aggregate = {
    set_code: 'modes',
    version: 1,
    items: [
      { code: 'AUTO', label: 'Automatic', sort_order: 0, is_active: true },
      { code: 'MANUAL', label: 'Manual', sort_order: 1, is_active: true },
    ],
  }
  return {
    setCode: 'modes',
    targetVersion: 1,
    summaryVersion: 1,
    setIsActive: true,
    displayAggregate: aggregate,
    selectableAggregate: aggregate,
    selectionReady: true,
    isStale: false,
    loading: false,
    error: null,
    prepareToOpen: vi.fn(() => new Promise<void>(() => undefined)),
    retry: vi.fn(async () => undefined),
  }
}

function renderProvidedEditor(
  grid: ReturnType<typeof renderGrid>,
  cell: ReturnType<DataEditorProps['getCellContent']>,
) {
  const provided = dataEditorProps().provideEditor?.(cell)
  if (provided === undefined || typeof provided !== 'object') {
    throw new Error('Expected an object editor provider.')
  }
  const host = grid.container.ownerDocument.createElement('div')
  grid.container.ownerDocument.body.append(host)
  installLegacyInputFocusStubs(grid.container.ownerDocument)
  const Editor = provided.editor
  let root: Root | null = createRoot(host)
  act(() => {
    root?.render(
      <Editor
        forceEditMode
        isHighlighted={false}
        onChange={vi.fn()}
        onFinishedEditing={vi.fn()}
        target={{ x: 300, y: 120, width: 150, height: 32 }}
        theme={{} as never}
        value={cell as EditableGridCell}
      />,
    )
  })
  return {
    container: host,
    cleanup: () => {
      act(() => root?.unmount())
      root = null
      host.remove()
    },
  }
}
