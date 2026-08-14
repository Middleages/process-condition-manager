import { describe, expect, it } from 'vitest'

import {
  IDENTITY_COLUMN_COUNT,
  IDENTITY_COLUMNS,
  cellScrollTarget,
  columnScrollIndex,
  conditionRowScrollTarget,
  computeRowGroups,
  distinctCategories,
  formatNumberDisplay,
  headerTooltip,
  indexStaging,
  indexStatuses,
  layersMissingPor,
  matrixToTsv,
  overlayKey,
  previewCellValue,
  resolveColumnJump,
  resolveCellTarget,
  visibleParameterColumns,
} from './model'
import type { ConditionGridColumn, ConditionGridRow } from './types'

const columns: ConditionGridColumn[] = [
  { key: 'exposure', headerName: '노광량', valueType: 'number', categoryCode: 'litho', unit: 'mJ', choiceSetCode: null, choiceSetVersion: null, required: false, minValue: null, maxValue: null,},
  { key: 'spin_speed', headerName: 'Spin', valueType: 'number', categoryCode: 'coat', unit: 'rpm', choiceSetCode: null, choiceSetVersion: null, required: false, minValue: null, maxValue: null,},
  { key: 'pr_type', headerName: 'PR', valueType: 'choice', categoryCode: 'coat', choiceSetCode: 'photo_resist', choiceSetVersion: 7, required: false, minValue: null, maxValue: null,},
  { key: 'memo', headerName: '메모', valueType: 'text', categoryCode: null, choiceSetCode: null, choiceSetVersion: null, required: false, minValue: null, maxValue: null,},
]

const rows: ConditionGridRow[] = [
  { id: '1', layerKey: 'L1', stepSeq: 'S01', layerId: 'L1', layerLabel: 'L1 (S01)', conditionLabel: 'C1', isPor: true, values: { exposure: '25' } },
  { id: '2', layerKey: 'L1', stepSeq: 'S01', layerId: 'L1', layerLabel: 'L1 (S01)', conditionLabel: 'C2', isPor: false, values: {} },
  { id: '3', layerKey: 'L2', stepSeq: 'S02', layerId: 'L2', layerLabel: 'L2 (S02)', conditionLabel: 'C1', isPor: true, values: { spin_speed: '1500' } },
]

describe('identity columns', () => {
  it('defines the four approved frozen identity columns', () => {
    expect(IDENTITY_COLUMNS).toEqual([
      { id: '__step_seq__', title: 'STEP SEQ' },
      { id: '__layer__', title: 'LAYER' },
      { id: '__condition__', title: '조건' },
      { id: '__por__', title: 'POR' },
    ])
    expect(IDENTITY_COLUMN_COUNT).toBe(4)
  })
})

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
      { id: '1', layerKey: 'L1', stepSeq: 'S01', layerId: 'L1', layerLabel: 'L1', conditionLabel: 'C1', isPor: true, values: {} },
      { id: '2', layerKey: 'L2', stepSeq: 'S02', layerId: 'L2', layerLabel: 'L2', conditionLabel: 'C1', isPor: true, values: {} },
      { id: '3', layerKey: 'L1', stepSeq: 'S01', layerId: 'L1', layerLabel: 'L1', conditionLabel: 'C2', isPor: false, values: {} },
    ]
    const meta = computeRowGroups(interleaved)
    expect(meta.groups).toHaveLength(3)
    expect(meta.isGroupStart).toEqual([true, true, true])
  })

  it('handles empty rows', () => {
    expect(computeRowGroups([])).toEqual({ groups: [], groupIndexByRow: [], isGroupStart: [] })
  })
})

describe('layersMissingPor', () => {
  it('returns layer groups that have no POR row', () => {
    // L1 has a POR row (id 1); L2 has none.
    const withGap: ConditionGridRow[] = [
      { id: '1', layerKey: 'L1', stepSeq: 'S01', layerId: 'L1', layerLabel: 'L1 (S01)', conditionLabel: 'C1', isPor: true, values: {} },
      { id: '2', layerKey: 'L1', stepSeq: 'S01', layerId: 'L1', layerLabel: 'L1 (S01)', conditionLabel: 'C2', isPor: false, values: {} },
      { id: '3', layerKey: 'L2', stepSeq: 'S02', layerId: 'L2', layerLabel: 'L2 (S02)', conditionLabel: 'C1', isPor: false, values: {} },
      { id: '4', layerKey: 'L2', stepSeq: 'S02', layerId: 'L2', layerLabel: 'L2 (S02)', conditionLabel: 'C2', isPor: false, values: {} },
    ]
    const missing = layersMissingPor(withGap)
    expect(missing.map((group) => group.layerKey)).toEqual(['L2'])
    expect(missing[0]).toMatchObject({ layerLabel: 'L2 (S02)', startRow: 2, rowCount: 2 })
  })

  it('returns an empty list when every layer has a POR row', () => {
    // `rows` fixture: L1 (POR on id 1) and L2 (POR on id 3).
    expect(layersMissingPor(rows)).toEqual([])
  })

  it('flags every layer when none has a POR row', () => {
    const none: ConditionGridRow[] = [
      { id: '1', layerKey: 'L1', stepSeq: 'S01', layerId: 'L1', layerLabel: 'L1', conditionLabel: 'C1', isPor: false, values: {} },
      { id: '2', layerKey: 'L2', stepSeq: 'S02', layerId: 'L2', layerLabel: 'L2', conditionLabel: 'C1', isPor: false, values: {} },
    ]
    expect(layersMissingPor(none).map((group) => group.layerKey)).toEqual(['L1', 'L2'])
  })

  it('handles empty rows', () => {
    expect(layersMissingPor([])).toEqual([])
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

describe('resolveColumnJump', () => {
  it('returns empty for a blank query', () => {
    expect(resolveColumnJump(columns, 'coat', '   ')).toEqual({ kind: 'empty' })
  })

  it('finds a visible key without changing category', () => {
    expect(resolveColumnJump(columns, 'coat', 'spin')).toEqual({
      kind: 'match',
      parameterCode: 'spin_speed',
      categoryCode: 'coat',
      requiresCategoryChange: false,
    })
  })

  it('finds a hidden category and requests the category change before the jump', () => {
    expect(resolveColumnJump(columns, 'litho', 'spin')).toEqual({
      kind: 'match',
      parameterCode: 'spin_speed',
      categoryCode: 'coat',
      requiresCategoryChange: true,
    })
  })

  it('changes to the all-columns view for an uncategorized hidden column', () => {
    expect(resolveColumnJump(columns, 'coat', 'memo')).toEqual({
      kind: 'match',
      parameterCode: 'memo',
      categoryCode: null,
      requiresCategoryChange: true,
    })
  })

  it('returns not-found for an unknown query', () => {
    expect(resolveColumnJump(columns, null, 'missing')).toEqual({ kind: 'not-found' })
  })

  it('prefers a later visible match over an earlier hidden match', () => {
    const duplicateMatches: ConditionGridColumn[] = [
      { key: 'spin_hidden', headerName: 'Spin hidden', valueType: 'number', categoryCode: 'litho', choiceSetCode: null, choiceSetVersion: null, required: false, minValue: null, maxValue: null,},
      { key: 'spin_visible', headerName: 'Spin visible', valueType: 'number', categoryCode: 'coat', choiceSetCode: null, choiceSetVersion: null, required: false, minValue: null, maxValue: null,},
    ]

    expect(resolveColumnJump(duplicateMatches, 'coat', '  SPIN  ')).toEqual({
      kind: 'match',
      parameterCode: 'spin_visible',
      categoryCode: 'coat',
      requiresCategoryChange: false,
    })
  })

  it('matches trimmed keys and headers case-insensitively', () => {
    const padded: ConditionGridColumn[] = [
      { key: '  TEMP_CODE  ', headerName: '  Bake Temperature  ', valueType: 'number', categoryCode: 'bake', choiceSetCode: null, choiceSetVersion: null, required: false, minValue: null, maxValue: null,},
    ]

    expect(resolveColumnJump(padded, null, 'temperature')).toMatchObject({
      kind: 'match',
      parameterCode: '  TEMP_CODE  ',
    })
    expect(resolveColumnJump(padded, null, 'temp_code')).toMatchObject({
      kind: 'match',
      parameterCode: '  TEMP_CODE  ',
    })
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

describe('conditionRowScrollTarget', () => {
  it('targets the Step Seq cell for a known condition row', () => {
    expect(conditionRowScrollTarget('3', rows)).toEqual({ col: 0, row: 2 })
  })

  it('returns null when the condition row is missing', () => {
    expect(conditionRowScrollTarget('missing', rows)).toBeNull()
  })
})

describe('overlay indexing', () => {
  it('builds a lookup keyed by condition + parameter', () => {
    const statuses = indexStatuses([
      {
        conditionId: '1',
        parameterCode: 'exposure',
        validation: { severity: 'error', count: 1, message: 'bad' },
        dirty: false,
      },
      { conditionId: '2', parameterCode: 'memo', dirty: true },
    ])
    expect(statuses.get(overlayKey('1', 'exposure'))?.validation?.severity).toBe('error')
    expect(statuses.get(overlayKey('2', 'memo'))?.dirty).toBe(true)
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

describe('previewCellValue', () => {
  it('shows the staged value without mutating the server value', () => {
    const staging = {
      conditionId: '1',
      parameterCode: 'exposure',
      value: '42',
      valid: true,
    }
    expect(previewCellValue('25', staging)).toBe('42')
    expect(staging.value).toBe('42')
  })

  it('shows invalid and cleared staged values, and falls back when staging is absent', () => {
    expect(
      previewCellValue('25', {
        conditionId: '1',
        parameterCode: 'exposure',
        value: 'abc',
        valid: false,
      }),
    ).toBe('abc')
    expect(
      previewCellValue('25', {
        conditionId: '1',
        parameterCode: 'exposure',
        value: null,
        valid: true,
      }),
    ).toBeNull()
    expect(previewCellValue('25', undefined)).toBe('25')
  })
})

describe('headerTooltip', () => {
  const described: ConditionGridColumn[] = [
    {
      key: 'exposure',
      headerName: 'EXP',
      valueType: 'number',
      categoryCode: 'litho',
      description: '노광량 (exposure dose)',
      choiceSetCode: null,
      choiceSetVersion: null, required: false, minValue: null, maxValue: null,
    },
    { key: 'spin_speed', headerName: 'SPN', valueType: 'number', categoryCode: 'coat', description: '   ', choiceSetCode: null, choiceSetVersion: null, required: false, minValue: null, maxValue: null,},
    { key: 'pr_type', headerName: 'PR', valueType: 'choice', categoryCode: 'coat', choiceSetCode: 'photo_resist', choiceSetVersion: 7, required: false, minValue: null, maxValue: null,},
  ]

  it('returns the description for a parameter header, offset by the identity count', () => {
    expect(headerTooltip(IDENTITY_COLUMN_COUNT, described, IDENTITY_COLUMN_COUNT)).toBe('노광량 (exposure dose)')
  })

  it('returns null for the left-fixed identity columns', () => {
    expect(headerTooltip(0, described, IDENTITY_COLUMN_COUNT)).toBeNull()
    expect(headerTooltip(IDENTITY_COLUMN_COUNT - 1, described, IDENTITY_COLUMN_COUNT)).toBeNull()
  })

  it('returns null when the column has no description or only whitespace', () => {
    expect(headerTooltip(IDENTITY_COLUMN_COUNT + 1, described, IDENTITY_COLUMN_COUNT)).toBeNull() // blank
    expect(headerTooltip(IDENTITY_COLUMN_COUNT + 2, described, IDENTITY_COLUMN_COUNT)).toBeNull() // missing
  })

  it('returns null when the column index is out of range', () => {
    expect(headerTooltip(999, described, IDENTITY_COLUMN_COUNT)).toBeNull()
  })
})
