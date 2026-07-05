import { describe, expect, it } from 'vitest'

import {
  initialParameterFormState,
  parseOptions,
  stateFromParameter,
  toCreatePayload,
  toUpdatePayload,
} from './form'

import type { ParameterFormState } from './form'
import type { ParameterOut } from '@/api/types'

describe('parameter form helpers', () => {
  it('parses comma separated choice options', () => {
    expect(parseOptions(' pos, neg ,, iso ')).toEqual([
      { value: 'pos', display_name: 'pos', sort_order: 0 },
      { value: 'neg', display_name: 'neg', sort_order: 1 },
      { value: 'iso', display_name: 'iso', sort_order: 2 },
    ])
  })

  it('returns an empty option list for blank input', () => {
    expect(parseOptions('   ')).toEqual([])
    expect(parseOptions(',,')).toEqual([])
  })

  it('builds a create payload with normalized empty fields', () => {
    const state: ParameterFormState = {
      code: ' exposure ',
      displayName: ' 노광량 ',
      valueType: 'number',
      description: ' ',
      categoryId: '',
      unit: ' mJ ',
      minValue: '0',
      maxValue: '100',
      optionsText: 'ignored',
    }

    expect(toCreatePayload(state)).toEqual({
      code: 'exposure',
      display_name: '노광량',
      value_type: 'number',
      description: null,
      category_id: null,
      unit: 'mJ',
      min_value: 0,
      max_value: 100,
      options: [],
    })
  })

  it('includes parsed options only for choice type on create', () => {
    const state: ParameterFormState = {
      ...initialParameterFormState,
      code: 'polarity',
      displayName: '극성',
      valueType: 'choice',
      categoryId: '7',
      optionsText: 'pos, neg',
    }

    const payload = toCreatePayload(state)
    expect(payload.value_type).toBe('choice')
    expect(payload.category_id).toBe(7)
    expect(payload.options).toEqual([
      { value: 'pos', display_name: 'pos', sort_order: 0 },
      { value: 'neg', display_name: 'neg', sort_order: 1 },
    ])
  })

  it('omits code and options from the update payload (code is immutable)', () => {
    const state: ParameterFormState = {
      ...initialParameterFormState,
      code: 'should-be-ignored',
      displayName: ' 새 이름 ',
      valueType: 'number',
      unit: 'nm',
      minValue: '10',
      maxValue: '',
      optionsText: 'a, b',
    }

    const payload = toUpdatePayload(state)
    expect(payload).toEqual({
      display_name: '새 이름',
      description: null,
      category_id: null,
      unit: 'nm',
      min_value: 10,
      max_value: null,
    })
    expect(payload).not.toHaveProperty('code')
    expect(payload).not.toHaveProperty('options')
  })

  it('round-trips a parameter into editable form state', () => {
    const parameter: ParameterOut = {
      id: 1,
      code: 'bake_temp',
      display_name: '베이크 온도',
      description: null,
      value_type: 'choice',
      category_id: 3,
      unit: 'C',
      min_value: null,
      max_value: null,
      sort_order: 0,
      is_active: true,
      options: [
        { id: 1, value: 'low', display_name: 'low', sort_order: 0, is_active: true },
        { id: 2, value: 'high', display_name: 'high', sort_order: 1, is_active: true },
      ],
    }

    expect(stateFromParameter(parameter)).toEqual({
      code: 'bake_temp',
      displayName: '베이크 온도',
      valueType: 'choice',
      description: '',
      categoryId: '3',
      unit: 'C',
      minValue: '',
      maxValue: '',
      optionsText: 'low, high',
    })
  })
})
