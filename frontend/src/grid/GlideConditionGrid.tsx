/**
 * Glide Data Grid 기반 조건표 어댑터 구현 (D-18 확정 라이브러리).
 *
 * `ConditionGridComponent` 계약을 만족하는 유일한 지점이며, `@glideapps/glide-data-grid`
 * 타입/런타임은 이 파일(+ choiceCell)에만 갇혀 있다. 상위 코드는 도메인 타입(grid/types)만
 * 본다 — "라이브러리 API가 어댑터 밖으로 새어나가지 않는지"가 리뷰 기준(P4).
 *
 * Glide 특성 대응:
 * - 컬럼 가상화: 내장(별도 구현 없음) — 200컬럼 스크롤은 Canvas 렌더가 처리한다.
 * - 좌측 식별 컬럼 고정: `freezeColumns`.
 * - row span 없음 → 조건 행 그룹핑(D-16)은 그룹 첫 행에만 layer 라벨을 그리고, 파라미터
 *   영역을 그룹 단위 교대 배경으로 구분한다(model.computeRowGroups).
 * - 붙여넣기: `onPaste`에서 항상 false를 반환해 기본 동작을 막고 TSV를 콜백으로 올린다.
 *   실제 스테이징/적용 파이프라인은 T4가 붙인다.
 * - 셀 상태/스테이징 오버레이: 표면 우선순위와 독립 dirty/comment marker를 합성한다.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  CompactSelection,
  DataEditor,
  GridCellKind,
  type CellClickedEventArgs,
  type DataEditorRef,
  type DrawCellCallback,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridKeyEventArgs,
  type GridMouseEventArgs,
  type GridSelection,
  type Item,
  type ProvideEditorComponent,
  type Rectangle,
  type TextCell,
  type Theme,
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'

import { useIsomorphicLayoutEffect } from '@/shared/lib/useIsomorphicLayoutEffect'

import { ChoiceEditor, choiceCellRenderer, isChoiceCell, makeChoiceCell } from './choiceCell'
import { shouldPersistCellChange, validateSingleCellEdit } from './cellValue'
import { DecimalEditor, decimalCellRenderer, isDecimalCell, makeDecimalCell } from './decimalCell'
import {
  IDENTITY_COLUMN_COUNT,
  IDENTITY_COLUMNS,
  cellScrollTarget,
  columnScrollIndex,
  conditionRowScrollTarget,
  commitPasteCallbackRuntime,
  computeRowGroups,
  headerTooltip,
  indexStaging,
  indexStatuses,
  isCurrentPasteCallback,
  matrixToTsv,
  overlayKey,
  previewCellValue,
  resolveCellTarget,
  visibleParameterColumns,
} from './model'
import type {
  CellStatus,
  ConditionGridCallbacks,
  ConditionGridColumn,
  ConditionGridComponent,
  ConditionGridHandle,
  ConditionGridProps,
  ConditionGridRow,
  InvalidCellDraft,
  PasteStagingCell,
  SheetChoiceResource,
} from './types'
import { GRID_COLORS } from './theme'

const GLIDE_THEME: Partial<Theme> = {
  accentColor: GRID_COLORS.brand,
  accentFg: GRID_COLORS.surface,
  accentLight: GRID_COLORS.brandSubtle,
  textDark: GRID_COLORS.ink,
  textMedium: GRID_COLORS.muted,
  textLight: GRID_COLORS.border,
  textBubble: GRID_COLORS.ink,
  bgIconHeader: GRID_COLORS.muted,
  fgIconHeader: GRID_COLORS.surface,
  textHeader: GRID_COLORS.ink,
  textGroupHeader: GRID_COLORS.muted,
  textHeaderSelected: GRID_COLORS.surface,
  bgCell: GRID_COLORS.surface,
  bgCellMedium: GRID_COLORS.canvas,
  bgHeader: GRID_COLORS.canvas,
  bgHeaderHasFocus: GRID_COLORS.brandSubtle,
  bgHeaderHovered: GRID_COLORS.brandSubtle,
  bgBubble: GRID_COLORS.canvas,
  bgBubbleSelected: GRID_COLORS.surface,
  bgSearchResult: GRID_COLORS.warningSurface,
  borderColor: GRID_COLORS.border,
  horizontalBorderColor: GRID_COLORS.border,
  headerBottomBorderColor: GRID_COLORS.border,
  drilldownBorder: GRID_COLORS.brandAccent,
  linkColor: GRID_COLORS.brand,
}

const GROUP_SHADE: Partial<Theme> = { bgCell: GRID_COLORS.canvas }
const IDENTITY_THEME: Partial<Theme> = { bgCell: GRID_COLORS.canvas }
const EMPTY_GRID_SELECTION: GridSelection = {
  columns: CompactSelection.empty(),
  rows: CompactSelection.empty(),
  current: undefined,
}

interface InvalidDraftPopoverPlacement {
  x: number
  y: number
  placement: 'below' | 'above'
}

interface InvalidDraftPopoverPosition extends InvalidDraftPopoverPlacement {
  anchor: Rectangle
}

const INVALID_DRAFT_POPOVER_SIZE = { width: 280, height: 104 }
const INVALID_DRAFT_POPOVER_MARGIN = 8

type InvalidDraftEditorAuthority =
  | { readonly kind: 'text' }
  | { readonly kind: 'number'; readonly unit: string | null }
  | {
      readonly kind: 'choice'
      readonly resource: SheetChoiceResource
      readonly restoreGridFocus: () => void
    }
  | { readonly kind: 'blocked-choice' }

interface InvalidDraftTextCell extends TextCell {
  readonly invalidDraftRawValue: string
  readonly invalidDraftEditor: InvalidDraftEditorAuthority
}

function isInvalidDraftTextCell(cell: GridCell): cell is InvalidDraftTextCell {
  return cell.kind === GridCellKind.Text && 'invalidDraftRawValue' in cell
}

function invalidDraftEditingCell(
  cell: InvalidDraftTextCell,
  rawValue: string,
): InvalidDraftTextCell {
  return {
    ...cell,
    data: rawValue,
    displayData: rawValue,
    copyData: rawValue,
    invalidDraftRawValue: rawValue,
  }
}

const InvalidDraftTextEditor: ProvideEditorComponent<GridCell> = ({
  value,
  initialValue,
  onChange,
  onFinishedEditing,
}) => {
  const invalidCell = isInvalidDraftTextCell(value) ? value : null
  const [draft, setDraft] = useState(initialValue ?? invalidCell?.invalidDraftRawValue ?? '')

  useEffect(() => {
    if (
      invalidCell === null ||
      (invalidCell.data === draft && invalidCell.invalidDraftRawValue === draft)
    ) return
    onChange(invalidDraftEditingCell(invalidCell, draft))
  }, [draft, invalidCell, onChange])

  if (invalidCell === null) return null

  const finish = (): void => {
    onFinishedEditing(invalidDraftEditingCell(invalidCell, draft))
  }

  return (
    <div className="grid min-w-0 gap-1 bg-surface p-2">
      <input
        autoFocus
        className="input w-full font-mono"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            finish()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onFinishedEditing(undefined)
          }
        }}
      />
    </div>
  )
}

const InvalidDraftDecimalEditor: ProvideEditorComponent<GridCell> = (props) => {
  const invalidCell = isInvalidDraftTextCell(props.value) ? props.value : null
  if (invalidCell === null || invalidCell.invalidDraftEditor.kind !== 'number') return null
  return (
    <DecimalEditor
      {...props}
      value={makeDecimalCell(
        invalidCell.invalidDraftRawValue,
        invalidCell.invalidDraftEditor.unit,
        invalidCell.readonly ?? false,
        invalidCell.themeOverride,
      )}
    />
  )
}

const InvalidDraftChoiceEditor: ProvideEditorComponent<GridCell> = (props) => {
  const invalidCell = isInvalidDraftTextCell(props.value) ? props.value : null
  if (invalidCell === null || invalidCell.invalidDraftEditor.kind !== 'choice') return null
  return (
    <ChoiceEditor
      {...props}
      value={makeChoiceCell(
        invalidCell.invalidDraftRawValue,
        invalidCell.invalidDraftEditor.resource,
        invalidCell.readonly ?? false,
        invalidCell.themeOverride,
        invalidCell.invalidDraftEditor.restoreGridFocus,
      )}
    />
  )
}

function provideInvalidDraftEditor(cell: GridCell) {
  if (!isInvalidDraftTextCell(cell)) return undefined
  if (cell.invalidDraftEditor.kind === 'blocked-choice') return undefined
  if (cell.invalidDraftEditor.kind === 'number') {
    return { editor: InvalidDraftDecimalEditor, disablePadding: true }
  }
  if (cell.invalidDraftEditor.kind === 'choice') {
    return {
      editor: InvalidDraftChoiceEditor,
      disablePadding: true,
      styleOverride: { minWidth: 320, minHeight: 320 },
    }
  }
  return { editor: InvalidDraftTextEditor, disablePadding: true }
}

/** Prefer below the cell, flip above at the bottom edge, and clamp inside the viewport. */
export function invalidDraftPopoverPlacement(
  bounds: Rectangle,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
): InvalidDraftPopoverPlacement {
  const margin = INVALID_DRAFT_POPOVER_MARGIN
  const belowY = bounds.y + bounds.height + margin
  const aboveY = bounds.y - size.height - margin
  const placement =
    belowY + size.height <= viewport.height - margin || aboveY < margin
      ? 'below'
      : 'above'
  const preferredY = placement === 'below' ? belowY : aboveY
  return {
    x: Math.min(Math.max(bounds.x, margin), Math.max(margin, viewport.width - size.width - margin)),
    y: Math.min(Math.max(preferredY, margin), Math.max(margin, viewport.height - size.height - margin)),
    placement,
  }
}

function indexInvalidDrafts(
  drafts: readonly InvalidCellDraft[] | undefined,
): ReadonlyMap<string, InvalidCellDraft> {
  const index = new Map<string, InvalidCellDraft>()
  for (const draft of drafts ?? []) {
    index.set(overlayKey(draft.conditionId, draft.parameterCode), draft)
  }
  return index
}

function invalidDraftAccessibility(
  row: Pick<ConditionGridRow, 'layerLabel' | 'conditionLabel'>,
  column: Pick<ConditionGridColumn, 'headerName'>,
  draft: InvalidCellDraft,
): string {
  const raw = draft.rawValue === '' ? '입력값 비어 있음' : `입력값 "${draft.rawValue}"`
  const error = draft.constraint === null
    ? draft.message
    : `${draft.message}, ${draft.constraint}`
  return `Layer: ${row.layerLabel}, 조건 ${row.conditionLabel}, 파라미터 ${column.headerName}, ${raw}, 오류 ${error}, 저장되지 않음`
}

export function gridLayoutAuthority(
  columns: readonly Pick<ConditionGridColumn, 'key'>[],
  rows: readonly Pick<ConditionGridRow, 'id'>[],
): string {
  return JSON.stringify([
    columns.map((column) => column.key),
    rows.map((row) => row.id),
  ])
}

export function currentGridSelectionForLayout<Selection>(
  state: { readonly layoutAuthority: string; readonly selection: Selection },
  currentLayoutAuthority: string,
  emptySelection: Selection,
): Selection {
  return state.layoutAuthority === currentLayoutAuthority
    ? state.selection
    : emptySelection
}

export function porCellBehavior(
  isPor: boolean,
  layerRowCount: number,
): { mark: '●' | '○'; canTransfer: boolean } {
  return {
    mark: isPor ? '●' : '○',
    canTransfer: layerRowCount > 1 && !isPor,
  }
}

export function porCellAccessibility(
  layerLabel: string,
  conditionLabel: string,
  isPor: boolean,
): string {
  return `Layer ${layerLabel}, 조건 ${conditionLabel}, POR ${isPor ? '선택됨' : '선택 안 됨'}, 단일 선택`
}

export function gridSelectionActivation(
  col: number,
  row: number,
  columns: readonly Pick<ConditionGridColumn, 'key'>[],
  rows: readonly ConditionGridRow[],
): {
  condition: { conditionId: string; layerKey: string } | null
  cell: { conditionId: string; parameterCode: string; layerKey: string } | null
} {
  const rowData = rows[row]
  if (rowData === undefined) return { condition: null, cell: null }
  if (col < IDENTITY_COLUMN_COUNT) {
    return {
      condition: { conditionId: rowData.id, layerKey: rowData.layerKey },
      cell: null,
    }
  }
  const column = columns[col - IDENTITY_COLUMN_COUNT]
  return {
    condition: null,
    cell: column === undefined
      ? null
      : { conditionId: rowData.id, parameterCode: column.key, layerKey: rowData.layerKey },
  }
}

export function requestPorTransfer(
  row: Pick<ConditionGridRow, 'id' | 'layerKey' | 'isPor'>,
  layerRowCount: number,
  onPorChange: ConditionGridCallbacks['onPorChange'],
): void {
  if (porCellBehavior(row.isPor, layerRowCount).canTransfer) {
    onPorChange?.(row.layerKey, row.id)
  }
}

function selectionForCell(col: number, row: number): GridSelection {
  return {
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
    current: {
      cell: [col, row],
      range: { x: col, y: row, width: 1, height: 1 },
      rangeStack: [],
    },
  }
}

export interface CellHistoryRequest {
  conditionId: string
  parameterCode: string
}

export interface CellHistoryMenuState {
  target: CellHistoryRequest
  x: number
  y: number
}

interface CellHistoryMenuAnchor {
  x: number
  y: number
  height: number
}

interface CellHistoryMenuViewport {
  width: number
  height: number
}

const CELL_HISTORY_MENU_WIDTH = 152
const CELL_HISTORY_MENU_HEIGHT = 48
const CELL_HISTORY_MENU_VIEWPORT_MARGIN = 8

/** Keep the fixed menu visible and prefer a below-anchor placement until it no longer fits. */
export function resolveCellHistoryMenuPosition(
  anchor: CellHistoryMenuAnchor,
  viewport: CellHistoryMenuViewport,
): Pick<CellHistoryMenuState, 'x' | 'y'> {
  const margin = CELL_HISTORY_MENU_VIEWPORT_MARGIN
  const maxX = Math.max(margin, viewport.width - CELL_HISTORY_MENU_WIDTH - margin)
  const maxY = Math.max(margin, viewport.height - CELL_HISTORY_MENU_HEIGHT - margin)
  const belowY = anchor.y + Math.max(0, anchor.height)
  const aboveY = anchor.y - CELL_HISTORY_MENU_HEIGHT
  const preferredY =
    belowY + CELL_HISTORY_MENU_HEIGHT <= viewport.height - margin || aboveY < margin
      ? belowY
      : aboveY

  return {
    x: Math.min(Math.max(anchor.x, margin), maxX),
    y: Math.min(Math.max(preferredY, margin), maxY),
  }
}

/** Translate a Glide coordinate to the domain-only history request boundary. */
export function resolveCellHistoryRequest(
  item: Item,
  visibleColumns: readonly ConditionGridColumn[],
  rows: readonly ConditionGridRow[],
): CellHistoryRequest | null {
  return resolveCellTarget(
    item[0],
    item[1],
    visibleColumns,
    rows,
    IDENTITY_COLUMN_COUNT,
  )
}

export function isCellHistoryMenuInvocation(key: string, shiftKey: boolean): boolean {
  return key === 'ContextMenu' || key === 'Menu' || (key === 'F10' && shiftKey)
}

export function cellHistoryMenuActionForKey(
  key: string,
): 'activate' | 'close' | null {
  if (key === 'Enter') return 'activate'
  if (key === 'Escape') return 'close'
  return null
}

export function closeCellHistoryMenuState(
  current: CellHistoryMenuState | null,
): { next: null; restoreFocus: boolean } {
  return { next: null, restoreFocus: current !== null }
}

export type CellStatusVisualPriority = 'error' | 'warning' | 'dirty' | 'comment' | null

/** Surface priority only; the composite status object keeps every independent marker fact. */
export function cellStatusVisualPriority(status: CellStatus): CellStatusVisualPriority {
  if (status.validation?.severity === 'error') return 'error'
  if (status.validation?.severity === 'warning') return 'warning'
  if (status.dirty) return 'dirty'
  if ((status.commentCount ?? 0) > 0) return 'comment'
  return null
}

export function cellStatusMarkerFacts(
  status: CellStatus | undefined,
): { dirty: boolean; comment: boolean } {
  return {
    dirty: status?.dirty ?? false,
    comment: (status?.commentCount ?? 0) > 0,
  }
}

/** Non-color hover text retains every independent status fact under the priority surface. */
export function cellStatusTooltip(status: CellStatus | undefined): string | null {
  if (status === undefined) return null
  const facts: string[] = []
  if (status.validation !== undefined) {
    const severity = status.validation.severity === 'error' ? '오류' : '경고'
    facts.push(`${severity} ${status.validation.count}건`, status.validation.message)
  }
  if (status.dirty) facts.push('저장되지 않은 변경')
  if ((status.commentCount ?? 0) > 0) facts.push(`댓글 ${status.commentCount}개`)
  return facts.length === 0 ? null : facts.join(' · ')
}

/** 셀 상태/스테이징 오버레이 → themeOverride. 스테이징(진행 중 붙여넣기 미리보기)이 우선. */
function overlayTheme(
  status: CellStatus | undefined,
  staging: PasteStagingCell | undefined,
  invalid: boolean,
): Partial<Theme> | undefined {
  if (staging !== undefined) {
    return staging.valid
      ? { bgCell: GRID_COLORS.successSurface, textDark: GRID_COLORS.success }
      : { bgCell: GRID_COLORS.errorSurface, textDark: GRID_COLORS.error }
  }
  if (invalid) return { bgCell: GRID_COLORS.errorSurface, textDark: GRID_COLORS.error }
  if (status !== undefined) {
    switch (cellStatusVisualPriority(status)) {
      case 'error':
        return { bgCell: GRID_COLORS.errorSurface, textDark: GRID_COLORS.error }
      case 'warning':
        return { bgCell: GRID_COLORS.warningSurface, textDark: GRID_COLORS.warning }
      case 'dirty':
        return { bgCell: GRID_COLORS.warningSurface, textDark: GRID_COLORS.warning }
      case 'comment':
        return { bgCell: GRID_COLORS.brandSubtle, textDark: GRID_COLORS.brand }
      case null:
        return undefined
    }
  }
  return undefined
}

/** Glide 편집 셀에서 정규화된 도메인 값(문자열|null)을 뽑는다. 빈 값은 null(셀 비우기). */
function editedValue(cell: EditableGridCell): string | null | undefined {
  if (cell.kind === GridCellKind.Custom && isDecimalCell(cell)) {
    return cell.data.value
  }
  if (cell.kind === GridCellKind.Custom && isChoiceCell(cell)) {
    return cell.data.value
  }
  if (cell.kind === GridCellKind.Text) {
    return cell.data
  }
  return null
}

export const GlideConditionGrid: ConditionGridComponent = forwardRef<
  ConditionGridHandle,
  ConditionGridProps
>(function GlideConditionGrid({ data, view, callbacks, pasteStaging }, ref) {
  const gridRef = useRef<DataEditorRef>(null)
  const requestedFocusRef = useRef<Item | null>(null)
  const restoreGridFocus = useCallback(() => gridRef.current?.focus(), [])
  const cellHistoryMenuElementRef = useRef<HTMLDivElement>(null)
  const cellHistoryMenuItemRef = useRef<HTMLButtonElement>(null)
  const cellHistoryMenuStateRef = useRef<CellHistoryMenuState | null>(null)
  const [cellHistoryMenu, setCellHistoryMenu] = useState<CellHistoryMenuState | null>(null)
  const closeCellHistoryMenu = useCallback(() => {
    const transition = closeCellHistoryMenuState(cellHistoryMenuStateRef.current)
    if (!transition.restoreFocus) return
    cellHistoryMenuStateRef.current = transition.next
    setCellHistoryMenu(transition.next)
    restoreGridFocus()
  }, [restoreGridFocus])
  const readOnly = view?.readOnly ?? false
  const rows = data.rows

  // 헤더 hover 툴팁: 컬럼 description(축약 컬럼명의 전체 의미). Glide는 캔버스 렌더라 native
  // title 속성을 못 쓰므로 onItemHovered로 헤더 컬럼을 추적해 오버레이 div로 띄운다. 이 상태와
  // 배선은 어댑터 내부에만 있고 상위(SheetEditor)는 이 존재를 모른다(어댑터 경계, P4).
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

  const visibleColumns = useMemo(
    () => visibleParameterColumns(data.columns, view?.activeCategory),
    [data.columns, view?.activeCategory],
  )
  const openCellHistoryMenu = useCallback(
    (
      target: CellHistoryRequest,
      bounds: { x: number; y: number; height: number } | undefined,
    ) => {
      const position = resolveCellHistoryMenuPosition(
        {
          x: bounds?.x ?? CELL_HISTORY_MENU_VIEWPORT_MARGIN,
          y: bounds?.y ?? CELL_HISTORY_MENU_VIEWPORT_MARGIN,
          height: bounds?.height ?? 0,
        },
        { width: window.innerWidth, height: window.innerHeight },
      )
      const menu = {
        target,
        ...position,
      }
      cellHistoryMenuStateRef.current = menu
      setCellHistoryMenu(menu)
    },
    [],
  )
  const layoutAuthority = useMemo(
    () => gridLayoutAuthority(visibleColumns, rows),
    [visibleColumns, rows],
  )
  const [selectionState, setSelectionState] = useState<{
    layoutAuthority: string
    selection: GridSelection
  }>(() => ({ layoutAuthority, selection: EMPTY_GRID_SELECTION }))
  const effectiveGridSelection = currentGridSelectionForLayout(
    selectionState,
    layoutAuthority,
    EMPTY_GRID_SELECTION,
  )
  const handleGridSelectionChange = useCallback(
    (selection: GridSelection) => {
      setSelectionState({ layoutAuthority, selection })
      const cell = selection.current?.cell
      if (cell === undefined) return
      const activation = gridSelectionActivation(cell[0], cell[1], visibleColumns, rows)
      if (activation.condition !== null) callbacks?.onConditionActivate?.(activation.condition)
      if (activation.cell !== null) callbacks?.onCellActivate?.(activation.cell)
    },
    [callbacks, layoutAuthority, rows, visibleColumns],
  )

  useIsomorphicLayoutEffect(() => {
    if (cellHistoryMenu !== null) cellHistoryMenuItemRef.current?.focus()
  }, [cellHistoryMenu])

  useEffect(() => {
    if (cellHistoryMenu === null) return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && cellHistoryMenuElementRef.current?.contains(target)) return
      closeCellHistoryMenu()
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [cellHistoryMenu, closeCellHistoryMenu])

  // A controlled raw coordinate must never survive a category/column or row-identity layout.
  // The render already supplies EMPTY_GRID_SELECTION; this commit adopts the new authority.
  useIsomorphicLayoutEffect(() => {
    if (selectionState.layoutAuthority !== layoutAuthority) {
      requestedFocusRef.current = null
      setSelectionState({ layoutAuthority, selection: EMPTY_GRID_SELECTION })
    }
  }, [layoutAuthority, selectionState.layoutAuthority])
  // Glide의 클립보드 읽기가 끝날 때까지 readOnly/열/행 문맥이 유지됐는지 확인한다. 이전
  // render의 handlePaste가 남아 실행돼도 현재 ref와 generation이 다르면 좌표 해석 전에 폐기.
  const pasteCallbackGeneration = useMemo(
    () => Symbol('glide-paste-context'),
    [readOnly, visibleColumns, rows],
  )
  const pasteCallbackRuntimeRef = useRef({ generation: pasteCallbackGeneration, readOnly })
  useIsomorphicLayoutEffect(() => {
    commitPasteCallbackRuntime(pasteCallbackRuntimeRef, {
      generation: pasteCallbackGeneration,
      readOnly,
    })
  }, [pasteCallbackGeneration, readOnly])
  const groupMeta = useMemo(() => computeRowGroups(rows), [rows])
  const statusIndex = useMemo(() => indexStatuses(data.statuses), [data.statuses])
  const stagingIndex = useMemo(() => indexStaging(pasteStaging), [pasteStaging])
  const invalidDraftIndex = useMemo(
    () => indexInvalidDrafts(data.invalidDrafts),
    [data.invalidDrafts],
  )

  const selectedCell = effectiveGridSelection.current?.cell
  const activeInvalidDraft = useMemo(() => {
    if (selectedCell === undefined) return null
    const target = resolveCellTarget(
      selectedCell[0],
      selectedCell[1],
      visibleColumns,
      rows,
      IDENTITY_COLUMN_COUNT,
    )
    if (target === null) return null
    const draft = invalidDraftIndex.get(overlayKey(target.conditionId, target.parameterCode))
    if (draft === undefined) return null
    const row = rows[selectedCell[1]]
    const column = visibleColumns[selectedCell[0] - IDENTITY_COLUMN_COUNT]
    if (row === undefined || column === undefined) return null
    return { draft, row, column, item: selectedCell }
  }, [invalidDraftIndex, rows, selectedCell, visibleColumns])
  const [invalidDraftPopover, setInvalidDraftPopover] =
    useState<InvalidDraftPopoverPosition | null>(null)
  const invalidDraftPopoverFrameRef = useRef<number | null>(null)
  const refreshInvalidDraftPopover = useCallback(() => {
    if (activeInvalidDraft === null) {
      setInvalidDraftPopover(null)
      return
    }
    const bounds = gridRef.current?.getBounds(
      activeInvalidDraft.item[0],
      activeInvalidDraft.item[1],
    )
    if (bounds === undefined) {
      setInvalidDraftPopover(null)
      return
    }
    setInvalidDraftPopover({
      ...invalidDraftPopoverPlacement(
        bounds,
        { width: window.innerWidth, height: window.innerHeight },
        INVALID_DRAFT_POPOVER_SIZE,
      ),
      anchor: bounds,
    })
  }, [activeInvalidDraft])
  const scheduleInvalidDraftPopoverRefresh = useCallback(() => {
    if (invalidDraftPopoverFrameRef.current !== null) {
      window.cancelAnimationFrame(invalidDraftPopoverFrameRef.current)
    }
    invalidDraftPopoverFrameRef.current = window.requestAnimationFrame(() => {
      invalidDraftPopoverFrameRef.current = window.requestAnimationFrame(() => {
        invalidDraftPopoverFrameRef.current = null
        refreshInvalidDraftPopover()
      })
    })
  }, [refreshInvalidDraftPopover])

  useIsomorphicLayoutEffect(() => {
    if (invalidDraftPopoverFrameRef.current !== null) {
      window.cancelAnimationFrame(invalidDraftPopoverFrameRef.current)
      invalidDraftPopoverFrameRef.current = null
    }
    refreshInvalidDraftPopover()
  }, [refreshInvalidDraftPopover])

  useEffect(() => () => {
    if (invalidDraftPopoverFrameRef.current !== null) {
      window.cancelAnimationFrame(invalidDraftPopoverFrameRef.current)
    }
  }, [])

  // Imperative navigation publishes selection first; focus again after that controlled selection
  // commits so Glide targets the requested accessible cell rather than the previous selection.
  useIsomorphicLayoutEffect(() => {
    const requested = requestedFocusRef.current
    const selected = effectiveGridSelection.current?.cell
    if (requested === null || selected?.[0] !== requested[0] || selected[1] !== requested[1]) return
    requestedFocusRef.current = null
    gridRef.current?.focus()
  }, [effectiveGridSelection])

  const gridColumns = useMemo<GridColumn[]>(() => {
    const identity: GridColumn[] = [
      { id: IDENTITY_COLUMNS[0].id, title: IDENTITY_COLUMNS[0].title, width: 84 },
      { id: IDENTITY_COLUMNS[1].id, title: IDENTITY_COLUMNS[1].title, width: 120 },
      { id: IDENTITY_COLUMNS[2].id, title: IDENTITY_COLUMNS[2].title, width: 104 },
      { id: IDENTITY_COLUMNS[3].id, title: IDENTITY_COLUMNS[3].title, width: 64 },
    ]
    const params = visibleColumns.map<GridColumn>((column) => ({
      id: column.key,
      title: column.unit ? `${column.headerName} · ${column.unit}` : column.headerName,
      width: 150,
    }))
    return [...identity, ...params]
  }, [visibleColumns])

  const getCellContent = useCallback(
    (item: Item): GridCell => {
      const [col, row] = item
      const rowData = rows[row]
      if (rowData === undefined) {
        return { kind: GridCellKind.Loading, allowOverlay: false }
      }

      // 좌측 고정 식별 컬럼 (파라미터가 아니라 행 필드에서 렌더).
      if (col === 0) {
        const stepSeq = groupMeta.isGroupStart[row] ? rowData.stepSeq : ''
        return {
          kind: GridCellKind.Text,
          data: stepSeq,
          displayData: stepSeq,
          allowOverlay: false,
          themeOverride: { ...IDENTITY_THEME, textDark: GRID_COLORS.ink },
        }
      }
      if (col === 1) {
        const layerId = groupMeta.isGroupStart[row] ? rowData.layerId : ''
        return {
          kind: GridCellKind.Text,
          data: layerId,
          displayData: layerId,
          allowOverlay: false,
          themeOverride: { ...IDENTITY_THEME, textDark: GRID_COLORS.ink },
        }
      }
      if (col === 2) {
        return {
          kind: GridCellKind.Text,
          data: rowData.conditionLabel,
          displayData: rowData.conditionLabel,
          allowOverlay: false,
          themeOverride: IDENTITY_THEME,
        }
      }
      if (col === 3) {
        // POR 표식 ●/○ — 표시는 읽기 전용 셀이고, 이양은 onCellClicked(col===3)가 처리한다(T7).
        const behavior = porCellBehavior(
          rowData.isPor,
          groupMeta.groups[groupMeta.groupIndexByRow[row]]?.rowCount ?? 0,
        )
        return {
          kind: GridCellKind.Text,
          data: porCellAccessibility(rowData.layerLabel, rowData.conditionLabel, rowData.isPor),
          displayData: behavior.mark,
          allowOverlay: false,
          contentAlign: 'center',
          themeOverride: {
            ...IDENTITY_THEME,
            textDark: rowData.isPor ? GRID_COLORS.brand : GRID_COLORS.muted,
          },
        }
      }

      // 파라미터 컬럼.
      const column = visibleColumns[col - IDENTITY_COLUMN_COUNT]
      if (column === undefined) {
        return { kind: GridCellKind.Loading, allowOverlay: false }
      }
      const serverValue = rowData.values[column.key] ?? null
      const key = overlayKey(rowData.id, column.key)
      const staging = stagingIndex.get(key)
      const invalidDraft = invalidDraftIndex.get(key)
      const choiceResource = column.choiceSetCode === null
        ? undefined
        : data.choiceResources?.get(column.choiceSetCode)
      // Whole-surface paste preview remains authoritative; otherwise retain the rejected raw edit.
      const raw = staging === undefined && invalidDraft !== undefined
        ? invalidDraft.rawValue
        : previewCellValue(serverValue, staging)
      const overlay = overlayTheme(
        statusIndex.get(key),
        staging,
        invalidDraft !== undefined,
      )
      const oddGroup = groupMeta.groupIndexByRow[row] % 2 === 1
      const base = oddGroup ? GROUP_SHADE : undefined
      const themeOverride = overlay ? { ...base, ...overlay } : base

      if (staging === undefined && invalidDraft !== undefined) {
        const invalidDraftEditor: InvalidDraftEditorAuthority =
          column.valueType === 'number'
            ? { kind: 'number', unit: column.unit ?? null }
            : column.valueType === 'choice'
              ? choiceResource === undefined
                ? { kind: 'blocked-choice' }
                : { kind: 'choice', resource: choiceResource, restoreGridFocus }
              : { kind: 'text' }
        const invalidCell: InvalidDraftTextCell = {
          kind: GridCellKind.Text,
          data: invalidDraftAccessibility(rowData, column, invalidDraft),
          displayData: invalidDraft.rawValue,
          copyData: invalidDraft.rawValue,
          invalidDraftRawValue: invalidDraft.rawValue,
          invalidDraftEditor,
          allowOverlay: !readOnly && invalidDraftEditor.kind !== 'blocked-choice',
          readonly: readOnly || invalidDraftEditor.kind === 'blocked-choice',
          contentAlign: column.valueType === 'number' ? 'right' : undefined,
          themeOverride,
        }
        return invalidCell
      }

      if (column.valueType === 'number') {
        return makeDecimalCell(raw, column.unit ?? null, readOnly, themeOverride)
      }
      if (column.valueType === 'choice') {
        // Adapter/hook 계약을 위반한 resource 누락은 raw 값만 보존하고 fail-closed한다.
        if (choiceResource === undefined) {
          return {
            kind: GridCellKind.Text,
            data: raw ?? '',
            displayData: raw ?? '',
            allowOverlay: false,
            readonly: true,
            themeOverride,
            copyData: raw ?? '',
          }
        }
        return makeChoiceCell(
          raw ?? '',
          choiceResource,
          readOnly,
          themeOverride,
          restoreGridFocus,
        )
      }
      // text → 텍스트 셀.
      return {
        kind: GridCellKind.Text,
        data: raw ?? '',
        displayData: raw ?? '',
        allowOverlay: !readOnly,
        readonly: readOnly,
        themeOverride,
        copyData: raw ?? '',
      }
    },
    [
      rows,
      visibleColumns,
      groupMeta,
      statusIndex,
      stagingIndex,
      invalidDraftIndex,
      readOnly,
      data.choiceResources,
      restoreGridFocus,
    ],
  )

  const handleCellEdited = useCallback(
    (item: Item, newValue: EditableGridCell) => {
      const target = resolveCellTarget(item[0], item[1], visibleColumns, rows, IDENTITY_COLUMN_COUNT)
      if (target === null) return
      const column = visibleColumns[item[0] - IDENTITY_COLUMN_COUNT]
      const row = rows[item[1]]
      if (column === undefined || row === undefined) return
      const candidate = editedValue(newValue)
      if (candidate === undefined) return
      const resource =
        column.choiceSetCode === null
          ? undefined
          : data.choiceResources?.get(column.choiceSetCode)
      const oldValue = row.values[column.key] ?? null
      const validation = validateSingleCellEdit(column, oldValue, candidate ?? '', resource)
      if (!validation.ok) {
        if (validation.code !== 'choice_resource_unavailable') {
          callbacks?.onCellInvalid?.({
            conditionId: target.conditionId,
            parameterCode: target.parameterCode,
            rawValue: validation.rawValue,
            code: validation.code,
            message: validation.message,
            constraint: validation.constraint,
          })
        }
        return
      }
      callbacks?.onInvalidDraftClear?.(target.conditionId, target.parameterCode)
      if (shouldPersistCellChange(oldValue, validation.value)) {
        callbacks?.onCellEdit?.({
          conditionId: target.conditionId,
          parameterCode: target.parameterCode,
          value: validation.value,
        })
      }
    },
    [visibleColumns, rows, callbacks, data.choiceResources],
  )

  const handlePaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]): boolean => {
      const current = pasteCallbackRuntimeRef.current
      if (
        !isCurrentPasteCallback(
          pasteCallbackGeneration,
          current.generation,
          !current.readOnly,
        )
      ) {
        return false
      }
      if (readOnly) return false
      const cellTarget = resolveCellTarget(target[0], target[1], visibleColumns, rows, IDENTITY_COLUMN_COUNT)
      if (cellTarget !== null) {
        callbacks?.onPaste?.(cellTarget, matrixToTsv(values))
      }
      // 항상 기본 붙여넣기를 막는다 — 실제 적용(스테이징 → 더티 버퍼)은 T4가 담당.
      return false
    },
    [readOnly, visibleColumns, rows, callbacks, pasteCallbackGeneration],
  )

  const handleCellContextMenu = useCallback(
    (item: Item, event: CellClickedEventArgs) => {
      const target = resolveCellHistoryRequest(item, visibleColumns, rows)
      if (target === null) return
      event.preventDefault()
      openCellHistoryMenu(target, event.bounds)
    },
    [visibleColumns, rows, openCellHistoryMenu],
  )

  const handleGridKeyDown = useCallback(
    (event: GridKeyEventArgs) => {
      const item = event.location ?? effectiveGridSelection.current?.cell
      if (event.key === 'Enter' && item?.[0] === 3 && !readOnly) {
        const rowData = rows[item[1]]
        if (rowData === undefined) return
        event.cancel()
        event.preventDefault()
        requestPorTransfer(
          rowData,
          groupMeta.groups[groupMeta.groupIndexByRow[item[1]]]?.rowCount ?? 0,
          callbacks?.onPorChange,
        )
        return
      }
      if (!isCellHistoryMenuInvocation(event.key, event.shiftKey)) return
      if (item === undefined) return
      const target = resolveCellHistoryRequest(item, visibleColumns, rows)
      if (target === null) return
      event.cancel()
      event.preventDefault()
      event.stopPropagation()
      openCellHistoryMenu(target, event.bounds)
    },
    [
      effectiveGridSelection.current?.cell,
      visibleColumns,
      rows,
      openCellHistoryMenu,
      readOnly,
      groupMeta,
      callbacks,
    ],
  )

  const requestCellHistory = useCallback(() => {
    if (cellHistoryMenu === null) return
    callbacks?.onCellHistoryRequest?.(cellHistoryMenu.target)
    closeCellHistoryMenu()
  }, [callbacks, cellHistoryMenu, closeCellHistoryMenu])

  const handleCellHistoryMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const action = cellHistoryMenuActionForKey(event.key)
      if (action === null) return
      event.preventDefault()
      event.stopPropagation()
      if (action === 'activate') {
        requestCellHistory()
      } else {
        closeCellHistoryMenu()
      }
    },
    [requestCellHistory, closeCellHistoryMenu],
  )

  const handleItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      if (args.kind === 'cell') {
        const target = resolveCellTarget(
          args.location[0],
          args.location[1],
          visibleColumns,
          rows,
          IDENTITY_COLUMN_COUNT,
        )
        if (target !== null) {
          const key = overlayKey(target.conditionId, target.parameterCode)
          const staging = stagingIndex.get(key)
          const statusText =
            staging === undefined
              ? cellStatusTooltip(statusIndex.get(key))
              : staging.valid
                ? '붙여넣기 적용 예정'
                : `붙여넣기 확인 필요${staging.message ? ` · ${staging.message}` : ''}`
          if (statusText !== null) {
            setTooltip({
              text: statusText,
              x: args.bounds.x,
              y: args.bounds.y + args.bounds.height,
            })
            return
          }
        }
        const cell = getCellContent(args.location)
        if (cell.kind === GridCellKind.Custom && isChoiceCell(cell) && cell.data.tooltip !== '') {
          setTooltip({
            text: cell.data.tooltip,
            x: args.bounds.x,
            y: args.bounds.y + args.bounds.height,
          })
          return
        }
      }
      // 헤더/선택지 셀이 아니면 툴팁 해제.
      if (args.kind !== 'header') {
        setTooltip((prev) => (prev === null ? prev : null))
        return
      }
      const text = headerTooltip(args.location[0], visibleColumns, IDENTITY_COLUMN_COUNT)
      if (text === null) {
        setTooltip((prev) => (prev === null ? prev : null))
        return
      }
      // Glide bounds는 뷰포트(client) 좌표 → position: fixed로 헤더 바로 아래에 그대로 배치.
      setTooltip({ text, x: args.bounds.x, y: args.bounds.y + args.bounds.height })
    },
    [visibleColumns, rows, statusIndex, stagingIndex, getCellContent],
  )

  const drawCell = useCallback<DrawCellCallback>(
    (args, drawContent) => {
      drawContent()
      const target = resolveCellTarget(
        args.col,
        args.row,
        visibleColumns,
        rows,
        IDENTITY_COLUMN_COUNT,
      )
      if (target === null) return
      const key = overlayKey(target.conditionId, target.parameterCode)
      // Paste staging owns the complete surface until apply/cancel.
      if (stagingIndex.has(key)) return
      const invalidDraft = invalidDraftIndex.get(key)
      if (invalidDraft !== undefined) {
        const { ctx, rect } = args
        ctx.save()
        ctx.strokeStyle = GRID_COLORS.error
        ctx.lineWidth = 2
        ctx.strokeRect(rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4)
        ctx.fillStyle = GRID_COLORS.error
        ctx.font = '700 12px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('!', rect.x + 7, rect.y + rect.height / 2)
        ctx.restore()
      }
      const markers = cellStatusMarkerFacts(statusIndex.get(key))
      if (!markers.dirty && !markers.comment) return

      const { ctx, rect } = args
      ctx.save()
      if (markers.dirty) {
        ctx.fillStyle = GRID_COLORS.warning
        ctx.beginPath()
        ctx.moveTo(rect.x + rect.width - 10, rect.y + rect.height)
        ctx.lineTo(rect.x + rect.width, rect.y + rect.height - 10)
        ctx.lineTo(rect.x + rect.width, rect.y + rect.height)
        ctx.closePath()
        ctx.fill()
      }
      if (markers.comment) {
        ctx.fillStyle = GRID_COLORS.brand
        ctx.beginPath()
        ctx.arc(rect.x + rect.width - 7, rect.y + 7, 3, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    },
    [visibleColumns, rows, stagingIndex, invalidDraftIndex, statusIndex],
  )

  // POR 클릭만 별도 구조 변경으로 올린다. 행/셀 활성화는 클릭과 키보드에 공통인
  // onGridSelectionChange 한 경로가 담당해 콜백 중복을 피한다.
  const handleCellClicked = useCallback(
    (item: Item) => {
      const [col, row] = item
      const rowData = rows[row]
      if (rowData === undefined) return
      if (readOnly) return
      if (col === 3) {
        requestPorTransfer(
          rowData,
          groupMeta.groups[groupMeta.groupIndexByRow[row]]?.rowCount ?? 0,
          callbacks?.onPorChange,
        )
        return
      }
    },
    [readOnly, rows, callbacks, groupMeta],
  )

  useImperativeHandle(
    ref,
    (): ConditionGridHandle => ({
      scrollToCondition(conditionId) {
        const target = conditionRowScrollTarget(conditionId, rows)
        if (target !== null) {
          gridRef.current?.scrollTo(target.col, target.row, 'vertical', 0, 0, {
            vAlign: 'center',
          })
          requestedFocusRef.current = [target.col, target.row]
          setSelectionState({
            layoutAuthority,
            selection: selectionForCell(target.col, target.row),
          })
        }
      },
      scrollToCell(conditionId, parameterCode) {
        const target = cellScrollTarget(conditionId, parameterCode, visibleColumns, rows, IDENTITY_COLUMN_COUNT)
        if (target !== null) {
          gridRef.current?.scrollTo(target.col, target.row, 'both', 0, 0, {
            hAlign: 'center',
            vAlign: 'center',
          })
          requestedFocusRef.current = [target.col, target.row]
          setSelectionState({ layoutAuthority, selection: selectionForCell(target.col, target.row) })
        }
      },
      scrollToColumn(parameterCode) {
        const col = columnScrollIndex(parameterCode, visibleColumns, IDENTITY_COLUMN_COUNT)
        if (col !== null) {
          gridRef.current?.scrollTo(col, 0, 'horizontal', 0, 0, { hAlign: 'start' })
        }
      },
    }),
    [visibleColumns, rows, layoutAuthority],
  )

  return (
    // position: relative 래퍼 — 마우스가 그리드를 벗어나면 툴팁을 확실히 해제(onMouseLeave).
    // (툴팁은 fixed라 이 래퍼가 containing block이 되지는 않는다 — relative는 fixed에 영향 없음.)
    <div style={{ position: 'relative', width: '100%', height: '100%' }} onMouseLeave={() => setTooltip(null)}>
      <DataEditor
        ref={gridRef}
        columns={gridColumns}
        rows={rows.length}
        getCellContent={getCellContent}
        drawCell={drawCell}
        gridSelection={effectiveGridSelection}
        onGridSelectionChange={handleGridSelectionChange}
        onVisibleRegionChanged={scheduleInvalidDraftPopoverRefresh}
        onColumnResizeEnd={scheduleInvalidDraftPopoverRefresh}
        provideEditor={provideInvalidDraftEditor}
        onCellEdited={readOnly ? undefined : handleCellEdited}
        onCellClicked={handleCellClicked}
        onCellContextMenu={handleCellContextMenu}
        onKeyDown={handleGridKeyDown}
        onPaste={handlePaste}
        onItemHovered={handleItemHovered}
        getCellsForSelection
        freezeColumns={IDENTITY_COLUMN_COUNT}
        rowMarkers="none"
        smoothScrollX
        smoothScrollY
        rowHeight={32}
        headerHeight={34}
        width="100%"
        height="100%"
        customRenderers={[decimalCellRenderer, choiceCellRenderer]}
        theme={GLIDE_THEME}
      />
      {tooltip !== null ? (
        <div
          role="tooltip"
          data-testid="header-tooltip"
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            zIndex: 50,
            maxWidth: 280,
            pointerEvents: 'none',
            borderRadius: 6,
            background: GRID_COLORS.ink,
            color: GRID_COLORS.surface,
            padding: '4px 8px',
            fontSize: 12,
            lineHeight: 1.4,
            boxShadow: `0 4px 12px ${GRID_COLORS.border}`,
          }}
        >
          {tooltip.text}
        </div>
      ) : null}
      {activeInvalidDraft !== null && invalidDraftPopover !== null ? (
        <div
          role="alert"
          data-placement={invalidDraftPopover.placement}
          data-anchor-x={invalidDraftPopover.anchor.x}
          data-anchor-y={invalidDraftPopover.anchor.y}
          data-anchor-width={invalidDraftPopover.anchor.width}
          data-anchor-height={invalidDraftPopover.anchor.height}
          style={{
            position: 'fixed',
            left: invalidDraftPopover.x,
            top: invalidDraftPopover.y,
            zIndex: 55,
            width: INVALID_DRAFT_POPOVER_SIZE.width,
            height: INVALID_DRAFT_POPOVER_SIZE.height,
            boxSizing: 'border-box',
            overflow: 'auto',
            pointerEvents: 'none',
            border: `1px solid ${GRID_COLORS.error}`,
            borderRadius: 6,
            background: GRID_COLORS.errorSurface,
            color: GRID_COLORS.ink,
            padding: '8px 10px',
            fontSize: 12,
            lineHeight: 1.4,
            boxShadow: `0 8px 24px ${GRID_COLORS.border}`,
          }}
        >
          <div>{activeInvalidDraft.draft.message}</div>
          {activeInvalidDraft.draft.constraint === null
            ? null
            : <div>{activeInvalidDraft.draft.constraint}</div>}
          <div>입력값은 저장되지 않았습니다</div>
          <div>값을 수정하면 저장됩니다</div>
        </div>
      ) : null}
      {cellHistoryMenu !== null ? (
        <div
          ref={cellHistoryMenuElementRef}
          role="menu"
          aria-label="셀 작업"
          style={{
            position: 'fixed',
            left: cellHistoryMenu.x,
            top: cellHistoryMenu.y,
            zIndex: 60,
            width: CELL_HISTORY_MENU_WIDTH,
            height: CELL_HISTORY_MENU_HEIGHT,
            maxWidth: `calc(100vw - ${CELL_HISTORY_MENU_VIEWPORT_MARGIN * 2}px)`,
            maxHeight: `calc(100vh - ${CELL_HISTORY_MENU_VIEWPORT_MARGIN * 2}px)`,
            overflow: 'auto',
            border: `1px solid ${GRID_COLORS.border}`,
            borderRadius: 6,
            background: GRID_COLORS.surface,
            padding: 4,
            boxShadow: `0 8px 24px ${GRID_COLORS.border}`,
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            ref={cellHistoryMenuItemRef}
            type="button"
            role="menuitem"
            onClick={requestCellHistory}
            onKeyDown={handleCellHistoryMenuKeyDown}
            style={{
              width: '100%',
              border: 0,
              borderRadius: 4,
              background: 'transparent',
              color: GRID_COLORS.ink,
              cursor: 'pointer',
              padding: '7px 10px',
              textAlign: 'left',
            }}
          >
            변경 이력 보기
          </button>
        </div>
      ) : null}
    </div>
  )
})
