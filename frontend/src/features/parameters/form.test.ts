import { describe, expect, it } from 'vitest'

import type { ChoiceSetSummaryOut, ParameterOut } from '@/api/types'

import {
  buildParameterCreatePlan,
  buildParameterUpdatePlan,
  initialParameterFormState,
  stateFromParameter,
  toCreatePayload,
  toUpdatePayload,
  type ParameterFormState,
} from './form'

function choiceSet(
  code = 'equipment_mode',
  overrides: Partial<ChoiceSetSummaryOut> = {},
): ChoiceSetSummaryOut {
  return {
    code,
    display_name: 'Equipment mode',
    description: null,
    is_active: true,
    version: 3,
    option_count: 2,
    active_option_count: 2,
    parameter_usage_count: 1,
    profile_usage_fields: [],
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
    ...overrides,
  }
}

const numberParameter: ParameterOut = {
  id: 42,
  code: 'exposure',
  display_name: 'Exposure',
  description: 'Wafer dose',
  value_type: 'number',
  category_id: 3,
  unit: 'mJ',
  min_value: '10',
  max_value: '100',
  required: false,
  pattern: null,
  pattern_hint: null,
  choice_set: null,
  sort_order: 0,
  is_active: true,
}

const choiceParameter: ParameterOut = {
  ...numberParameter,
  id: 43,
  code: 'mode',
  display_name: 'Mode',
  description: null,
  value_type: 'choice',
  category_id: null,
  unit: null,
  min_value: null,
  max_value: null,
  choice_set: choiceSet(),
}

const activeEquipmentMode = {
  activeChoiceSetCodes: new Set(['equipment_mode']),
  authorizedChoiceSetCode: 'equipment_mode',
}

describe('parameter form transport', () => {
  it('uses only the final managed-choice form fields', () => {
    expect(Object.keys(initialParameterFormState)).toEqual([
      'code',
      'displayName',
      'valueType',
      'description',
      'categoryId',
      'unit',
      'minValue',
      'maxValue',
      'required',
      'pattern',
      'patternHint',
      'choiceSetCode',
    ])
    expect(initialParameterFormState).not.toHaveProperty('optionsText')
  })

  it('canonicalizes decimal strings without losing integer precision', () => {
    const state: ParameterFormState = {
      ...initialParameterFormState,
      code: ' pitch ',
      displayName: ' Pitch ',
      valueType: 'number',
      unit: ' nm ',
      minValue: ' 001.5000 ',
      maxValue: '90071992547409931234567890.5000',
    }

    expect(toCreatePayload(state)).toEqual({
      code: 'pitch',
      display_name: 'Pitch',
      value_type: 'number',
      choice_set_code: null,
      description: null,
      category_id: null,
      unit: 'nm',
      min_value: '1.5',
      max_value: '90071992547409931234567890.5',
      required: false,
      pattern: null,
      pattern_hint: null,
    })
  })

  it('binds a selected managed set for choice create and clears it for non-choice create', () => {
    const choiceState: ParameterFormState = {
      ...initialParameterFormState,
      code: 'mode',
      displayName: 'Mode',
      valueType: 'choice',
      choiceSetCode: ' equipment_mode ',
    }

    expect(toCreatePayload(choiceState)).toMatchObject({
      value_type: 'choice',
      choice_set_code: 'equipment_mode',
    })
    expect(
      toCreatePayload({ ...choiceState, valueType: 'text' }),
    ).toMatchObject({ value_type: 'text', choice_set_code: null })
  })

  it('hydrates canonical bounds and the ChoiceSet code without an option draft', () => {
    expect(stateFromParameter(choiceParameter)).toEqual({
      code: 'mode',
      displayName: 'Mode',
      valueType: 'choice',
      description: '',
      categoryId: '',
      unit: '',
      minValue: '',
      maxValue: '',
      required: false,
      pattern: '',
      patternHint: '',
      choiceSetCode: 'equipment_mode',
    })
  })

  it('never puts code, value type, or ChoiceSet identity in PATCH', () => {
    const payload = toUpdatePayload({
      ...stateFromParameter(choiceParameter),
      code: 'changed',
      valueType: 'number',
      choiceSetCode: 'other_set',
      displayName: ' Updated ',
    })

    expect(payload).toEqual({
      display_name: 'Updated',
      description: null,
      category_id: null,
      unit: null,
      min_value: null,
      max_value: null,
      required: false,
      pattern: null,
      pattern_hint: null,
    })
    expect(payload).not.toHaveProperty('code')
    expect(payload).not.toHaveProperty('value_type')
    expect(payload).not.toHaveProperty('choice_set_code')
    expect(payload).not.toHaveProperty('options')
  })
})

describe('parameter create plans', () => {
  it('returns canonical decimal strings in a valid dirty create plan', () => {
    const plan = buildParameterCreatePlan({
      ...initialParameterFormState,
      code: ' exposure ',
      displayName: ' Exposure dose ',
      valueType: 'number',
      unit: ' mJ ',
      minValue: '001.5000',
      maxValue: '100.000',
    })

    expect(plan).toEqual({
      payload: {
        code: 'exposure',
        display_name: 'Exposure dose',
        value_type: 'number',
        choice_set_code: null,
        description: null,
        category_id: null,
        unit: 'mJ',
        min_value: '1.5',
        max_value: '100',
        required: false,
        pattern: null,
        pattern_hint: null,
      },
      fieldErrors: {},
      dirty: true,
    })
  })

  it('rejects malformed decimal syntax instead of accepting Number spellings', () => {
    for (const value of ['+1', '1e3', '1,000', 'NaN', 'Infinity']) {
      const plan = buildParameterCreatePlan({
        ...initialParameterFormState,
        code: 'pitch',
        displayName: 'Pitch',
        valueType: 'number',
        minValue: value,
      })

      expect(plan.fieldErrors.minValue, value).toBeDefined()
    }
  })

  it('compares canonical decimals as strings and treats 0.50 as equal to 0.5', () => {
    const equal = buildParameterCreatePlan({
      ...initialParameterFormState,
      code: 'pitch',
      displayName: 'Pitch',
      valueType: 'number',
      minValue: '0.50',
      maxValue: '0.5',
    })
    const reversed = buildParameterCreatePlan({
      ...initialParameterFormState,
      code: 'pitch',
      displayName: 'Pitch',
      valueType: 'number',
      minValue: '9007199254740993',
      maxValue: '9007199254740992.9999',
    })

    expect(equal.fieldErrors.maxValue).toBeUndefined()
    expect(reversed.fieldErrors.maxValue).toBeDefined()
  })

  it('requires an explicitly selected active ChoiceSet', () => {
    const base: ParameterFormState = {
      ...initialParameterFormState,
      code: 'mode',
      displayName: 'Mode',
      valueType: 'choice',
    }

    expect(buildParameterCreatePlan(base).fieldErrors.choiceSetCode).toContain('선택')
    expect(
      buildParameterCreatePlan(
        { ...base, choiceSetCode: 'inactive_set' },
        {
          activeChoiceSetCodes: new Set(['equipment_mode']),
          authorizedChoiceSetCode: 'inactive_set',
        },
      ).fieldErrors.choiceSetCode,
    ).toContain('활성')
    expect(
      buildParameterCreatePlan(
        { ...base, choiceSetCode: 'equipment_mode' },
        {
          activeChoiceSetCodes: new Set(['equipment_mode']),
          authorizedChoiceSetCode: null,
        },
      ).fieldErrors.choiceSetCode,
    ).toContain('다시 선택')
    expect(
      buildParameterCreatePlan(
        { ...base, choiceSetCode: 'equipment_mode' },
        activeEquipmentMode,
      ).fieldErrors,
    ).toEqual({})
  })
})

describe('parameter safe update plans', () => {
  it('treats canonical-equivalent decimal text as clean', () => {
    const plan = buildParameterUpdatePlan(numberParameter, {
      ...stateFromParameter(numberParameter),
      categoryId: '03',
      minValue: '010.000',
      maxValue: '100.0',
    })

    expect(plan.payload).toEqual({})
    expect(plan.fieldErrors).toEqual({})
    expect(plan.dirty).toBe(false)
  })

  it('puts only changed mutable canonical values in PATCH', () => {
    const plan = buildParameterUpdatePlan(numberParameter, {
      ...stateFromParameter(numberParameter),
      code: 'changed_code',
      valueType: 'choice',
      choiceSetCode: 'ignored_set',
      displayName: ' Updated exposure ',
      description: ' New description ',
      categoryId: '4',
      unit: 'J',
      minValue: '005.5000',
      maxValue: '90.00',
    })

    expect(plan).toMatchObject({
      payload: {
        display_name: 'Updated exposure',
        description: 'New description',
        category_id: 4,
        unit: 'J',
        min_value: '5.5',
        max_value: '90',
      },
      fieldErrors: {},
      dirty: true,
    })
    expect(plan).not.toHaveProperty('options')
    expect(plan).not.toHaveProperty('optionsDirty')
    expect(plan.payload).not.toHaveProperty('choice_set_code')
  })

  it('keeps an existing ChoiceSet immutable and ignores a changed draft identity', () => {
    const originalState = stateFromParameter(choiceParameter)
    const plan = buildParameterUpdatePlan(choiceParameter, {
      ...originalState,
      choiceSetCode: 'other_set',
    })

    expect(originalState.choiceSetCode).toBe('equipment_mode')
    expect(plan.payload).toEqual({})
    expect(plan.fieldErrors).toEqual({})
    expect(plan.dirty).toBe(false)
  })

  it('allows metadata PATCH for an existing inactive ChoiceSet binding', () => {
    const inactiveChoiceParameter: ParameterOut = {
      ...choiceParameter,
      choice_set: choiceSet('equipment_mode', { is_active: false }),
    }
    const plan = buildParameterUpdatePlan(inactiveChoiceParameter, {
      ...stateFromParameter(inactiveChoiceParameter),
      displayName: 'Legacy mode',
    })

    expect(plan.payload).toEqual({ display_name: 'Legacy mode' })
    expect(plan.fieldErrors).toEqual({})
    expect(plan.dirty).toBe(true)
    expect(plan.payload).not.toHaveProperty('choice_set_code')
  })

  it('serializes explicit nullable clears instead of silently omitting them', () => {
    const plan = buildParameterUpdatePlan(numberParameter, {
      ...stateFromParameter(numberParameter),
      description: '',
      categoryId: '',
      unit: '',
      minValue: '',
      maxValue: '',
    })

    expect(plan.payload).toEqual({
      description: null,
      category_id: null,
      unit: null,
      min_value: null,
      max_value: null,
    })
    expect(plan.dirty).toBe(true)
  })

  it('hydrates and PATCHes required and the pattern pair atomically', () => {
    const original: ParameterOut = {
      ...choiceParameter,
      code: 'mask_id',
      value_type: 'text',
      choice_set: null,
      required: true,
      pattern: '[A-Z]{2}-[0-9]{4}',
      pattern_hint: '영문 대문자 2자리-숫자 4자리',
    }
    const hydrated = stateFromParameter(original)

    expect(hydrated).toMatchObject({
      required: true,
      pattern: '[A-Z]{2}-[0-9]{4}',
      patternHint: '영문 대문자 2자리-숫자 4자리',
    })
    expect(
      buildParameterUpdatePlan(original, {
        ...hydrated,
        required: false,
        patternHint: 'AA-0000 형식',
      }).payload,
    ).toEqual({
      required: false,
      pattern: '[A-Z]{2}-[0-9]{4}',
      pattern_hint: 'AA-0000 형식',
    })
    expect(
      buildParameterUpdatePlan(original, {
        ...hydrated,
        pattern: '',
        patternHint: '',
      }).payload,
    ).toEqual({ pattern: null, pattern_hint: null })
  })

  it('requires pattern and user-facing hint together for text parameters', () => {
    const missingHint = buildParameterCreatePlan({
      ...initialParameterFormState,
      code: 'mask_id',
      displayName: 'Mask ID',
      valueType: 'text',
      pattern: '[A-Z]{2}',
    })
    const hintOnly = buildParameterCreatePlan({
      ...initialParameterFormState,
      code: 'mask_id',
      displayName: 'Mask ID',
      valueType: 'text',
      patternHint: '영문 대문자 2자리',
    })

    expect(missingHint.fieldErrors.patternHint).toBeDefined()
    expect(hintOnly.fieldErrors.pattern).toBeDefined()
  })

  it('reports blank display name, malformed decimals, and reversed bounds', () => {
    const invalid = buildParameterUpdatePlan(numberParameter, {
      ...stateFromParameter(numberParameter),
      displayName: '',
      minValue: '1e2',
    })
    const reversed = buildParameterUpdatePlan(numberParameter, {
      ...stateFromParameter(numberParameter),
      minValue: '200',
      maxValue: '100',
    })

    expect(invalid.fieldErrors.displayName).toBeDefined()
    expect(invalid.fieldErrors.minValue).toBeDefined()
    expect(reversed.fieldErrors.maxValue).toBeDefined()
  })
})
