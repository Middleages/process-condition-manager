import { describe, expect, it } from 'vitest'

import goldenCases from './golden-cases.json'
import { evaluateProject } from './evaluator'
import type { ValidationInput } from './types'

describe('validation evaluator golden parity', () => {
  it.each(goldenCases.evaluation_vectors)('$name', (vector) => {
    // The JSON fixture is the cross-language wire contract. Its imported strings are widened by
    // TypeScript, so this single boundary assertion restores the documented discriminated unions.
    const input = {
      context: vector.context,
      parameters: vector.parameters,
      layers: vector.layers,
      rules: vector.rules,
    } as ValidationInput

    if ('expected_error_code' in vector && vector.expected_error_code !== undefined) {
      expect(() => evaluateProject(input)).toThrowError(
        expect.objectContaining({ code: vector.expected_error_code }),
      )
      return
    }

    const expected = 'expected_issues' in vector ? vector.expected_issues : undefined
    expect(expected).toBeDefined()
    const actual = evaluateProject(input)
    expect(actual).toEqual(expected)
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  })

  it('canonicalizes negative zero without Number coercion in typed relations', () => {
    const input: ValidationInput = {
      context: { project_id: 1, line_id: 'L1', process_id: 'PROC' },
      parameters: [
        parameter('trigger', 'number', 0),
        parameter('target', 'text', 1),
      ],
      layers: [
        {
          key: 'layer',
          layer_id: 'ACT',
          step_seq: '010',
          eqp_type: null,
          area_name: null,
          sort_order: 0,
          conditions: [
            {
              id: 1,
              label: 'base',
              condition_index: 0,
              is_por: true,
              values: { trigger: '-0.000', target: null },
            },
          ],
        },
      ],
      rules: [
        {
          code: 'zero_requires_target',
          name: 'Zero requires target',
          severity: 'error',
          version: 1,
          scope: emptyScope(),
          spec: {
            schema_version: 1,
            type: 'required_if',
            when_parameter_code: 'trigger',
            equals: '0',
            required_parameter_code: 'target',
          },
        },
      ],
    }

    expect(evaluateProject(input)[0]?.details).toEqual({
      equals: '0',
      required_parameter_code: 'target',
      when_parameter_code: 'trigger',
    })
  })

  it('rejects decimals beyond the Python 128-digit defensive limit', () => {
    const input: ValidationInput = {
      context: { project_id: 1, line_id: 'L1', process_id: 'PROC' },
      parameters: [parameter('amount', 'number', 0)],
      layers: [
        {
          key: 'layer',
          layer_id: 'ACT',
          step_seq: '010',
          eqp_type: null,
          area_name: null,
          sort_order: 0,
          conditions: [
            {
              id: 1,
              label: 'base',
              condition_index: 0,
              is_por: true,
              values: { amount: '9'.repeat(129) },
            },
          ],
        },
      ],
      rules: [],
    }

    expect(evaluateProject(input).map((issue) => issue.code)).toEqual(['number_malformed'])
  })

  it('uses Python strip semantics instead of JavaScript trim semantics for decimals', () => {
    const input: ValidationInput = {
      context: { project_id: 1, line_id: 'L1', process_id: 'PROC' },
      parameters: [parameter('amount', 'number', 0)],
      layers: [
        {
          key: 'layer',
          layer_id: 'ACT',
          step_seq: '010',
          eqp_type: null,
          area_name: null,
          sort_order: 0,
          conditions: [
            {
              id: 1,
              label: 'python whitespace',
              condition_index: 0,
              is_por: true,
              values: { amount: '\u00851.00\u0085' },
            },
            {
              id: 2,
              label: 'javascript-only whitespace',
              condition_index: 1,
              is_por: false,
              values: { amount: '\uFEFF1.00\uFEFF' },
            },
          ],
        },
      ],
      rules: [],
    }

    expect(evaluateProject(input).map((issue) => [issue.condition_id, issue.code])).toEqual([
      [2, 'number_malformed'],
    ])
  })
})

function parameter(
  code: string,
  valueType: 'text' | 'number' | 'choice',
  sortOrder: number,
): ValidationInput['parameters'][number] {
  return {
    code,
    display_name: code,
    value_type: valueType,
    required: false,
    pattern: null,
    pattern_hint: null,
    min_value: null,
    max_value: null,
    choice_set_code: valueType === 'choice' ? `${code}_set` : null,
    choices: [],
    sort_order: sortOrder,
  }
}

function emptyScope(): ValidationInput['rules'][number]['scope'] {
  return {
    line_ids: [],
    process_ids: [],
    layer_ids: [],
    step_seqs: [],
    eqp_types: [],
    area_names: [],
  }
}
