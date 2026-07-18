import type { ConditionGridColumn, ConditionGridRow } from '@/grid/types'
import {
  validationIssueMessage,
  type ValidationIssuePayload,
  type ValidationSeverity,
} from '@/shared/domain/validation'

import {
  resolveWorkbenchCoordinateNavigation,
  type WorkbenchCoordinateNavigation,
} from './workbenchCoordinateNavigation'

export const VALIDATION_WORKBENCH_MIN_HEIGHT = 180
export const VALIDATION_WORKBENCH_MAX_HEIGHT = 520
export const VALIDATION_WORKBENCH_DEFAULT_HEIGHT = 300
export const VALIDATION_WORKBENCH_RESIZE_STEP = 24

const KNOWN_VALIDATION_ISSUE_CODES = new Set([
  'required',
  'number_malformed',
  'range_min',
  'range_max',
  'pattern_mismatch',
  'choice_unknown',
  'choice_inactive',
  'required_if',
  'value_not_found_in_prior_por',
])
const loggedUnknownValidationIssueCodes = new Set<string>()

export type ValidationDefinitionAvailability = 'ready' | 'pending' | 'unavailable'

interface ValidationDefinitionResourceState {
  readonly loading: boolean
  readonly isStale: boolean
  readonly error: string | null
}

export function resolveValidationDefinitionAvailability({
  projectAvailable,
  projectError,
  resources,
  definitionsAvailable,
}: {
  projectAvailable: boolean
  projectError: unknown
  resources: Iterable<ValidationDefinitionResourceState>
  definitionsAvailable: boolean
}): ValidationDefinitionAvailability {
  const resourceStates = [...resources]
  if (projectError != null || resourceStates.some((resource) => resource.error !== null)) {
    return 'unavailable'
  }
  if (
    !projectAvailable ||
    resourceStates.some(
      (resource) => resource.loading || (resource.isStale && resource.error === null),
    )
  ) {
    return 'pending'
  }
  return definitionsAvailable ? 'ready' : 'unavailable'
}

export interface ValidationWorkbenchIssue {
  readonly key: string
  readonly severity: ValidationSeverity
  readonly severityLabel: '오류' | '경고'
  readonly conditionId: string
  readonly parameterCode: string
  readonly categoryCode: string | null
  readonly layerLabel: string
  readonly conditionLabel: string
  readonly parameterName: string
  readonly currentValue: string | null
  readonly guidance: string
  readonly accessibleDescription: string
}

export interface ValidationWorkbenchState {
  readonly showErrors: boolean
  readonly showWarnings: boolean
  readonly selectedIssueKey: string | null
}

export type ValidationWorkbenchAction =
  | { readonly type: 'toggle-severity'; readonly severity: ValidationSeverity }
  | { readonly type: 'select-issue'; readonly key: string }

export function createValidationWorkbenchState(): ValidationWorkbenchState {
  return { showErrors: true, showWarnings: true, selectedIssueKey: null }
}

export function reduceValidationWorkbenchState(
  state: ValidationWorkbenchState,
  action: ValidationWorkbenchAction,
): ValidationWorkbenchState {
  switch (action.type) {
    case 'toggle-severity':
      return action.severity === 'error'
        ? { ...state, showErrors: !state.showErrors }
        : { ...state, showWarnings: !state.showWarnings }
    case 'select-issue':
      return {
        ...state,
        selectedIssueKey: state.selectedIssueKey === action.key ? null : action.key,
      }
  }
}

export function clampValidationWorkbenchHeight(height: number): number {
  return Math.min(
    VALIDATION_WORKBENCH_MAX_HEIGHT,
    Math.max(VALIDATION_WORKBENCH_MIN_HEIGHT, Math.round(height)),
  )
}

export function shouldMountValidationWorkbench(
  issues: readonly unknown[],
  explicitValidationCompleted: boolean,
): boolean {
  return issues.length > 0 || explicitValidationCompleted
}

export function shouldAutoOpenValidationWorkbench(
  previousIssueCount: number,
  currentIssueCount: number,
  hasActiveMode: boolean,
): boolean {
  return previousIssueCount === 0 && currentIssueCount > 0 && !hasActiveMode
}

export function filterValidationWorkbenchIssues(
  issues: readonly ValidationWorkbenchIssue[],
  state: Pick<ValidationWorkbenchState, 'showErrors' | 'showWarnings'>,
): ValidationWorkbenchIssue[] {
  return issues.filter(
    (issue) =>
      (issue.severity === 'error' && state.showErrors) ||
      (issue.severity === 'warning' && state.showWarnings),
  )
}

/** Joins only current adapted rows/columns; raw issue details never enter the rendered view model. */
export function enrichValidationIssues(
  issues: readonly ValidationIssuePayload[],
  columns: readonly ConditionGridColumn[],
  rows: readonly ConditionGridRow[],
  logUnknownCode: (code: string) => void = logUnknownValidationIssueCode,
): ValidationWorkbenchIssue[] {
  const columnsByCode = new Map(columns.map((column) => [column.key, column]))
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const parameterNames = Object.fromEntries(
    columns.map((column) => [column.key, column.headerName]),
  )

  const reportedUnknownCodes = new Set<string>()

  return issues.map((issue) => {
    if (
      !KNOWN_VALIDATION_ISSUE_CODES.has(issue.code) &&
      !reportedUnknownCodes.has(issue.code)
    ) {
      reportedUnknownCodes.add(issue.code)
      logUnknownCode(issue.code)
    }
    const conditionId = String(issue.condition_id)
    const row = rowsById.get(conditionId)
    const column = columnsByCode.get(issue.parameter_code)
    const severityLabel = issue.severity === 'error' ? '오류' : '경고'
    const layerLabel = row?.layerLabel ?? issue.layer_key
    const conditionLabel = row?.conditionLabel ?? `조건 #${conditionId}`
    const parameterName = column?.headerName ?? issue.parameter_code
    const currentValue = row?.values[issue.parameter_code] ?? null
    const guidance = validationIssueMessage(issue, parameterNames)
    const currentValueDescription =
      currentValue === null || currentValue === '' ? '' : ` 현재 값 ${currentValue}.`

    return {
      key: issue.key,
      severity: issue.severity,
      severityLabel,
      conditionId,
      parameterCode: issue.parameter_code,
      categoryCode: column?.categoryCode ?? null,
      layerLabel,
      conditionLabel,
      parameterName,
      currentValue,
      guidance,
      accessibleDescription: `${severityLabel}. ${layerLabel} ${conditionLabel}. ${parameterName}.${currentValueDescription} ${guidance}`,
    }
  })
}

export type ValidationIssueNavigation = WorkbenchCoordinateNavigation

/** Resolves domain coordinates only. React commit ordering and the grid library stay with callers. */
export function resolveValidationIssueNavigation(
  issue:
    | Pick<ValidationIssuePayload, 'condition_id' | 'parameter_code'>
    | Pick<ValidationWorkbenchIssue, 'conditionId' | 'parameterCode'>,
  columns: readonly ConditionGridColumn[],
  rows: readonly ConditionGridRow[],
  activeCategory: string | null,
): ValidationIssueNavigation {
  const coordinate =
    'conditionId' in issue
      ? {
          conditionId: issue.conditionId,
          parameterCode: issue.parameterCode,
        }
      : {
          conditionId: issue.condition_id,
          parameterCode: issue.parameter_code,
        }

  return resolveWorkbenchCoordinateNavigation(coordinate, columns, rows, activeCategory)
}

export function isValidationTileActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' '
}

export function handleValidationTileActivationKey(
  key: string,
  repeat: boolean,
  preventDefault: () => void,
  activate: () => void,
): void {
  if (!isValidationTileActivationKey(key)) return
  preventDefault()
  if (repeat) return
  activate()
}

function logUnknownValidationIssueCode(code: string): void {
  if (loggedUnknownValidationIssueCodes.has(code)) return
  loggedUnknownValidationIssueCodes.add(code)
  console.warn(`[validation] unknown issue code: ${code}`)
}
