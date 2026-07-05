import type { ReactNode } from 'react'

export interface ConditionGridColumn {
  key: string
  headerName: string
  valueType: 'text' | 'number' | 'choice' | 'date' | 'boolean'
}

export interface ConditionGridRow {
  id: string
  layerKey: string
  values: Record<string, unknown>
}

export interface ConditionGridAdapter {
  render(): ReactNode
}
