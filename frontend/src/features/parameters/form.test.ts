import { describe, expect, it } from 'vitest'

import { parseOptions, toCreatePayload } from './form'

import type { ParameterFormState } from './form'

describe('parameter form helpers', () => {
  it('parses comma separated choice options', () => {
    expect(parseOptions(' pos, neg ,, iso ')).toEqual([
      { value: 'pos', display_name: 'pos', sort_order: 0 },
      { value: 'neg', display_name: 'neg', sort_order: 1 },
      { value: 'iso', display_name: 'iso', sort_order: 2 },
    ])
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
})
