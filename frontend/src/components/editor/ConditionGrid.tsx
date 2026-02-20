import { useMemo, useCallback, useRef, useEffect, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type {
  ColDef,
  CellValueChangedEvent,
  CellClassParams,
  ITooltipParams,
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

interface Props {
  layers: ProjectLayerData[]
  columns: ColumnDefinition[]
  validationErrors: ValidationError[]
  scrollToLayerId: number | null
  scrollToColumnName?: string | null
  readOnly?: boolean
  commentMap?: Map<string, number>
  rejectionCommentMap?: Map<string, boolean>
  projectStatus?: string
  currentUserRole?: string
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
    backboneProductName: layer.backbone_product_name,
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
  currentUserRole,
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

  const columnDefs = useMemo<ColDef[]>(() => {
    const fixed: ColDef[] = [
      {
        headerName: 'Layer',
        field: 'layerName',
        pinned: 'left',
        width: 140,
        editable: false,
        lockPosition: true,
        cellClass: 'font-medium',
      },
    ]

    const dynamic: ColDef[] = columns.map((col) => {
      const def: ColDef = {
        headerName: col.unit
          ? `${col.display_name} (${col.unit})`
          : col.display_name,
        field: col.column_name,
        editable: !readOnly,
        width: 120,
        tooltipValueGetter: (params: ITooltipParams) => {
          const plId = params.data?.projectLayerId
          if (!plId) return undefined
          const bbKey = `${plId}:${col.column_name}`
          const bbVal = backboneMap.get(bbKey)
          const curVal = params.value

          const parts: string[] = []

          // Show backbone original
          if (bbVal !== undefined && bbVal !== curVal) {
            parts.push(`Backbone: ${bbVal ?? '(없음)'}`)
          }

          // 오류 메시지 표시 (단일 레이어 및 크로스 레이어 오류 모두 포함)
          const errKey = `${params.data?.layerId}:${col.column_name}`
          const errInfo = errorMap.get(errKey)
          if (errInfo) {
            for (const msg of errInfo.messages) {
              parts.push(`⚠ ${msg}`)
            }
          }

          // Show comment info
          const commentKey = `${plId}:${col.column_name}`
          const commentCount = commentMapRef.current.get(commentKey)
          if (commentCount && commentCount > 0) {
            parts.push(`Comments: ${commentCount}`)
          }

          return parts.length > 0 ? parts.join('\n') : undefined
        },
        cellClassRules: {
          // 단일 레이어 오류: 빨간색 (크로스 레이어보다 우선순위 높음)
          'bg-cell-error': (params: CellClassParams) => {
            const key = `${params.data?.layerId}:${col.column_name}`
            const errInfo = errorMap.get(key)
            return errInfo?.hasSingleLayer === true
          },
          // 크로스 레이어 전용 오류: 주황색 (단일 레이어 오류가 없는 경우에만 표시)
          'bg-cell-cross-error': (params: CellClassParams) => {
            const key = `${params.data?.layerId}:${col.column_name}`
            const errInfo = errorMap.get(key)
            return errInfo?.hasCrossLayer === true && errInfo?.hasSingleLayer !== true
          },
          'bg-cell-recipe': (params: CellClassParams) => {
            const plId = params.data?.projectLayerId
            if (!plId) return false
            return recipeCellsRef.current.has(`${plId}:${col.column_name}`)
          },
          'bg-cell-changed': (params: CellClassParams) => {
            const plId = params.data?.projectLayerId
            if (!plId) return false
            const dirtyKey = `${plId}:${col.column_name}`
            if (dirtyCellsRef.current.has(dirtyKey)) return true
            // Also highlight if different from backbone
            const bbKey = `${plId}:${col.column_name}`
            const bbVal = backboneMap.get(bbKey)
            return bbVal !== undefined && bbVal !== params.value
          },
          'bg-cell-rejection-comment': (params: CellClassParams) => {
            const plId = params.data?.projectLayerId
            if (!plId) return false
            const commentKey = `${plId}:${col.column_name}`
            return rejectionCommentMapRef.current.get(commentKey) === true
          },
          'bg-cell-comment': (params: CellClassParams) => {
            const plId = params.data?.projectLayerId
            if (!plId) return false
            const commentKey = `${plId}:${col.column_name}`
            const hasComment = commentMapRef.current.has(commentKey) && (commentMapRef.current.get(commentKey) ?? 0) > 0
            const hasRejectionComment = rejectionCommentMapRef.current.get(commentKey) === true
            // Only apply comment marker if there's no rejection comment (to avoid duplicate markers)
            return hasComment && !hasRejectionComment
          },
          'ag-cell-active-column': () => {
            return scrollToColumnNameRef.current === col.column_name
          },
        },
      }

      // Type-specific cell editor
      if (col.data_type === 'select' && col.select_options) {
        def.cellEditor = 'agSelectCellEditor'
        def.cellEditorParams = {
          values: col.select_options,
        }
      } else if (col.data_type === 'integer' || col.data_type === 'float') {
        def.cellEditor = 'agTextCellEditor'
        def.valueParser = (params) => {
          if (params.newValue === '' || params.newValue === null) return null
          const num = Number(params.newValue)
          return isNaN(num) ? params.oldValue : num
        }
      }

      return def
    })

    return [...fixed, ...dynamic]
  }, [columns, backboneMap, errorMap, readOnly])

  const handleCellContextMenu = useCallback(
    (event: CellContextMenuEvent) => {
      const { data, colDef } = event
      if (!data?.projectLayerId || !colDef?.field || colDef.field === 'layerName') return

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
    <div className="ag-theme-alpine flex-1 w-full relative">
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
        <div
          className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 flex items-center gap-2"
            onClick={() => {
              onViewHistory?.(contextMenu.projectLayerId, contextMenu.layerName, contextMenu.columnName)
              setContextMenu(null)
            }}
          >
            <span className="text-gray-500">&#128203;</span>
            View History
          </button>
          {projectStatus === 'review' && (currentUserRole === 'reviewer' || currentUserRole === 'admin') && (
            <button
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 flex items-center gap-2"
              onClick={() => {
                onCellRightClick?.(contextMenu.projectLayerId, contextMenu.layerName, contextMenu.columnName, contextMenu.columnDisplayName)
                setContextMenu(null)
              }}
            >
              <span className="text-gray-500">&#128172;</span>
              Add Comment
            </button>
          )}
        </div>
      )}
    </div>
  )
}
