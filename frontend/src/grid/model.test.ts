import { describe, expect, it } from 'vitest'

import {
  IDENTITY_COLUMN_COUNT,
  cellScrollTarget,
  columnScrollIndex,
  computeRowGroups,
  distinctCategories,
  formatNumberDisplay,
  indexStaging,
  indexStatuses,
  matrixToTsv,
  overlayKey,
  resolveCellTarget,
  visibleParameterColumns,
} from './model'
import type { ConditionGridColumn, ConditionGridRow } from './types'

const columns: ConditionGridColumn[] = [
  { key: 'exposure', headerName: '노광량', valueType: 'number', categoryCode: 'litho', unit: 'mJ' },
  { key: 'spin_speed', headerName: 'Spin', valueType: 'number', categoryCode: 'coat', unit: 'rpm' },
  { key: 'pr_type', headerName: 'PR', valueType: 'choice', categoryCode: 'coat', choiceOptions: ['pos', 'neg'] },
  { key: 'memo', headerName: '메모', valueType: 'text', categoryCode: null },
]

const rows: ConditionGridRow[] = [
  { id: '1', layerKey: 'L1', layerLabel: 'L1 (S01)', conditionLabel: 'C1', isPor: true, values: { exposure: '25' } },
  { id: '2', layerKey: 'L1', layerLabel: 'L1 (S01)', conditionLabel: 'C2', isPor: false, values: {} },
  { id: '3', layerKey: 'L2', layerLabel: 'L2 (S02)', conditionLabel: 'C1', isPor: true, values: { spin_speed: '1500' } },
]

describe('visibleParameterColumns', () => {
  it('returns all columns when no category is active', () => {
    expect(visibleParameterColumns(columns, null)).toHaveLength(4)
    expect(visibleParameterColumns(columns, undefined)).toHaveLength(4)
  })

  it('filters columns by category preserving order', () => {
    const visible = visibleParameterColumns(columns, 'coat')
    expect(visible.map((c) => c.key)).toEqual(['spin_speed', 'pr_type'])
  })

  it('returns a copy, not the original array', () => {
    const visible = visibleParameterColumns(columns, null)
    expect(visible).not.toBe(columns)
  })
})

describe('distinctCategories', () => {
  it('collects unique category codes in first-seen order, skipping null', () => {
    expect(distinctCategories(columns)).toEqual(['litho', 'coat'])
  })
})

describe('computeRowGroups', () => {
  it('groups consecutive rows sharing a layerKey', () => {
    const meta = computeRowGroups(rows)
    expect(meta.groups).toEqual([
      { layerKey: 'L1', layerLabel: 'L1 (S01)', startRow: 0, rowCount: 2 },
      { layerKey: 'L2', layerLabel: 'L2 (S02)', startRow: 2, rowCount: 1 },
    ])
  })

  it('marks only the first row of each group as a group start', () => {
    const meta = computeRowGroups(rows)
    expect(meta.isGroupStart).toEqual([true, false, true])
  })

  it('maps each row to its group index for alternating shading', () => {
    const meta = computeRowGroups(rows)
    expect(meta.groupIndexByRow).toEqual([0, 0, 1])
  })

  it('treats a later re-appearance of a layerKey as a new group (grouping is by adjacency)', () => {
    const interleaved: ConditionGridRow[] = [
      { id: '1', layerKey: 'L1', layerLabel: 'L1', conditionLabel: 'C1', isPor: true, values: {} },
      { id: '2', layerKey: 'L2', layerLabel: 'L2', conditionLabel: 'C1', isPor: true, values: {} },
      { id: '3', layerKey: 'L1', layerLabel: 'L1', conditionLabel: 'C2', isPor: false, values: {} },
    ]
    const meta = computeRowGroups(interleaved)
    expect(meta.groups).toHaveLength(3)
    expect(meta.isGroupStart).toEqual([true, true, true])
  })

  it('handles empty rows', () => {
    expect(computeRowGroups([])).toEqual({ groups: [], groupIndexByRow: [], isGroupStart: [] })
  })
})

describe('formatNumberDisplay', () => {
  it('appends the unit when a value is present', () => {
    expect(formatNumberDisplay('25', 'mJ')).toBe('25 mJ')
  })

  it('returns the bare value when there is no unit', () => {
    expect(formatNumberDisplay('25', null)).toBe('25')
    expect(formatNumberDisplay('25', undefined)).toBe('25')
  })

  it('returns an empty string for null/blank values', () => {
    expect(formatNumberDisplay(null, 'mJ')).toBe('')
    expect(formatNumberDisplay('', 'mJ')).toBe('')
    expect(formatNumberDisplay('   ', 'mJ')).toBe('')
  })
})

describe('matrixToTsv', () => {
  it('joins cells with tabs and rows with newlines', () => {
    expect(
      matrixToTsv([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ]),
    ).toBe('a\tb\tc\n1\t2\t3')
  })

  it('handles a single cell', () => {
    expect(matrixToTsv([['x']])).toBe('x')
  })
})

describe('resolveCellTarget', () => {
  const visible = visibleParameterColumns(columns, null)

  it('returns null for identity columns', () => {
    expect(resolveCellTarget(0, 0, visible, rows, IDENTITY_COLUMN_COUNT)).toBeNull()
    expect(resolveCellTarget(2, 0, visible, rows, IDENTITY_COLUMN_COUNT)).toBeNull()
  })

  it('maps the first parameter column and row to a domain target', () => {
    expect(resolveCellTarget(IDENTITY_COLUMN_COUNT, 0, visible, rows, IDENTITY_COLUMN_COUNT)).toEqual({
      conditionId: '1',
      parameterCode: 'exposure',
    })
  })

  it('maps an inner cell', () => {
    expect(resolveCellTarget(IDENTITY_COLUMN_COUNT + 1, 2, visible, rows, IDENTITY_COLUMN_COUNT)).toEqual({
      conditionId: '3',
      parameterCode: 'spin_speed',
    })
  })

  it('returns null when out of range', () => {
    expect(resolveCellTarget(999, 0, visible, rows, IDENTITY_COLUMN_COUNT)).toBeNull()
    expect(resolveCellTarget(IDENTITY_COLUMN_COUNT, 999, visible, rows, IDENTITY_COLUMN_COUNT)).toBeNull()
  })
})

describe('columnScrollIndex', () => {
  const visible = visibleParameterColumns(columns, null)

  it('offsets the parameter index by the identity column count', () => {
    expect(columnScrollIndex('exposure', visible, IDENTITY_COLUMN_COUNT)).toBe(IDENTITY_COLUMN_COUNT)
    expect(columnScrollIndex('memo', visible, IDENTITY_COLUMN_COUNT)).toBe(IDENTITY_COLUMN_COUNT + 3)
  })

  it('returns null for an unknown or filtered-out column', () => {
    expect(columnScrollIndex('nope', visible, IDENTITY_COLUMN_COUNT)).toBeNull()
    const coatOnly = visibleParameterColumns(columns, 'coat')
    expect(columnScrollIndex('exposure', coatOnly, IDENTITY_COLUMN_COUNT)).toBeNull()
  })
})

describe('cellScrollTarget', () => {
  const visible = visibleParameterColumns(columns, null)

  it('resolves a [col, row] target for a known cell', () => {
    expect(cellScrollTarget('3', 'spin_speed', visible, rows, IDENTITY_COLUMN_COUNT)).toEqual({
      col: IDENTITY_COLUMN_COUNT + 1,
      row: 2,
    })
  })

  it('returns null when the row or column is missing', () => {
    expect(cellScrollTarget('999', 'exposure', visible, rows, IDENTITY_COLUMN_COUNT)).toBeNull()
    expect(cellScrollTarget('1', 'nope', visible, rows, IDENTITY_COLUMN_COUNT)).toBeNull()
  })
})

describe('overlay indexing', () => {
  it('builds a lookup keyed by condition + parameter', () => {
    const statuses = indexStatuses([
      { conditionId: '1', parameterCode: 'exposure', state: 'error', message: 'bad' },
      { conditionId: '2', parameterCode: 'memo', state: 'dirty' },
    ])
    expect(statuses.get(overlayKey('1', 'exposure'))?.state).toBe('error')
    expect(statuses.get(overlayKey('2', 'memo'))?.state).toBe('dirty')
    expect(statuses.get(overlayKey('9', 'x'))).toBeUndefined()
  })

  it('indexes staging cells and tolerates undefined', () => {
    const staging = indexStaging([
      { conditionId: '1', parameterCode: 'exposure', value: 'abc', valid: false, message: 'not a number' },
    ])
    expect(staging.get(overlayKey('1', 'exposure'))?.valid).toBe(false)
    expect(indexStatuses(undefined).size).toBe(0)
    expect(indexStaging(undefined).size).toBe(0)
  })
})
