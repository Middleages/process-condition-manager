import { describe, expect, it } from 'vitest'

import type { ValidationIssueOut } from '@/api/types'
import type { ValidationInput } from '@/shared/domain/validation'

import {
  buildCellStatuses,
  evaluateProvisional,
  selectEffectiveValidation,
  summarizeIssues,
} from './validationState'

describe('validation summaries and composite cell status', () => {
  it('counts error and warning issues without treating an empty list as unavailable', () => {
    expect(summarizeIssues([issue('required', 'error'), issue('choice_inactive', 'warning')])).toEqual({
      error_count: 1,
      warning_count: 1,
    })
    expect(summarizeIssues([])).toEqual({ error_count: 0, warning_count: 0 })
  })

  it('retains dirty and comment facts while error wins warning and dirty visual priority', () => {
    const statuses = buildCellStatuses({
      issues: [
        issue('choice_inactive', 'warning'),
        issue('required', 'error'),
      ],
      dirtyCells: [
        { conditionId: '1', parameterCode: 'amount' },
        { conditionId: '2', parameterCode: 'memo' },
      ],
      comments: [
        { conditionId: '1', parameterCode: 'amount', count: 2 },
        { conditionId: '3', parameterCode: 'note', count: 1 },
      ],
      parameterNames: { amount: '노광량' },
    })

    expect(statuses).toEqual([
      {
        conditionId: '1',
        parameterCode: 'amount',
        validation: {
          severity: 'error',
          count: 2,
          message: '노광량 값을 입력해 주세요.',
        },
        dirty: true,
        commentCount: 2,
      },
      { conditionId: '2', parameterCode: 'memo', dirty: true },
      { conditionId: '3', parameterCode: 'note', dirty: false, commentCount: 1 },
    ])
  })
})

describe('provisional evaluator boundary', () => {
  it('evaluates a committed display input immediately', () => {
    const input = requiredInput(null)

    expect(evaluateProvisional(input)).toEqual({
      status: 'ready',
      issues: [expect.objectContaining({ code: 'required', condition_id: 1 })],
      summary: { error_count: 1, warning_count: 0 },
      failure: null,
    })
  })

  it('fails closed when definitions are unavailable or invalid instead of reporting green', () => {
    expect(evaluateProvisional(null)).toEqual({
      status: 'unavailable',
      issues: [],
      summary: null,
      failure: '검증 정의를 불러오지 못했습니다. 다시 시도해 주세요.',
    })

    const invalid: ValidationInput = {
      ...requiredInput('value'),
      parameters: [requiredInput('value').parameters[0]!, requiredInput('value').parameters[0]!],
    }
    expect(evaluateProvisional(invalid)).toEqual(
      expect.objectContaining({ status: 'unavailable', summary: null, issues: [] }),
    )
  })

  it('propagates unrelated evaluator faults instead of mislabeling them as configuration failure', () => {
    const unexpected = requiredInput('value')
    Object.defineProperty(unexpected, 'parameters', {
      get() {
        throw new Error('unexpected evaluator fault')
      },
    })

    expect(() => evaluateProvisional(unexpected)).toThrow('unexpected evaluator fault')
  })
})

describe('effective validation authority', () => {
  it('uses matching authoritative issues only for the current clean persisted generation', () => {
    const provisional = evaluateProvisional(requiredInput(null))
    const authoritative = [issue('choice_inactive', 'warning')]
    const confirmation = {
      basisHash: 'sha256:a',
      definitionAuthority: Symbol('definitions'),
      evaluatedAt: '2026-07-15T00:00:00Z',
      persistedGeneration: 4,
    }

    expect(
      selectEffectiveValidation({
        provisional,
        authoritativeIssues: authoritative,
        authoritativeSummary: { error_count: 0, warning_count: 1 },
        authoritativeConfirmation: confirmation,
        currentBasisHash: 'sha256:a',
        currentDefinitionAuthority: confirmation.definitionAuthority,
        currentPersistedGeneration: 4,
        persistenceIdle: true,
      }),
    ).toEqual({
      authority: 'authoritative',
      issues: authoritative,
      summary: { error_count: 0, warning_count: 1 },
    })

    expect(
      selectEffectiveValidation({
        provisional,
        authoritativeIssues: authoritative,
        authoritativeSummary: { error_count: 0, warning_count: 1 },
        authoritativeConfirmation: confirmation,
        currentBasisHash: 'sha256:a',
        currentDefinitionAuthority: confirmation.definitionAuthority,
        currentPersistedGeneration: 4,
        persistenceIdle: false,
      }).authority,
    ).toBe('provisional')
  })

  it('never turns unavailable definitions green from an older server confirmation', () => {
    const effective = selectEffectiveValidation({
      provisional: evaluateProvisional(null),
      authoritativeIssues: [],
      authoritativeSummary: { error_count: 0, warning_count: 0 },
      authoritativeConfirmation: {
        basisHash: 'sha256:a',
        definitionAuthority: Symbol('old-definitions'),
        evaluatedAt: '2026-07-15T00:00:00Z',
        persistedGeneration: 4,
      },
      currentBasisHash: 'sha256:a',
      currentDefinitionAuthority: Symbol('current-definitions'),
      currentPersistedGeneration: 4,
      persistenceIdle: true,
    })

    expect(effective).toEqual({ authority: 'unavailable', issues: [], summary: null })
  })
})

function issue(code: string, severity: 'error' | 'warning'): ValidationIssueOut {
  return {
    key: `1:amount:${code}`,
    code,
    rule_code: null,
    rule_version: null,
    severity,
    condition_id: 1,
    layer_key: 'L1',
    parameter_code: 'amount',
    details: {},
  }
}

function requiredInput(value: string | null): ValidationInput {
  return {
    context: { project_id: 7, line_id: 'LINE', process_id: 'PROC' },
    parameters: [
      {
        code: 'amount',
        display_name: '노광량',
        value_type: 'text',
        required: true,
        pattern: null,
        pattern_hint: null,
        min_value: null,
        max_value: null,
        choice_set_code: null,
        choices: [],
        sort_order: 0,
      },
    ],
    layers: [
      {
        key: 'L1',
        layer_id: 'L1',
        step_seq: '10',
        eqp_type: null,
        area_name: null,
        sort_order: 0,
        conditions: [
          {
            id: 1,
            label: 'POR',
            condition_index: 0,
            is_por: true,
            values: { amount: value },
          },
        ],
      },
    ],
    rules: [],
  }
}
