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
 * - 셀 상태/스테이징 오버레이: 지금은 themeOverride 렌더 슬롯만 — 데이터 연결은 Phase 3/5.
 */
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react'
import {
  DataEditor,
  GridCellKind,
  type DataEditorRef,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type Item,
  type Theme,
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'

import { choiceCellRenderer, isChoiceCell, makeChoiceCell } from './choiceCell'
import {
  IDENTITY_COLUMN_COUNT,
  IDENTITY_COLUMNS,
  cellScrollTarget,
  columnScrollIndex,
  computeRowGroups,
  formatNumberDisplay,
  indexStaging,
  indexStatuses,
  matrixToTsv,
  overlayKey,
  resolveCellTarget,
  visibleParameterColumns,
} from './model'
import type {
  CellStatus,
  ConditionGridComponent,
  ConditionGridHandle,
  ConditionGridProps,
  PasteStagingCell,
} from './types'

const GROUP_SHADE: Partial<Theme> = { bgCell: '#f8fafc' }
const IDENTITY_THEME: Partial<Theme> = { bgCell: '#f1f5f9' }

/** 셀 상태/스테이징 오버레이 → themeOverride. 스테이징(진행 중 붙여넣기 미리보기)이 우선. */
function overlayTheme(
  status: CellStatus | undefined,
  staging: PasteStagingCell | undefined,
): Partial<Theme> | undefined {
  if (staging !== undefined) {
    return staging.valid ? { bgCell: '#ecfdf5' } : { bgCell: '#fef2f2', textDark: '#b91c1c' }
  }
  if (status !== undefined) {
    switch (status.state) {
      case 'error':
        return { bgCell: '#fef2f2', textDark: '#b91c1c' }
      case 'dirty':
        return { bgCell: '#fffbeb' }
      case 'comment':
        return { bgCell: '#eff6ff' }
    }
  }
  return undefined
}

/** Glide 편집 셀에서 정규화된 도메인 값(문자열|null)을 뽑는다. 빈 값은 null(셀 비우기). */
function editedValue(cell: EditableGridCell): string | null {
  if (cell.kind === GridCellKind.Number) {
    return cell.data === undefined ? null : String(cell.data)
  }
  if (cell.kind === GridCellKind.Custom && isChoiceCell(cell)) {
    const value = cell.data.value.trim()
    return value === '' ? null : value
  }
  if (cell.kind === GridCellKind.Text) {
    const value = cell.data.trim()
    return value === '' ? null : value
  }
  return null
}

export const GlideConditionGrid: ConditionGridComponent = forwardRef<
  ConditionGridHandle,
  ConditionGridProps
>(function GlideConditionGrid({ data, view, callbacks, pasteStaging }, ref) {
  const gridRef = useRef<DataEditorRef>(null)
  const readOnly = view?.readOnly ?? false
  const rows = data.rows

  const visibleColumns = useMemo(
    () => visibleParameterColumns(data.columns, view?.activeCategory),
    [data.columns, view?.activeCategory],
  )
  const groupMeta = useMemo(() => computeRowGroups(rows), [rows])
  const statusIndex = useMemo(() => indexStatuses(data.statuses), [data.statuses])
  const stagingIndex = useMemo(() => indexStaging(pasteStaging), [pasteStaging])

  const gridColumns = useMemo<GridColumn[]>(() => {
    const identity: GridColumn[] = [
      { id: IDENTITY_COLUMNS[0].id, title: IDENTITY_COLUMNS[0].title, width: 190 },
      { id: IDENTITY_COLUMNS[1].id, title: IDENTITY_COLUMNS[1].title, width: 84 },
      { id: IDENTITY_COLUMNS[2].id, title: IDENTITY_COLUMNS[2].title, width: 56 },
    ]
    const params = visibleColumns.map<GridColumn>((column) => ({
      id: column.key,
      title: column.headerName,
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
        // 그룹 첫 행에만 layer 라벨 (row span 없음 — D-16).
        const label = groupMeta.isGroupStart[row] ? rowData.layerLabel : ''
        return {
          kind: GridCellKind.Text,
          data: label,
          displayData: label,
          allowOverlay: false,
          themeOverride: { ...IDENTITY_THEME, textDark: '#0f172a' },
        }
      }
      if (col === 1) {
        return {
          kind: GridCellKind.Text,
          data: rowData.conditionLabel,
          displayData: rowData.conditionLabel,
          allowOverlay: false,
          themeOverride: IDENTITY_THEME,
        }
      }
      if (col === 2) {
        // POR 표식 ●/○ — T2에서는 읽기 전용 표시. 이양(클릭)은 T7이 붙인다.
        const mark = rowData.isPor ? '●' : '○'
        return {
          kind: GridCellKind.Text,
          data: mark,
          displayData: mark,
          allowOverlay: false,
          contentAlign: 'center',
          themeOverride: { ...IDENTITY_THEME, textDark: rowData.isPor ? '#0891b2' : '#94a3b8' },
        }
      }

      // 파라미터 컬럼.
      const column = visibleColumns[col - IDENTITY_COLUMN_COUNT]
      if (column === undefined) {
        return { kind: GridCellKind.Loading, allowOverlay: false }
      }
      const raw = rowData.values[column.key] ?? null
      const overlay = overlayTheme(
        statusIndex.get(overlayKey(rowData.id, column.key)),
        stagingIndex.get(overlayKey(rowData.id, column.key)),
      )
      const oddGroup = groupMeta.groupIndexByRow[row] % 2 === 1
      const base = oddGroup ? GROUP_SHADE : undefined
      const themeOverride = overlay ? { ...base, ...overlay } : base

      if (column.valueType === 'number') {
        const trimmed = raw?.trim() ?? ''
        const numeric = trimmed !== '' && !Number.isNaN(Number(trimmed)) ? Number(trimmed) : undefined
        return {
          kind: GridCellKind.Number,
          data: numeric,
          displayData: formatNumberDisplay(raw, column.unit),
          allowOverlay: !readOnly,
          readonly: readOnly,
          contentAlign: 'right',
          themeOverride,
          copyData: raw ?? '',
        }
      }
      if (column.valueType === 'choice') {
        return makeChoiceCell(raw ?? '', column.choiceOptions ?? [], readOnly, themeOverride)
      }
      // text (및 아직 전용 에디터가 없는 date/boolean) → 텍스트 셀.
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
    [rows, visibleColumns, groupMeta, statusIndex, stagingIndex, readOnly],
  )

  const handleCellEdited = useCallback(
    (item: Item, newValue: EditableGridCell) => {
      const target = resolveCellTarget(item[0], item[1], visibleColumns, rows, IDENTITY_COLUMN_COUNT)
      if (target === null) return
      callbacks?.onCellEdit?.({
        conditionId: target.conditionId,
        parameterCode: target.parameterCode,
        value: editedValue(newValue),
      })
    },
    [visibleColumns, rows, callbacks],
  )

  const handlePaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]): boolean => {
      const cellTarget = resolveCellTarget(target[0], target[1], visibleColumns, rows, IDENTITY_COLUMN_COUNT)
      if (cellTarget !== null) {
        callbacks?.onPaste?.(cellTarget, matrixToTsv(values))
      }
      // 항상 기본 붙여넣기를 막는다 — 실제 적용(스테이징 → 더티 버퍼)은 T4가 담당.
      return false
    },
    [visibleColumns, rows, callbacks],
  )

  useImperativeHandle(
    ref,
    (): ConditionGridHandle => ({
      scrollToCell(conditionId, parameterCode) {
        const target = cellScrollTarget(conditionId, parameterCode, visibleColumns, rows, IDENTITY_COLUMN_COUNT)
        if (target !== null) {
          gridRef.current?.scrollTo(target.col, target.row, 'both', 0, 0, {
            hAlign: 'center',
            vAlign: 'center',
          })
        }
      },
      scrollToColumn(parameterCode) {
        const col = columnScrollIndex(parameterCode, visibleColumns, IDENTITY_COLUMN_COUNT)
        if (col !== null) {
          gridRef.current?.scrollTo(col, 0, 'horizontal', 0, 0, { hAlign: 'start' })
        }
      },
    }),
    [visibleColumns, rows],
  )

  return (
    <DataEditor
      ref={gridRef}
      columns={gridColumns}
      rows={rows.length}
      getCellContent={getCellContent}
      onCellEdited={readOnly ? undefined : handleCellEdited}
      onPaste={handlePaste}
      getCellsForSelection
      freezeColumns={IDENTITY_COLUMN_COUNT}
      rowMarkers="none"
      smoothScrollX
      smoothScrollY
      rowHeight={32}
      headerHeight={34}
      width="100%"
      height="100%"
      customRenderers={[choiceCellRenderer]}
    />
  )
})
