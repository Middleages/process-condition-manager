import type { ConditionGridColumn, ConditionGridRow } from '@/grid/types'

export type WorkbenchCoordinate = {
  readonly conditionId: string | number | null
  readonly parameterCode: string | number | null
}

export type WorkbenchCoordinateNavigation =
  | { readonly kind: 'missing-target' }
  | { readonly kind: 'direct'; readonly target: WorkbenchCoordinate }
  | {
      readonly kind: 'reveal-category'
      readonly categoryCode: string | null
      readonly target: WorkbenchCoordinate
    }

export function resolveWorkbenchCoordinateNavigation(
  coordinate: WorkbenchCoordinate,
  columns: readonly ConditionGridColumn[],
  rows: readonly ConditionGridRow[],
  activeCategory: string | null,
): WorkbenchCoordinateNavigation {
  if (coordinate.conditionId === null || coordinate.parameterCode === null) {
    return { kind: 'missing-target' }
  }

  const conditionId = String(coordinate.conditionId)
  const parameterCode = String(coordinate.parameterCode)
  const column = columns.find((candidate) => candidate.key === parameterCode)
  if (column === undefined || !rows.some((row) => row.id === conditionId)) {
    return { kind: 'missing-target' }
  }

  const target = { conditionId, parameterCode: column.key }
  const visible =
    column.categoryCode === null || activeCategory === null || column.categoryCode === activeCategory
  return visible
    ? { kind: 'direct', target }
    : { kind: 'reveal-category', categoryCode: column.categoryCode, target }
}
