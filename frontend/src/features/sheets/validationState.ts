import type { ValidationSummaryOut } from '@/api/types'
import { overlayKey } from '@/grid/model'
import type { CellStatus } from '@/grid/types'
import {
  evaluateProject,
  ValidationConfigurationError,
  validationIssueMessage,
  type ValidationInput,
  type ValidationIssuePayload,
} from '@/shared/domain/validation'

export const VALIDATION_DEFINITIONS_FAILURE =
  '검증 규칙을 불러오지 못했습니다. 관리자에게 확인을 요청해 주세요.'
export const VALIDATION_PERSISTENCE_GUIDANCE = '저장 후 검증해 주세요.'
export const VALIDATION_SERVER_FAILURE = '최신 상태 확인 실패 · 다시 시도'

export type ProvisionalValidationState =
  | {
      readonly status: 'ready'
      readonly issues: readonly ValidationIssuePayload[]
      readonly summary: ValidationSummaryOut
      readonly failure: null
    }
  | {
      readonly status: 'unavailable'
      readonly issues: readonly []
      readonly summary: null
      readonly failure: string
    }

export function summarizeIssues(
  issues: readonly Pick<ValidationIssuePayload, 'severity'>[],
): ValidationSummaryOut {
  let errorCount = 0
  let warningCount = 0
  for (const issue of issues) {
    if (issue.severity === 'error') errorCount += 1
    else warningCount += 1
  }
  return { error_count: errorCount, warning_count: warningCount }
}

/** Configuration/definition failure is a distinct unavailable state, never an empty green result. */
export function evaluateProvisional(input: ValidationInput | null): ProvisionalValidationState {
  if (input === null) return unavailableProvisional()
  try {
    const issues = evaluateProject(input)
    return {
      status: 'ready',
      issues,
      summary: summarizeIssues(issues),
      failure: null,
    }
  } catch (error) {
    if (error instanceof ValidationConfigurationError) return unavailableProvisional()
    throw error
  }
}

function unavailableProvisional(): ProvisionalValidationState {
  return {
    status: 'unavailable',
    issues: [],
    summary: null,
    failure: VALIDATION_DEFINITIONS_FAILURE,
  }
}

export interface DirtyStatusFact {
  readonly conditionId: string
  readonly parameterCode: string
}

export interface CommentStatusFact extends DirtyStatusFact {
  readonly count: number
}

export interface AuthoritativeValidationConfirmation {
  readonly basisHash: string
  readonly definitionAuthority: symbol
  readonly evaluatedAt: string
  readonly persistedGeneration: number
}

export interface EffectiveValidationState {
  readonly authority: 'authoritative' | 'provisional' | 'unavailable'
  readonly issues: readonly ValidationIssuePayload[]
  readonly summary: ValidationSummaryOut | null
}

/** Server wins only for the exact clean persisted generation and a usable matching definition. */
export function selectEffectiveValidation({
  provisional,
  authoritativeIssues,
  authoritativeSummary,
  authoritativeConfirmation,
  currentBasisHash,
  currentDefinitionAuthority,
  currentPersistedGeneration,
  persistenceIdle,
}: {
  provisional: ProvisionalValidationState
  authoritativeIssues: readonly ValidationIssuePayload[]
  authoritativeSummary: ValidationSummaryOut | null
  authoritativeConfirmation: AuthoritativeValidationConfirmation | null
  currentBasisHash: string
  currentDefinitionAuthority: symbol
  currentPersistedGeneration: number
  persistenceIdle: boolean
}): EffectiveValidationState {
  if (provisional.status === 'unavailable') {
    return { authority: 'unavailable', issues: [], summary: null }
  }
  if (
    persistenceIdle &&
    authoritativeSummary !== null &&
    authoritativeConfirmation?.basisHash === currentBasisHash &&
    authoritativeConfirmation.definitionAuthority === currentDefinitionAuthority &&
    authoritativeConfirmation.persistedGeneration === currentPersistedGeneration
  ) {
    return {
      authority: 'authoritative',
      issues: authoritativeIssues,
      summary: authoritativeSummary,
    }
  }
  return {
    authority: 'provisional',
    issues: provisional.issues,
    summary: provisional.summary,
  }
}

export function buildCellStatuses({
  issues,
  dirtyCells,
  comments = [],
  parameterNames,
}: {
  issues: readonly ValidationIssuePayload[]
  dirtyCells: Iterable<DirtyStatusFact>
  comments?: Iterable<CommentStatusFact>
  parameterNames: Readonly<Record<string, string>>
}): CellStatus[] {
  const statuses = new Map<string, CellStatus>()

  for (const issue of issues) {
    const conditionId = String(issue.condition_id)
    const key = overlayKey(conditionId, issue.parameter_code)
    const current = statuses.get(key)
    const message = validationIssueMessage(issue, parameterNames)
    const previous = current?.validation
    const replaceMessage =
      previous === undefined ||
      (previous.severity === 'warning' && issue.severity === 'error')
    statuses.set(key, {
      conditionId,
      parameterCode: issue.parameter_code,
      validation: {
        severity:
          previous?.severity === 'error' || issue.severity === 'error' ? 'error' : 'warning',
        count: (previous?.count ?? 0) + 1,
        message: replaceMessage ? message : previous.message,
      },
      dirty: current?.dirty ?? false,
      ...(current?.commentCount === undefined ? {} : { commentCount: current.commentCount }),
    })
  }

  for (const dirty of dirtyCells) {
    const key = overlayKey(dirty.conditionId, dirty.parameterCode)
    const current = statuses.get(key)
    statuses.set(key, {
      conditionId: dirty.conditionId,
      parameterCode: dirty.parameterCode,
      ...(current?.validation === undefined ? {} : { validation: current.validation }),
      dirty: true,
      ...(current?.commentCount === undefined ? {} : { commentCount: current.commentCount }),
    })
  }

  for (const comment of comments) {
    if (comment.count <= 0) continue
    const key = overlayKey(comment.conditionId, comment.parameterCode)
    const current = statuses.get(key)
    statuses.set(key, {
      conditionId: comment.conditionId,
      parameterCode: comment.parameterCode,
      ...(current?.validation === undefined ? {} : { validation: current.validation }),
      dirty: current?.dirty ?? false,
      commentCount: comment.count,
    })
  }

  return [...statuses.values()]
}
