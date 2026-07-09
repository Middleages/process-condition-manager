import type { ReactNode } from 'react'

export type GridValueType = 'text' | 'number' | 'choice' | 'date' | 'boolean'

export interface ConditionGridColumn {
  key: string
  headerName: string
  valueType: GridValueType
  categoryCode?: string | null
  width?: number
  frozen?: boolean
}

export interface ConditionGridRow {
  id: string
  layerKey: string
  conditionId: string
  label: string
  isPor: boolean
  values: Record<string, unknown>
}

export interface PasteRange {
  startRowId: string
  startColumnKey: string
  tsv: string
}

export interface ConditionGridAdapterProps {
  columns: ConditionGridColumn[]
  rows: ConditionGridRow[]
  onCellChange: (rowId: string, columnKey: string, value: unknown) => void
  onPaste: (range: PasteRange) => void
}

export interface ConditionGridAdapter {
  render(props: ConditionGridAdapterProps): ReactNode
}
