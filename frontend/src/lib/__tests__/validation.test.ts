import { describe, it, expect } from 'vitest'
import { validateCellValue, buildConditionDependencyMap } from '@/lib/validation'
import type { ColumnDefinition, ColumnValidation, ColumnCategory } from '@/types'

// ---------------------------------------------------------------------------
// Helper to build a ColumnDefinition with the given validations
// ---------------------------------------------------------------------------
function makeColDef(
  displayName: string,
  validations: ColumnValidation[]
): ColumnDefinition {
  return {
    id: 1,
    column_name: 'test_col',
    display_name: displayName,
    category_id: 1,
    data_type: 'float',
    select_options: null,
    unit: null,
    sort_order: 1,
    is_required: false,
    validations,
  }
}

function makeRule(
  overrides: Partial<ColumnValidation> & { rule_type: ColumnValidation['rule_type'] }
): ColumnValidation {
  return {
    id: 1,
    rule_config: {},
    error_message: '',
    is_active: true,
    ...overrides,
  }
}

// ===========================================================================
// required rule
// ===========================================================================
describe('validateCellValue - required', () => {
  const colDef = makeColDef('Temperature', [
    makeRule({ rule_type: 'required' }),
  ])

  it('returns error for null value', () => {
    const errors = validateCellValue(null, colDef, {})
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Temperature')
  })

  it('returns error for undefined value', () => {
    const errors = validateCellValue(undefined, colDef, {})
    expect(errors).toHaveLength(1)
  })

  it('returns error for empty string', () => {
    const errors = validateCellValue('', colDef, {})
    expect(errors).toHaveLength(1)
  })

  it('passes for a valid value', () => {
    const errors = validateCellValue('100', colDef, {})
    expect(errors).toHaveLength(0)
  })

  it('passes for zero (which is truthy for required)', () => {
    const errors = validateCellValue(0, colDef, {})
    expect(errors).toHaveLength(0)
  })

  it('uses custom error_message when provided', () => {
    const colDefCustom = makeColDef('Temperature', [
      makeRule({ rule_type: 'required', error_message: 'Custom required msg' }),
    ])
    const errors = validateCellValue(null, colDefCustom, {})
    expect(errors[0]).toBe('Custom required msg')
  })

  it('skips inactive required rule', () => {
    const colDefInactive = makeColDef('Temperature', [
      makeRule({ rule_type: 'required', is_active: false }),
    ])
    const errors = validateCellValue(null, colDefInactive, {})
    expect(errors).toHaveLength(0)
  })
})

// ===========================================================================
// range rule
// ===========================================================================
describe('validateCellValue - range', () => {
  it('passes when value is within range', () => {
    const colDef = makeColDef('Pressure', [
      makeRule({ rule_type: 'range', rule_config: { min: 0, max: 100 } }),
    ])
    const errors = validateCellValue(50, colDef, {})
    expect(errors).toHaveLength(0)
  })

  it('returns error when value is below min', () => {
    const colDef = makeColDef('Pressure', [
      makeRule({ rule_type: 'range', rule_config: { min: 10, max: 100 } }),
    ])
    const errors = validateCellValue(5, colDef, {})
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('10')
  })

  it('returns error when value is above max', () => {
    const colDef = makeColDef('Pressure', [
      makeRule({ rule_type: 'range', rule_config: { min: 0, max: 100 } }),
    ])
    const errors = validateCellValue(150, colDef, {})
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('100')
  })

  it('passes when value equals min boundary', () => {
    const colDef = makeColDef('Pressure', [
      makeRule({ rule_type: 'range', rule_config: { min: 10, max: 100 } }),
    ])
    const errors = validateCellValue(10, colDef, {})
    expect(errors).toHaveLength(0)
  })

  it('passes when value equals max boundary', () => {
    const colDef = makeColDef('Pressure', [
      makeRule({ rule_type: 'range', rule_config: { min: 10, max: 100 } }),
    ])
    const errors = validateCellValue(100, colDef, {})
    expect(errors).toHaveLength(0)
  })

  it('validates only min when max is not specified', () => {
    const colDef = makeColDef('Pressure', [
      makeRule({ rule_type: 'range', rule_config: { min: 10 } }),
    ])
    // Below min
    expect(validateCellValue(5, colDef, {})).toHaveLength(1)
    // Above min - no max constraint
    expect(validateCellValue(99999, colDef, {})).toHaveLength(0)
  })

  it('validates only max when min is not specified', () => {
    const colDef = makeColDef('Pressure', [
      makeRule({ rule_type: 'range', rule_config: { max: 100 } }),
    ])
    // Below - no min constraint
    expect(validateCellValue(-999, colDef, {})).toHaveLength(0)
    // Above max
    expect(validateCellValue(200, colDef, {})).toHaveLength(1)
  })

  it('returns NaN error for non-numeric string', () => {
    const colDef = makeColDef('Pressure', [
      makeRule({ rule_type: 'range', rule_config: { min: 0, max: 100 } }),
    ])
    const errors = validateCellValue('abc', colDef, {})
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Pressure')
  })

  it('skips validation for null/undefined/empty (range does not imply required)', () => {
    const colDef = makeColDef('Pressure', [
      makeRule({ rule_type: 'range', rule_config: { min: 0, max: 100 } }),
    ])
    expect(validateCellValue(null, colDef, {})).toHaveLength(0)
    expect(validateCellValue(undefined, colDef, {})).toHaveLength(0)
    expect(validateCellValue('', colDef, {})).toHaveLength(0)
  })

  it('accepts string values that are valid numbers', () => {
    const colDef = makeColDef('Pressure', [
      makeRule({ rule_type: 'range', rule_config: { min: 0, max: 100 } }),
    ])
    expect(validateCellValue('50', colDef, {})).toHaveLength(0)
    expect(validateCellValue('200', colDef, {})).toHaveLength(1)
  })
})

// ===========================================================================
// conditional_required rule
// ===========================================================================
describe('validateCellValue - conditional_required', () => {
  it('returns error when dependency condition is met and value is empty', () => {
    const colDef = makeColDef('Overlay Spec', [
      makeRule({
        rule_type: 'conditional_required',
        rule_config: { condition_column: 'overlay_type', condition_value: 'manual' },
      }),
    ])
    const rowConditions = { overlay_type: 'manual' }
    const errors = validateCellValue(null, colDef, rowConditions)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Overlay Spec')
  })

  it('passes when dependency condition is met and value is present', () => {
    const colDef = makeColDef('Overlay Spec', [
      makeRule({
        rule_type: 'conditional_required',
        rule_config: { condition_column: 'overlay_type', condition_value: 'manual' },
      }),
    ])
    const rowConditions = { overlay_type: 'manual' }
    const errors = validateCellValue('some value', colDef, rowConditions)
    expect(errors).toHaveLength(0)
  })

  it('passes when dependency condition is not met (regardless of value)', () => {
    const colDef = makeColDef('Overlay Spec', [
      makeRule({
        rule_type: 'conditional_required',
        rule_config: { condition_column: 'overlay_type', condition_value: 'manual' },
      }),
    ])
    const rowConditions = { overlay_type: 'auto' }
    const errors = validateCellValue(null, colDef, rowConditions)
    expect(errors).toHaveLength(0)
  })

  it('passes when dependency key is missing from row conditions', () => {
    const colDef = makeColDef('Overlay Spec', [
      makeRule({
        rule_type: 'conditional_required',
        rule_config: { condition_column: 'overlay_type', condition_value: 'manual' },
      }),
    ])
    const rowConditions = {}
    const errors = validateCellValue(null, colDef, rowConditions)
    expect(errors).toHaveLength(0)
  })

  it('treats empty string as empty for conditional required', () => {
    const colDef = makeColDef('Overlay Spec', [
      makeRule({
        rule_type: 'conditional_required',
        rule_config: { condition_column: 'overlay_type', condition_value: 'manual' },
      }),
    ])
    const rowConditions = { overlay_type: 'manual' }
    const errors = validateCellValue('', colDef, rowConditions)
    expect(errors).toHaveLength(1)
  })

  it('supports not_equals operator', () => {
    const colDef = makeColDef('Special Field', [
      makeRule({
        rule_type: 'conditional_required',
        rule_config: {
          condition_column: 'status',
          condition_value: 'disabled',
          operator: 'not_equals'
        },
      }),
    ])

    // Condition triggers when status != 'disabled'
    const rowConditions1 = { status: 'enabled' }
    expect(validateCellValue(null, colDef, rowConditions1)).toHaveLength(1)

    // Condition does NOT trigger when status == 'disabled'
    const rowConditions2 = { status: 'disabled' }
    expect(validateCellValue(null, colDef, rowConditions2)).toHaveLength(0)
  })

  it('supports contains operator (case insensitive)', () => {
    const colDef = makeColDef('Detail Field', [
      makeRule({
        rule_type: 'conditional_required',
        rule_config: {
          condition_column: 'mode',
          condition_value: 'auto',
          operator: 'contains'
        },
      }),
    ])

    // Condition triggers when mode contains 'auto' (case insensitive)
    const rowConditions1 = { mode: 'AUTO_MODE' }
    expect(validateCellValue(null, colDef, rowConditions1)).toHaveLength(1)

    const rowConditions2 = { mode: 'semi-automatic' }
    expect(validateCellValue(null, colDef, rowConditions2)).toHaveLength(1)

    // Condition does NOT trigger when mode does not contain 'auto'
    const rowConditions3 = { mode: 'manual' }
    expect(validateCellValue(null, colDef, rowConditions3)).toHaveLength(0)
  })

  it('defaults to equals operator when operator is missing', () => {
    const colDef = makeColDef('Legacy Field', [
      makeRule({
        rule_type: 'conditional_required',
        rule_config: {
          condition_column: 'flag',
          condition_value: 'Y'
          // No operator field - should default to 'equals'
        },
      }),
    ])

    // Condition triggers when flag == 'Y' (equals behavior)
    const rowConditions1 = { flag: 'Y' }
    expect(validateCellValue(null, colDef, rowConditions1)).toHaveLength(1)

    // Condition does NOT trigger when flag != 'Y'
    const rowConditions2 = { flag: 'N' }
    expect(validateCellValue(null, colDef, rowConditions2)).toHaveLength(0)
  })
})

// ===========================================================================
// Multiple rules
// ===========================================================================
describe('validateCellValue - multiple rules', () => {
  it('collects errors from multiple active rules', () => {
    const colDef = makeColDef('Value', [
      makeRule({ rule_type: 'required' }),
      makeRule({
        rule_type: 'range',
        rule_config: { min: 0, max: 100 },
      }),
    ])
    // null triggers required error; range skips null so only 1 error
    const errors = validateCellValue(null, colDef, {})
    expect(errors).toHaveLength(1)
  })

  it('reports both required pass and range fail', () => {
    const colDef = makeColDef('Value', [
      makeRule({ rule_type: 'required' }),
      makeRule({
        rule_type: 'range',
        rule_config: { min: 0, max: 100 },
      }),
    ])
    const errors = validateCellValue(200, colDef, {})
    expect(errors).toHaveLength(1) // only range error
    expect(errors[0]).toContain('100')
  })
})

// ===========================================================================
// No validations
// ===========================================================================
describe('validateCellValue - no validations', () => {
  it('returns empty errors when there are no validation rules', () => {
    const colDef = makeColDef('FreeField', [])
    expect(validateCellValue(null, colDef, {})).toHaveLength(0)
    expect(validateCellValue('anything', colDef, {})).toHaveLength(0)
  })
})

// ===========================================================================
// buildConditionDependencyMap
// ===========================================================================
describe('buildConditionDependencyMap', () => {
  it('builds a reverse dependency map for conditional_required rules', () => {
    const categories: ColumnCategory[] = [
      {
        id: 1,
        category_code: 'SP',
        category_name: 'Spin Process',
        sort_order: 1,
        columns: [
          {
            id: 1,
            column_name: 'adhesion_use',
            display_name: 'Adhesion Use',
            category_id: 1,
            data_type: 'string',
            select_options: null,
            unit: null,
            sort_order: 1,
            is_required: false,
            validations: [],
          },
          {
            id: 2,
            column_name: 'adhesion_type',
            display_name: 'Adhesion Type',
            category_id: 1,
            data_type: 'string',
            select_options: null,
            unit: null,
            sort_order: 2,
            is_required: false,
            validations: [
              makeRule({
                rule_type: 'conditional_required',
                rule_config: {
                  condition_column: 'adhesion_use',
                  condition_value: 'Y',
                  operator: 'equals'
                },
              }),
            ],
          },
          {
            id: 3,
            column_name: 'another_field',
            display_name: 'Another Field',
            category_id: 1,
            data_type: 'string',
            select_options: null,
            unit: null,
            sort_order: 3,
            is_required: false,
            validations: [
              makeRule({
                rule_type: 'conditional_required',
                rule_config: {
                  condition_column: 'adhesion_use',
                  condition_value: 'Y',
                  operator: 'equals'
                },
              }),
            ],
          },
        ],
      },
    ]

    const dependencyMap = buildConditionDependencyMap(categories)

    // adhesion_use is referenced by 2 columns
    expect(dependencyMap.has('adhesion_use')).toBe(true)
    expect(dependencyMap.get('adhesion_use')?.length).toBe(2)

    const dependents = dependencyMap.get('adhesion_use') || []
    const dependentNames = dependents.map((c) => c.column_name)
    expect(dependentNames).toContain('adhesion_type')
    expect(dependentNames).toContain('another_field')
  })

  it('ignores inactive conditional_required rules', () => {
    const categories: ColumnCategory[] = [
      {
        id: 1,
        category_code: 'SP',
        category_name: 'Spin Process',
        sort_order: 1,
        columns: [
          {
            id: 1,
            column_name: 'condition_col',
            display_name: 'Condition Col',
            category_id: 1,
            data_type: 'string',
            select_options: null,
            unit: null,
            sort_order: 1,
            is_required: false,
            validations: [],
          },
          {
            id: 2,
            column_name: 'dependent_col',
            display_name: 'Dependent Col',
            category_id: 1,
            data_type: 'string',
            select_options: null,
            unit: null,
            sort_order: 2,
            is_required: false,
            validations: [
              makeRule({
                rule_type: 'conditional_required',
                rule_config: {
                  condition_column: 'condition_col',
                  condition_value: 'X',
                },
                is_active: false,
              }),
            ],
          },
        ],
      },
    ]

    const dependencyMap = buildConditionDependencyMap(categories)

    // Inactive rule should not be in the map
    expect(dependencyMap.has('condition_col')).toBe(false)
  })

  it('returns empty map when there are no conditional_required rules', () => {
    const categories: ColumnCategory[] = [
      {
        id: 1,
        category_code: 'SP',
        category_name: 'Spin Process',
        sort_order: 1,
        columns: [
          {
            id: 1,
            column_name: 'field1',
            display_name: 'Field 1',
            category_id: 1,
            data_type: 'string',
            select_options: null,
            unit: null,
            sort_order: 1,
            is_required: false,
            validations: [makeRule({ rule_type: 'required' })],
          },
          {
            id: 2,
            column_name: 'field2',
            display_name: 'Field 2',
            category_id: 1,
            data_type: 'float',
            select_options: null,
            unit: null,
            sort_order: 2,
            is_required: false,
            validations: [makeRule({ rule_type: 'range', rule_config: { min: 0, max: 100 } })],
          },
        ],
      },
    ]

    const dependencyMap = buildConditionDependencyMap(categories)

    expect(dependencyMap.size).toBe(0)
  })
})
