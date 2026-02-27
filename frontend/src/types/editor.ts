// ========== Editor UI State ==========
export interface DirtyCell {
  projectLayerId: number
  columnName: string
  value: unknown
  originalValue: unknown
}

export type DirtyCellMap = Map<string, DirtyCell> // key: `${projectLayerId}:${columnName}`

export interface GridRowData {
  projectLayerId: number
  layerId: string
  layerName: string
  stepSeq: string
  layerNumber: string
  sortOrder: number
  backboneProductName: string | null
  [columnName: string]: unknown // dynamic condition columns
}
