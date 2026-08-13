import { describe, expect, it, vi } from 'vitest'

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
} from './GlideConditionGrid'
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
      choiceSetVersion: null,
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
      target: { conditionId: 'condition-11', parameterCode: 'amount' },
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
