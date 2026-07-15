import { describe, expect, it } from 'vitest'

import { validationIssueMessage } from './messages'
import type { ValidationIssue, ValidationIssuePayload } from './types'

const parameterNames = {
  amount: '노광량',
  equipment: '장비',
  previous_mask: '이전 마스크',
  use_equipment: '사용 여부',
}

describe('validation issue messages', () => {
  it('maps required and inclusive range issues to actionable Korean', () => {
    expect(validationIssueMessage(issue('required', 'amount'), parameterNames)).toBe(
      '노광량 값을 입력해 주세요.',
    )
    expect(
      validationIssueMessage(
        issue('range_min', 'amount', { max_value: '20', min_value: '10' }),
        parameterNames,
      ),
    ).toBe('노광량은 10 이상 20 이하로 입력해 주세요.')
  })

  it('uses only the allowlisted pattern hint and never raw pattern or server text', () => {
    const message = validationIssueMessage(
      issue('pattern_mismatch', 'amount', {
        pattern_hint: '영문 대문자 2자리-숫자 4자리',
        pattern: 'RAW_SECRET_PATTERN',
        message: 'RAW_SERVER_MESSAGE',
      }),
      parameterNames,
    )

    expect(message).toBe('영문 대문자 2자리-숫자 4자리 형식으로 입력해 주세요.')
    expect(message).not.toContain('RAW_SECRET_PATTERN')
    expect(message).not.toContain('RAW_SERVER_MESSAGE')
  })

  it('resolves typed relation detail codes through parameter display names', () => {
    expect(
      validationIssueMessage(
        issue('required_if', 'equipment', {
          equals: 'y',
          required_parameter_code: 'equipment',
          when_parameter_code: 'use_equipment',
        }),
        parameterNames,
      ),
    ).toBe('사용 여부가 y이면 장비 값을 입력해 주세요.')

    expect(
      validationIssueMessage(
        issue('value_not_found_in_prior_por', 'amount', {
          candidate_parameter_code: 'previous_mask',
          searched_layer_count: 3,
        }),
        parameterNames,
      ),
    ).toBe(
      '이 값은 앞선 레이어의 이전 마스크 값에 먼저 있어야 합니다. 앞선 POR 값을 추가하거나 현재 값을 수정해 주세요.',
    )
  })

  it('keeps inactive choice guidance non-blocking and action-oriented', () => {
    expect(validationIssueMessage(issue('choice_inactive', 'equipment'), parameterNames)).toBe(
      '현재 값은 비활성 선택지입니다. 승인에는 영향을 주지 않지만 새로 선택할 수 없습니다.',
    )
  })

  it('maps an unknown future code to the exact safe fallback', () => {
    const unknown = issue('future_server_issue', 'amount', {
      message: 'RAW_SERVER_MESSAGE',
      pattern: 'RAW_SECRET_PATTERN',
    })

    expect(validationIssueMessage(unknown, parameterNames)).toBe('입력 조건을 확인해 주세요.')
  })

  it('accepts a known local evaluator issue without widening its typed details', () => {
    const localIssue: ValidationIssue = {
      key: 'required:1:amount',
      code: 'required',
      rule_code: null,
      rule_version: null,
      severity: 'error',
      condition_id: 1,
      layer_key: 'layer',
      parameter_code: 'amount',
      details: {},
    }

    expect(validationIssueMessage(localIssue, parameterNames)).toBe('노광량 값을 입력해 주세요.')
  })
})

function issue(
  code: string,
  parameterCode: string,
  details: ValidationIssuePayload['details'] = {},
): ValidationIssuePayload {
  return {
    key: `${code}:1:${parameterCode}`,
    code,
    rule_code: null,
    rule_version: null,
    severity: 'error',
    condition_id: 1,
    layer_key: 'layer',
    parameter_code: parameterCode,
    details,
  }
}
