import { useMemo, useCallback, useRef, useEffect } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type {
  ColDef,
  CellValueChangedEvent,
  CellClassParams,
  ITooltipParams,
  GridReadyEvent,
  GridApi,
  ProcessDataFromClipboardParams,
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
  onCellChanged: (
    projectLayerId: number,
    columnName: string,
    newValue: unknown,
    oldValue: unknown
  ) => void
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
  onCellChanged,
}: Props) {
  const gridRef = useRef<GridApi | null>(null)
  const dirtyCells = useEditorStore((s) => s.dirtyCells)
  const dirtyCellsRef = useRef(dirtyCells)

  // Build error lookup: `${layerId}:${columnName}` → error message
  const errorMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const err of validationErrors) {
      map.set(`${err.layer_id}:${err.column_name}`, err.message)
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

  // Keep ref in sync with latest dirtyCells
  dirtyCellsRef.current = dirtyCells

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
        editable: true,
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

          // Show error
          const errKey = `${params.data?.layerId}:${col.column_name}`
          const err = errorMap.get(errKey)
          if (err) {
            parts.push(`⚠ ${err}`)
          }

          return parts.length > 0 ? parts.join('\n') : undefined
        },
        cellClassRules: {
          'bg-cell-error': (params: CellClassParams) => {
            const key = `${params.data?.layerId}:${col.column_name}`
            return errorMap.has(key)
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
  }, [columns, backboneMap, errorMap])

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: false,
      resizable: true,
      suppressMovable: true,
    }),
    []
  )

  // Refresh cell styling when dirtyCells change (without rebuilding columnDefs)
  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.refreshCells({ force: true })
    }
  }, [dirtyCells])

  // Scroll to layer when activeLayerId changes
  useEffect(() => {
    if (!gridRef.current || !scrollToLayerId) return
    const layer = layers.find((l) => l.layer_id === scrollToLayerId)
    if (!layer) return
    const rowNode = gridRef.current.getRowNode(String(layer.id))
    if (rowNode?.rowIndex != null) {
      gridRef.current.ensureIndexVisible(rowNode.rowIndex, 'middle')
      gridRef.current.flashCells({ rowNodes: [rowNode] })
    }
  }, [scrollToLayerId, layers])

  const onGridReady = useCallback((params: GridReadyEvent) => {
    gridRef.current = params.api
  }, [])

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
    <div className="ag-theme-alpine flex-1 w-full">
      <AgGridReact
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        onGridReady={onGridReady}
        onCellValueChanged={handleCellValueChanged}
        getRowId={getRowId}
        processDataFromClipboard={processDataFromClipboard}
        onPasteEnd={onPasteEnd}
        enableCellTextSelection
        tooltipShowDelay={300}
        stopEditingWhenCellsLoseFocus
        singleClickEdit
        headerHeight={36}
        rowHeight={32}
      />
    </div>
  )
}
