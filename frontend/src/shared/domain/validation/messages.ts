import type { IssueDetailValue, ValidationIssuePayload } from './types'

const UNKNOWN_ISSUE_MESSAGE = '입력 조건을 확인해 주세요.'

export function validationIssueMessage(
  issue: ValidationIssuePayload,
  parameterNames: Readonly<Record<string, string>>,
): string {
  const parameterName = displayName(parameterNames, issue.parameter_code)

  switch (issue.code) {
    case 'required':
      return `${parameterName} 값을 입력해 주세요.`
    case 'number_malformed':
      return `${parameterName}에 올바른 숫자를 입력해 주세요.`
    case 'range_min':
    case 'range_max':
      return rangeMessage(issue, parameterName)
    case 'pattern_mismatch': {
      const hint = stringDetail(issue, 'pattern_hint')
      return hint === null ? `${parameterName} 형식을 확인해 주세요.` : `${hint} 형식으로 입력해 주세요.`
    }
    case 'choice_unknown':
      return `${parameterName}에서 사용할 수 있는 선택지를 다시 선택해 주세요.`
    case 'choice_inactive':
      return '현재 값은 비활성 선택지입니다. 승인에는 영향을 주지 않지만 새로 선택할 수 없습니다.'
    case 'required_if': {
      const equals = stringDetail(issue, 'equals')
      const requiredCode = stringDetail(issue, 'required_parameter_code')
      const whenCode = stringDetail(issue, 'when_parameter_code')
      if (equals === null || requiredCode === null || whenCode === null) return UNKNOWN_ISSUE_MESSAGE
      const whenName = displayName(parameterNames, whenCode)
      const requiredName = displayName(parameterNames, requiredCode)
      return `${whenName}가 ${equals}이면 ${requiredName} 값을 입력해 주세요.`
    }
    case 'value_not_found_in_prior_por': {
      const candidateCode = stringDetail(issue, 'candidate_parameter_code')
      if (candidateCode === null) return UNKNOWN_ISSUE_MESSAGE
      const candidateName = displayName(parameterNames, candidateCode)
      return `이 값은 앞선 레이어의 ${candidateName} 값에 먼저 있어야 합니다. 앞선 POR 값을 추가하거나 현재 값을 수정해 주세요.`
    }
    default:
      return UNKNOWN_ISSUE_MESSAGE
  }
}

function rangeMessage(issue: ValidationIssuePayload, parameterName: string): string {
  const minimum = nullableStringDetail(issue, 'min_value')
  const maximum = nullableStringDetail(issue, 'max_value')
  if (minimum.kind === 'invalid' || maximum.kind === 'invalid') return UNKNOWN_ISSUE_MESSAGE
  if (minimum.value !== null && maximum.value !== null) {
    return `${parameterName}은 ${minimum.value} 이상 ${maximum.value} 이하로 입력해 주세요.`
  }
  if (issue.code === 'range_min' && minimum.value !== null) {
    return `${parameterName}은 ${minimum.value} 이상으로 입력해 주세요.`
  }
  if (issue.code === 'range_max' && maximum.value !== null) {
    return `${parameterName}은 ${maximum.value} 이하로 입력해 주세요.`
  }
  return UNKNOWN_ISSUE_MESSAGE
}

function stringDetail(issue: ValidationIssuePayload, key: string): string | null {
  const value = issue.details[key]
  return typeof value === 'string' && value !== '' ? value : null
}

function nullableStringDetail(
  issue: ValidationIssuePayload,
  key: string,
): { readonly kind: 'valid'; readonly value: string | null } | { readonly kind: 'invalid' } {
  const value: IssueDetailValue | undefined = issue.details[key]
  return value === null || typeof value === 'string'
    ? { kind: 'valid', value }
    : { kind: 'invalid' }
}

function displayName(parameterNames: Readonly<Record<string, string>>, code: string): string {
  return parameterNames[code] ?? code
}
