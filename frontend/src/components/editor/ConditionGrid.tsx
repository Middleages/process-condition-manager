import { useMemo, useCallback, useRef, useEffect, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type {
  ColDef,
  CellValueChangedEvent,
  GridReadyEvent,
  GridApi,
  ProcessDataFromClipboardParams,
  CellContextMenuEvent,
  RowClassParams,
} from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useEditorStore } from '@/stores/useEditorStore'
import type {
  ColumnDefinition,
  ProjectLayerData,
  ValidationError,
  GridRowData,
} from '@/types'
import type { EquipmentOption } from './EquipmentAutocompleteEditor'
import { GridContextMenu } from './GridContextMenu'
import { buildColumnDefs } from './buildColumnDefs'

interface Props {
  layers: ProjectLayerData[]
  columns: ColumnDefinition[]
  validationErrors: ValidationError[]
  scrollToLayerId: string | null
  scrollToColumnName?: string | null
  readOnly?: boolean
  commentMap?: Map<string, number>
  rejectionCommentMap?: Map<string, boolean>
  projectStatus?: string
  // 다중 역할 배열로 전환
  currentUserRoles?: string[]
  equipments?: EquipmentOption[]
  onGridReady?: (api: GridApi) => void
  onCellChanged: (
    projectLayerId: number,
    columnName: string,
    newValue: unknown,
    oldValue: unknown
  ) => void
  onCellRightClick?: (
    projectLayerId: number,
    layerName: string,
    columnName: string,
    columnDisplayName: string
  ) => void
  onViewHistory?: (projectLayerId: number, layerName: string, columnName: string) => void
}

function buildRowData(layers: ProjectLayerData[]): GridRowData[] {
  return layers.map((layer) => ({
    projectLayerId: layer.id,
    layerId: layer.layer_id,
    layerName: layer.layer_name,
    stepSeq: layer.step_seq,
    layerNumber: layer.layer_number,
    sortOrder: layer.sort_order,
    backboneProductName: layer.backbone_condition_name,
    ...layer.conditions,
  }))
}

export function ConditionGrid({
  layers,
  columns,
  validationErrors,
  scrollToLayerId,
  scrollToColumnName,
  readOnly = false,
  commentMap = new Map(),
  rejectionCommentMap = new Map(),
  projectStatus,
  currentUserRoles,
  equipments,
  onGridReady: onGridReadyProp,
  onCellChanged,
  onCellRightClick,
  onViewHistory,
}: Props) {
  const gridRef = useRef<GridApi | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    projectLayerId: number
    layerName: string
    columnName: string
    columnDisplayName: string
  } | null>(null)
  const dirtyCells = useEditorStore((s) => s.dirtyCells)
  const recipeCells = useEditorStore((s) => s.recipeCells)
  const dirtyCellsRef = useRef(dirtyCells)
  const recipeCellsRef = useRef(recipeCells)
  const commentMapRef = useRef(commentMap)
  const rejectionCommentMapRef = useRef(rejectionCommentMap)
  const scrollToColumnNameRef = useRef(scrollToColumnName)

  // 오류 조회 맵: `${layerId}:${columnName}` → { messages: string[], hasCrossLayer: boolean, hasSingleLayer: boolean }
  // 단일 셀에 여러 오류(단일 레이어 + 크로스 레이어)가 공존할 수 있으므로 타입별로 구분
  const errorMap = useMemo(() => {
    const map = new Map<string, { messages: string[]; hasCrossLayer: boolean; hasSingleLayer: boolean }>()
    for (const err of validationErrors) {
      const key = `${err.layer_id}:${err.column_name}`
      const existing = map.get(key)
      const isCross = err.rule_type === 'cross_layer'
      if (existing) {
        existing.messages.push(err.message)
        if (isCross) existing.hasCrossLayer = true
        else existing.hasSingleLayer = true
      } else {
        map.set(key, {
          messages: [err.message],
          hasCrossLayer: isCross,
          hasSingleLayer: !isCross,
        })
      }
    }
    return map
  }, [validationErrors])

  // Build backbone lookup: `${projectLayerId}:${columnName}` → backbone value
  const backboneMap = useMemo(() => {
    const map = new Map<string, unknown>()
    for (const layer of layers) {
      for (const [key, val] of Object.entries(layer.backbone_conditions)) {
        map.set(`${layer.id}:${key}`, val)
      }
    }
    return map
  }, [layers])

  // Keep refs in sync
  dirtyCellsRef.current = dirtyCells
  recipeCellsRef.current = recipeCells
  commentMapRef.current = commentMap
  rejectionCommentMapRef.current = rejectionCommentMap
  scrollToColumnNameRef.current = scrollToColumnName

  const rowData = useMemo(() => buildRowData(layers), [layers])

  const columnDefs = useMemo<ColDef[]>(
    () =>
      buildColumnDefs({
        columns,
        readOnly,
        errorMap,
        backboneMap,
        dirtyCellsRef,
        recipeCellsRef,
        commentMapRef,
        rejectionCommentMapRef,
        scrollToColumnNameRef,
        equipments,
      }),
    [columns, backboneMap, errorMap, readOnly, equipments]
  )

  const handleCellContextMenu = useCallback(
    (event: CellContextMenuEvent) => {
      const { data, colDef } = event
      if (!data?.projectLayerId || !colDef?.field || colDef.field === 'layerName' || colDef.field === 'stepSeq') return

      event.event?.preventDefault()

      const col = columns.find(c => c.column_name === colDef.field)
      const displayName = col ? (col.unit ? `${col.display_name} (${col.unit})` : col.display_name) : colDef.field

      const mouseEvent = event.event as MouseEvent
      const menuWidth = 180
      const menuHeight = 80
      const x = Math.min(mouseEvent.clientX, window.innerWidth - menuWidth)
      const y = Math.min(mouseEvent.clientY, window.innerHeight - menuHeight)
      setContextMenu({
        x,
        y,
        projectLayerId: data.projectLayerId,
        layerName: data.layerName,
        columnName: colDef.field,
        columnDisplayName: displayName,
      })
    },
    [columns]
  )

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: false,
      resizable: true,
      suppressMovable: true,
    }),
    []
  )

  // Refresh cell styling when dirtyCells or recipeCells change
  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.refreshCells({ force: true })
    }
  }, [dirtyCells, recipeCells])

  // Refresh cells when commentMap or rejectionCommentMap changes
  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.refreshCells({ force: true })
    }
  }, [commentMap, rejectionCommentMap])

  // Scroll to layer (and optionally column) when active selection changes
  useEffect(() => {
    if (!gridRef.current || !scrollToLayerId) return
    const layer = layers.find((l) => l.layer_id === scrollToLayerId)
    if (!layer) return
    const rowNode = gridRef.current.getRowNode(String(layer.id))
    if (rowNode?.rowIndex != null) {
      gridRef.current.ensureIndexVisible(rowNode.rowIndex, 'middle')

      if (scrollToColumnName) {
        gridRef.current.ensureColumnVisible(scrollToColumnName)
        gridRef.current.setFocusedCell(rowNode.rowIndex, scrollToColumnName)
      }
    }
    // Redraw rows and refresh cells so active row/column classes are re-evaluated
    gridRef.current.redrawRows()
    gridRef.current.refreshCells({ force: true })
  }, [scrollToLayerId, scrollToColumnName, layers])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = () => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [contextMenu])

  const onGridReady = useCallback((params: GridReadyEvent) => {
    gridRef.current = params.api
    onGridReadyProp?.(params.api)
  }, [onGridReadyProp])

  const handleCellValueChanged = useCallback(
    (event: CellValueChangedEvent) => {
      const { data, colDef, newValue, oldValue } = event
      if (colDef.field && data.projectLayerId) {
        onCellChanged(data.projectLayerId, colDef.field, newValue, oldValue)
      }
    },
    [onCellChanged]
  )

  const getRowId = useCallback(
    (params: { data: GridRowData }) => String(params.data.projectLayerId),
    []
  )

  // Apply persistent highlight class to the active layer row
  const getRowClass = useCallback(
    (params: RowClassParams) => {
      if (scrollToLayerId != null && params.data?.layerId === scrollToLayerId) {
        return 'ag-row-active-layer'
      }
      return undefined
    },
    [scrollToLayerId]
  )

  // Handle multi-cell paste from Excel/spreadsheet (tab-separated values)
  const processDataFromClipboard = useCallback(
    (params: ProcessDataFromClipboardParams): string[][] | null => {
      const { data } = params
      if (!data || data.length === 0) return null

      // AG Grid Community passes clipboard data as string[][]
      // Each inner array is a row, values are tab-separated cells
      // We return the data as-is, AG Grid will apply it starting from the focused cell
      return data
    },
    []
  )

  // Handle paste event to trigger onCellChanged for pasted cells
  const onPasteEnd = useCallback(() => {
    if (!gridRef.current) return
    // After paste, AG Grid fires CellValueChanged for each cell,
    // which is already handled by handleCellValueChanged
    // We just need to refresh cells to update styling
    gridRef.current.refreshCells({ force: true })
  }, [])

  return (
    <div className="ag-theme-alpine flex-1 w-full relative" aria-label="공정조건 데이터 테이블">
      <AgGridReact
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        onGridReady={onGridReady}
        onCellValueChanged={handleCellValueChanged}
        onCellContextMenu={handleCellContextMenu}
        getRowId={getRowId}
        getRowClass={getRowClass}
        processDataFromClipboard={processDataFromClipboard}
        onPasteEnd={onPasteEnd}
        enableCellTextSelection
        tooltipShowDelay={300}
        stopEditingWhenCellsLoseFocus
        singleClickEdit
        headerHeight={36}
        rowHeight={32}
        suppressContextMenu={true}
        preventDefaultOnContextMenu={true}
      />

      {/* Custom Context Menu */}
      {contextMenu && (
        <GridContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          projectLayerId={contextMenu.projectLayerId}
          layerName={contextMenu.layerName}
          columnName={contextMenu.columnName}
          columnDisplayName={contextMenu.columnDisplayName}
          projectStatus={projectStatus}
          currentUserRoles={currentUserRoles}
          onViewHistory={onViewHistory}
          onAddComment={onCellRightClick}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
