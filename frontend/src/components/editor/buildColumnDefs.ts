import type { MutableRefObject } from 'react'
import type { ColDef, CellClassParams, ITooltipParams } from 'ag-grid-community'
import type { ColumnDefinition, DirtyCell } from '@/types'

export interface BuildColumnDefsParams {
  columns: ColumnDefinition[]
  readOnly: boolean
  errorMap: Map<string, { messages: string[]; hasCrossLayer: boolean; hasSingleLayer: boolean }>
  backboneMap: Map<string, unknown>
  dirtyCellsRef: MutableRefObject<Map<string, DirtyCell>>
  recipeCellsRef: MutableRefObject<Set<string>>
  commentMapRef: MutableRefObject<Map<string, number>>
  rejectionCommentMapRef: MutableRefObject<Map<string, boolean>>
  scrollToColumnNameRef: MutableRefObject<string | null | undefined>
}

export function buildColumnDefs(params: BuildColumnDefsParams): ColDef[] {
  const {
    columns,
    readOnly,
    errorMap,
    backboneMap,
    dirtyCellsRef,
    recipeCellsRef,
    commentMapRef,
    rejectionCommentMapRef,
    scrollToColumnNameRef,
  } = params

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
    {
      headerName: 'Step Seq',
      field: 'stepSeq',
      pinned: 'left',
      width: 100,
      editable: false,
      lockPosition: true,
      cellClass: 'text-muted-foreground',
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
      tooltipValueGetter: (tooltipParams: ITooltipParams) => {
        const plId = tooltipParams.data?.projectLayerId
        if (!plId) return undefined
        const bbKey = `${plId}:${col.column_name}`
        const bbVal = backboneMap.get(bbKey)
        const curVal = tooltipParams.value

        const parts: string[] = []

        // Show backbone original
        if (bbVal !== undefined && bbVal !== curVal) {
          parts.push(`Backbone: ${bbVal ?? '(없음)'}`)
        }

        // Show errors (single-layer and cross-layer)
        const errKey = `${tooltipParams.data?.layerId}:${col.column_name}`
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
        // Single-layer error: red (higher priority than cross-layer)
        'bg-cell-error': (cellParams: CellClassParams) => {
          const key = `${cellParams.data?.layerId}:${col.column_name}`
          const errInfo = errorMap.get(key)
          return errInfo?.hasSingleLayer === true
        },
        // Cross-layer only error: orange (shown only when no single-layer error)
        'bg-cell-cross-error': (cellParams: CellClassParams) => {
          const key = `${cellParams.data?.layerId}:${col.column_name}`
          const errInfo = errorMap.get(key)
          return errInfo?.hasCrossLayer === true && errInfo?.hasSingleLayer !== true
        },
        'bg-cell-recipe': (cellParams: CellClassParams) => {
          const plId = cellParams.data?.projectLayerId
          if (!plId) return false
          return recipeCellsRef.current.has(`${plId}:${col.column_name}`)
        },
        'bg-cell-changed': (cellParams: CellClassParams) => {
          const plId = cellParams.data?.projectLayerId
          if (!plId) return false
          const dirtyKey = `${plId}:${col.column_name}`
          if (dirtyCellsRef.current.has(dirtyKey)) return true
          // Also highlight if different from backbone
          const bbKey = `${plId}:${col.column_name}`
          const bbVal = backboneMap.get(bbKey)
          return bbVal !== undefined && bbVal !== cellParams.value
        },
        'bg-cell-rejection-comment': (cellParams: CellClassParams) => {
          const plId = cellParams.data?.projectLayerId
          if (!plId) return false
          const commentKey = `${plId}:${col.column_name}`
          return rejectionCommentMapRef.current.get(commentKey) === true
        },
        'bg-cell-comment': (cellParams: CellClassParams) => {
          const plId = cellParams.data?.projectLayerId
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
      def.valueParser = (valueParams) => {
        if (valueParams.newValue === '' || valueParams.newValue === null) return null
        const num = Number(valueParams.newValue)
        return isNaN(num) ? valueParams.oldValue : num
      }
    }

    return def
  })

  return [...fixed, ...dynamic]
}
