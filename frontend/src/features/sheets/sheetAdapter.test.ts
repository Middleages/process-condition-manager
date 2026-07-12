import { describe, expect, it } from 'vitest'

import type { SheetOut } from '@/api/types'

import { toConditionGridData, toLockView } from './sheetAdapter'

const sheet: SheetOut = {
  columns: [
    {
      parameter_code: 'spin_speed',
      display_name: 'Spin Speed',
      value_type: 'number',
      category_code: 'coat',
      unit: 'rpm',
      description: '스핀 속도',
      choice_options: [],
      sort_order: 2,
    },
    {
      parameter_code: 'pr_type',
      display_name: 'PR Type',
      value_type: 'choice',
      category_code: 'coat',
      unit: null,
      description: null,
      choice_options: ['pos', 'neg'],
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
  lock: { locked_by: null, locked_at: null, expires_at: null, is_mine: true },
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
      choiceOptions: ['pos', 'neg'],
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
})

describe('toLockView', () => {
  it('is not read-only when the lock is mine or absent', () => {
    expect(toLockView({ locked_by: null, locked_at: null, expires_at: null, is_mine: true })).toEqual({
      readOnly: false,
      editingBy: null,
    })
    expect(
      toLockView({ locked_by: 'dev-admin', locked_at: null, expires_at: null, is_mine: true }),
    ).toEqual({ readOnly: false, editingBy: null })
  })

  it('is read-only and names the editor when someone else holds the lock', () => {
    expect(
      toLockView({ locked_by: 'someone', locked_at: '2026-07-11T00:00:00Z', expires_at: null, is_mine: false }),
    ).toEqual({ readOnly: true, editingBy: 'someone' })
  })
})
