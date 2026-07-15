import { describe, expect, it } from 'vitest'

import type { SheetColumnOut, SheetOut } from '@/api/types'

import type { PersistedCell } from './editStore'
import {
  applySavedToSheet,
  SheetAdapterError,
  shouldReplaceSheetWithError,
  toConditionGridData,
} from './sheetAdapter'

const sheet: SheetOut = {
  columns: [
    {
      parameter_code: 'spin_speed',
      display_name: 'Spin Speed',
      value_type: 'number',
      category_code: 'coat',
      unit: 'rpm',
      description: '스핀 속도',
      choice_set_code: null,
      choice_set_version: null,
      sort_order: 2,
    },
    {
      parameter_code: 'pr_type',
      display_name: 'PR Type',
      value_type: 'choice',
      category_code: 'coat',
      unit: null,
      description: null,
      choice_set_code: 'photo_resist',
      choice_set_version: 7,
      sort_order: 1,
    },
  ],
  rows: [
    {
      condition_id: 11,
      layer_key: 'S01|L1',
      layer_label: 'L1 (S01)',
      condition_label: 'C1',
      is_por: true,
      cells: { spin_speed: '1500', pr_type: 'pos' },
    },
  ],
  lock: { locked_by: null, locked_at: null, expires_at: null, is_mine: true, heartbeat_seconds: 45 },
}

describe('toConditionGridData', () => {
  it('orders columns by sort_order and maps to the grid contract', () => {
    const data = toConditionGridData(sheet)
    expect(data.columns.map((c) => c.key)).toEqual(['pr_type', 'spin_speed'])
    expect(data.columns[0]).toEqual({
      key: 'pr_type',
      headerName: 'PR Type',
      valueType: 'choice',
      categoryCode: 'coat',
      unit: null,
      description: null,
      choiceSetCode: 'photo_resist',
      choiceSetVersion: 7,
    })
  })

  it('stringifies condition_id and passes sparse cells straight through', () => {
    const data = toConditionGridData(sheet)
    expect(data.rows[0].id).toBe('11')
    expect(data.rows[0].isPor).toBe(true)
    expect(data.rows[0].layerLabel).toBe('L1 (S01)')
    expect(data.rows[0].values).toEqual({ spin_speed: '1500', pr_type: 'pos' })
  })

  it('does not mutate the source column order', () => {
    const original = sheet.columns.map((c) => c.parameter_code)
    toConditionGridData(sheet)
    expect(sheet.columns.map((c) => c.parameter_code)).toEqual(original)
  })

  const malformedBindingCases: ReadonlyArray<readonly [string, Partial<SheetColumnOut>]> = [
    ['choice missing version', { value_type: 'choice', choice_set_code: 'photo_resist', choice_set_version: null }],
    ['choice missing code', { value_type: 'choice', choice_set_code: null, choice_set_version: 7 }],
    ['choice padded code', { value_type: 'choice', choice_set_code: ' photo_resist ', choice_set_version: 7 }],
    ['non-choice with binding', { value_type: 'text', choice_set_code: 'photo_resist', choice_set_version: 7 }],
  ]

  it.each(malformedBindingCases)('fails closed for malformed column bindings: %s', (_label, overrides) => {
    const malformed: SheetOut = {
      ...sheet,
      columns: [{ ...sheet.columns[0], ...overrides }],
    }

    expect(() => toConditionGridData(malformed)).toThrowError(
      expect.objectContaining<Partial<SheetAdapterError>>({
        name: 'SheetAdapterError',
        code: 'invalid_choice_binding',
        requiresRefetch: true,
      }),
    )
  })

  it('fails closed when one set is bound to conflicting sheet versions', () => {
    const conflict: SheetOut = {
      ...sheet,
      columns: [
        sheet.columns[1],
        { ...sheet.columns[1], parameter_code: 'pr_type_2', choice_set_version: 8 },
      ],
    }

    expect(() => toConditionGridData(conflict)).toThrowError(
      expect.objectContaining<Partial<SheetAdapterError>>({
        code: 'conflicting_choice_versions',
        requiresRefetch: true,
      }),
    )
  })
})

describe('shouldReplaceSheetWithError', () => {
  it('keeps cached sheet data mounted when a background refetch fails', () => {
    expect(shouldReplaceSheetWithError(sheet, true)).toBe(false)
    expect(shouldReplaceSheetWithError(undefined, true)).toBe(true)
    expect(shouldReplaceSheetWithError(undefined, false)).toBe(false)
  })
})

describe('applySavedToSheet', () => {
  it('writes saved values into the matching row cells, keeping others', () => {
    const saved: PersistedCell[] = [{ conditionId: '11', parameterCode: 'spin_speed', value: '1600' }]
    const next = applySavedToSheet(sheet, saved)
    expect(next.rows[0].cells.spin_speed).toBe('1600')
    expect(next.rows[0].cells.pr_type).toBe('pos')
  })

  it('removes the cell key when the saved value is null (sparse representation)', () => {
    const saved: PersistedCell[] = [{ conditionId: '11', parameterCode: 'pr_type', value: null }]
    const next = applySavedToSheet(sheet, saved)
    expect('pr_type' in next.rows[0].cells).toBe(false)
  })

  it('does not mutate the source sheet', () => {
    applySavedToSheet(sheet, [{ conditionId: '11', parameterCode: 'spin_speed', value: '9999' }])
    expect(sheet.rows[0].cells.spin_speed).toBe('1500')
  })

  it('returns the same reference when there is nothing to apply', () => {
    expect(applySavedToSheet(sheet, [])).toBe(sheet)
  })
})
