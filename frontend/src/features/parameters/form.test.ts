import { describe, expect, it } from 'vitest'

import {
  buildParameterCreatePlan,
  buildParameterUpdatePlan,
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

const numberParameter: ParameterOut = {
  id: 42,
  code: 'exposure',
  display_name: 'Exposure',
  description: 'Wafer dose',
  value_type: 'number',
  category_id: 3,
  unit: 'mJ',
  min_value: 10,
  max_value: 100,
  sort_order: 0,
  is_active: true,
  options: [],
}

const choiceParameter: ParameterOut = {
  ...numberParameter,
  id: 43,
  code: 'polarity',
  display_name: 'Polarity',
  description: null,
  value_type: 'choice',
  category_id: null,
  unit: null,
  min_value: null,
  max_value: null,
  options: [
    { id: 1, value: 'pos', display_name: 'pos', sort_order: 0, is_active: true },
    { id: 2, value: 'neg', display_name: 'neg', sort_order: 1, is_active: true },
  ],
}

describe('parameter create plans', () => {
  it('normalizes a valid form into a dirty create payload', () => {
    const plan = buildParameterCreatePlan({
      ...initialParameterFormState,
      code: ' exposure ',
      displayName: ' Exposure dose ',
      valueType: 'number',
      unit: ' mJ ',
      minValue: '0',
      maxValue: '100',
    })

    expect(plan).toEqual({
      payload: {
        code: 'exposure',
        display_name: 'Exposure dose',
        value_type: 'number',
        description: null,
        category_id: null,
        unit: 'mJ',
        min_value: 0,
        max_value: 100,
        options: [],
      },
      fieldErrors: {},
      dirty: true,
    })
  })

  it('reports blank required text and non-numeric bounds', () => {
    const plan = buildParameterCreatePlan({
      ...initialParameterFormState,
      code: ' ',
      displayName: ' ',
      minValue: 'low',
      maxValue: 'high',
    })

    expect(plan.fieldErrors).toHaveProperty('code')
    expect(plan.fieldErrors).toHaveProperty('displayName')
    expect(plan.fieldErrors).toHaveProperty('minValue')
    expect(plan.fieldErrors).toHaveProperty('maxValue')
  })

  it('reports a minimum greater than the maximum', () => {
    const plan = buildParameterCreatePlan({
      ...initialParameterFormState,
      code: 'temperature',
      displayName: 'Temperature',
      minValue: '20',
      maxValue: '10',
    })

    expect(plan.fieldErrors).toHaveProperty('maxValue')
  })

  it('requires non-duplicate options for choice parameters', () => {
    const base = {
      ...initialParameterFormState,
      code: 'polarity',
      displayName: 'Polarity',
      valueType: 'choice' as const,
    }

    expect(buildParameterCreatePlan(base).fieldErrors).toHaveProperty('optionsText')
    expect(
      buildParameterCreatePlan({ ...base, optionsText: 'pos, neg, pos' }).fieldErrors,
    ).toHaveProperty('optionsText')
  })
})

describe('parameter safe update plans', () => {
  it('omits blank optional fields that were already null', () => {
    const plan = buildParameterUpdatePlan(choiceParameter, stateFromParameter(choiceParameter))

    expect(plan.payload).toEqual({})
    expect(plan.unsupportedClears).toEqual([])
    expect(plan.fieldErrors).toEqual({})
    expect(plan.dirty).toBe(false)
  })

  it('blocks unsupported clears without putting null fields in PATCH', () => {
    const state = {
      ...stateFromParameter(numberParameter),
      description: ' ',
      categoryId: '',
      unit: '',
      minValue: '',
      maxValue: '',
    }

    const plan = buildParameterUpdatePlan(numberParameter, state)

    expect(plan.unsupportedClears).toEqual([
      'description',
      'categoryId',
      'unit',
      'minValue',
      'maxValue',
    ])
    for (const field of plan.unsupportedClears) {
      expect(plan.fieldErrors).toHaveProperty(field)
    }
    expect(plan.payload).toEqual({})
    expect(plan.dirty).toBe(true)
  })

  it('puts only changed mutable values in PATCH and ignores code and value type', () => {
    const plan = buildParameterUpdatePlan(numberParameter, {
      ...stateFromParameter(numberParameter),
      code: 'changed_code',
      valueType: 'choice',
      displayName: ' Updated exposure ',
      description: ' New description ',
      categoryId: '4',
      unit: 'J',
      minValue: '5',
      maxValue: '90',
      optionsText: '',
    })

    expect(plan.payload).toEqual({
      display_name: 'Updated exposure',
      description: 'New description',
      category_id: 4,
      unit: 'J',
      min_value: 5,
      max_value: 90,
    })
    expect(plan.payload).not.toHaveProperty('code')
    expect(plan.payload).not.toHaveProperty('value_type')
    expect(plan.fieldErrors).toEqual({})
    expect(plan.dirty).toBe(true)
  })

  it('reports blank display name, invalid bounds, and invalid choice options', () => {
    const invalidNumber = buildParameterUpdatePlan(numberParameter, {
      ...stateFromParameter(numberParameter),
      displayName: ' ',
      minValue: 'bad',
    })
    const invalidChoice = buildParameterUpdatePlan(choiceParameter, {
      ...stateFromParameter(choiceParameter),
      optionsText: 'pos, pos',
    })
    const emptyChoice = buildParameterUpdatePlan(choiceParameter, {
      ...stateFromParameter(choiceParameter),
      optionsText: ' ',
    })
    const reversedBounds = buildParameterUpdatePlan(numberParameter, {
      ...stateFromParameter(numberParameter),
      minValue: '200',
      maxValue: '100',
    })

    expect(invalidNumber.fieldErrors).toHaveProperty('displayName')
    expect(invalidNumber.fieldErrors).toHaveProperty('minValue')
    expect(invalidNumber.dirty).toBe(true)
    expect(invalidChoice.fieldErrors).toHaveProperty('optionsText')
    expect(emptyChoice.fieldErrors).toHaveProperty('optionsText')
    expect(reversedBounds.fieldErrors).toHaveProperty('maxValue')
  })

  it('treats an unchanged normalized form as clean', () => {
    const plan = buildParameterUpdatePlan(choiceParameter, {
      ...stateFromParameter(choiceParameter),
      displayName: ' Polarity ',
      categoryId: ' ',
      optionsText: ' pos , neg ',
    })

    expect(plan.payload).toEqual({})
    expect(plan.fieldErrors).toEqual({})
    expect(plan.dirty).toBe(false)
  })

  it('treats equivalent numeric and category text as clean', () => {
    const plan = buildParameterUpdatePlan(numberParameter, {
      ...stateFromParameter(numberParameter),
      categoryId: '03',
      minValue: '010.0',
      maxValue: '1e2',
    })

    expect(plan.payload).toEqual({})
    expect(plan.fieldErrors).toEqual({})
    expect(plan.dirty).toBe(false)
  })

  it('normalizes legacy blank optional strings to an unchanged null state', () => {
    const original = {
      ...numberParameter,
      description: '   ',
      unit: '',
      category_id: null,
      min_value: null,
      max_value: null,
    }
    const plan = buildParameterUpdatePlan(original, stateFromParameter(original))

    expect(plan.payload).toEqual({})
    expect(plan.unsupportedClears).toEqual([])
    expect(plan.dirty).toBe(false)
  })

  it('treats ordered option changes as dirty', () => {
    const plan = buildParameterUpdatePlan(choiceParameter, {
      ...stateFromParameter(choiceParameter),
      optionsText: 'neg, pos, neutral',
    })

    expect(plan.payload).toEqual({})
    expect(plan.options).toEqual([
      { value: 'neg', display_name: 'neg', sort_order: 0 },
      { value: 'pos', display_name: 'pos', sort_order: 1 },
      { value: 'neutral', display_name: 'neutral', sort_order: 2 },
    ])
    expect(plan.dirty).toBe(true)
  })

  it('keeps custom labels and comma-containing values lossless when options are untouched', () => {
    const original: ParameterOut = {
      ...choiceParameter,
      options: [
        {
          id: 1,
          value: 'warm,high',
          display_name: 'Warm / high',
          sort_order: 7,
          is_active: true,
        },
        {
          id: 2,
          value: ' cool ',
          display_name: 'Cool label',
          sort_order: 12,
          is_active: true,
        },
      ],
    }
    const cleanPlan = buildParameterUpdatePlan(original, stateFromParameter(original))
    const plan = buildParameterUpdatePlan(original, {
      ...stateFromParameter(original),
      displayName: 'Updated polarity',
    })

    expect(plan.options).toEqual([
      { value: 'warm,high', display_name: 'Warm / high', sort_order: 7 },
      { value: ' cool ', display_name: 'Cool label', sort_order: 12 },
    ])
    expect(cleanPlan.dirty).toBe(false)
    expect(plan.fieldErrors).toEqual({})
    expect(plan.dirty).toBe(true)
  })
})
