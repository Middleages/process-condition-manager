import type { ConditionGridColumn, ConditionGridRow } from '@/grid/types'
import type { ValidationIssuePayload } from '@/shared/domain/validation'

export type WorkbenchCoordinate = {
  readonly conditionId: string
  readonly parameterCode: string
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
  coordinate:
    | Pick<ValidationIssuePayload, 'condition_id' | 'parameter_code'>
    | Pick<WorkbenchCoordinate, 'conditionId' | 'parameterCode'>,
  columns: readonly ConditionGridColumn[],
  rows: readonly ConditionGridRow[],
  activeCategory: string | null,
): WorkbenchCoordinateNavigation {
  const conditionId =
    'conditionId' in coordinate ? coordinate.conditionId : String(coordinate.condition_id)
  const parameterCode =
    'parameterCode' in coordinate ? coordinate.parameterCode : coordinate.parameter_code
  const column = columns.find((candidate) => candidate.key === parameterCode)
  if (column === undefined || !rows.some((row) => row.id === conditionId)) {
    return { kind: 'missing-target' }
  }

  const target = { conditionId, parameterCode: column.key }
  const visible = activeCategory === null || column.categoryCode === activeCategory
  return visible
    ? { kind: 'direct', target }
    : { kind: 'reveal-category', categoryCode: column.categoryCode, target }
}
