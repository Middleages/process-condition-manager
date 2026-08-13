import { describe, expect, it } from 'vitest'

import type { ChoiceOptionAggregate } from '@/api/types'
import type { ConditionGridColumn, ConditionGridRow, SheetChoiceResource } from '@/grid/types'

import {
  buildPasteStaging,
  parseTsv,
  persistablePasteCells,
  revalidatePasteStaging,
  sheetChoiceAuthorizationEpoch,
} from './pasteStaging'

// 컬럼 순서(= 화면에 보이는 순서): exposure(number) · spin_speed(number) · pr_type(choice) · memo(text)
const columns: ConditionGridColumn[] = [
  { key: 'exposure', headerName: '노광량', valueType: 'number', categoryCode: 'litho', unit: 'mJ', choiceSetCode: null, choiceSetVersion: null },
  { key: 'spin_speed', headerName: 'Spin', valueType: 'number', categoryCode: 'coat', unit: 'rpm', choiceSetCode: null, choiceSetVersion: null },
  { key: 'pr_type', headerName: 'PR', valueType: 'choice', categoryCode: 'coat', choiceSetCode: 'photo_resist', choiceSetVersion: 7 },
  { key: 'memo', headerName: '메모', valueType: 'text', categoryCode: null, choiceSetCode: null, choiceSetVersion: null },
]

const choiceAggregate: ChoiceOptionAggregate = {
  set_code: 'photo_resist',
  version: 7,
  items: [
    { code: 'pos', label: 'Positive', sort_order: 0, is_active: true },
    { code: 'neg', label: 'Negative', sort_order: 1, is_active: true },
    { code: 'old', label: 'Old', sort_order: 2, is_active: false },
  ],
}

const choiceResource: SheetChoiceResource = {
  setCode: 'photo_resist',
  targetVersion: 7,
  summaryVersion: 7,
  setIsActive: true,
  displayAggregate: choiceAggregate,
  selectableAggregate: choiceAggregate,
  selectionReady: true,
  isStale: false,
  loading: false,
  error: null,
  prepareToOpen: async () => undefined,
  retry: async () => undefined,
}

const choiceResources = new Map([['photo_resist', choiceResource]])

const rows: ConditionGridRow[] = [
  { id: '1', layerKey: 'L1', stepSeq: 'S01', layerId: 'L1', layerLabel: 'L1 (S01)', conditionLabel: 'C1', isPor: true, values: {} },
  { id: '2', layerKey: 'L1', stepSeq: 'S01', layerId: 'L1', layerLabel: 'L1 (S01)', conditionLabel: 'C2', isPor: false, values: {} },
  { id: '3', layerKey: 'L2', stepSeq: 'S02', layerId: 'L2', layerLabel: 'L2 (S02)', conditionLabel: 'C1', isPor: true, values: {} },
]

describe('parseTsv', () => {
  it('splits rows by newline and cells by tab', () => {
    expect(
      parseTsv('a\tb\tc\n1\t2\t3'),
    ).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('parses a single cell', () => {
    expect(parseTsv('5')).toEqual([['5']])
  })

  it('normalizes CRLF/CR to LF', () => {
    expect(parseTsv('a\tb\r\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseTsv('a\rb')).toEqual([['a'], ['b']])
  })

  it('drops a single trailing newline (Excel appends one)', () => {
    expect(parseTsv('1\t2\r\n')).toEqual([['1', '2']])
  })

  it('returns an empty matrix for empty input', () => {
    expect(parseTsv('')).toEqual([])
  })

  it('preserves an interior blank row as an empty-cell row', () => {
    expect(parseTsv('a\n\nb')).toEqual([['a'], [''], ['b']])
  })
})

describe('buildPasteStaging — mapping', () => {
  it('maps a matrix from the target top-left across the visible column order', () => {
    // 대상: (조건 '1', spin_speed) → 열은 spin_speed, pr_type / 행은 '1', '2'
    const result = buildPasteStaging(
      { conditionId: '1', parameterCode: 'spin_speed' },
      [
        ['1500', 'pos'],
        ['1600', 'neg'],
      ],
      columns,
      rows,
      choiceResources,
    )
    expect(result.truncatedRows).toBe(0)
    expect(result.truncatedCols).toBe(0)
    expect(result.staging).toEqual([
      { conditionId: '1', parameterCode: 'spin_speed', value: '1500', valid: true },
      { conditionId: '1', parameterCode: 'pr_type', value: 'pos', valid: true },
      { conditionId: '2', parameterCode: 'spin_speed', value: '1600', valid: true },
      { conditionId: '2', parameterCode: 'pr_type', value: 'neg', valid: true },
    ])
  })

  it('returns empty staging when the target column is not visible', () => {
    const result = buildPasteStaging(
      { conditionId: '1', parameterCode: 'nope' },
      [['1']],
      columns,
      rows,
      choiceResources,
    )
    expect(result).toEqual({ staging: [], truncatedRows: 0, truncatedCols: 0 })
  })

  it('returns empty staging when the target row is missing', () => {
    const result = buildPasteStaging(
      { conditionId: '999', parameterCode: 'exposure' },
      [['1']],
      columns,
      rows,
      choiceResources,
    )
    expect(result).toEqual({ staging: [], truncatedRows: 0, truncatedCols: 0 })
  })

  it('returns empty staging for an empty matrix', () => {
    const result = buildPasteStaging(
      { conditionId: '1', parameterCode: 'exposure' },
      [],
      columns,
      rows,
      choiceResources,
    )
    expect(result).toEqual({ staging: [], truncatedRows: 0, truncatedCols: 0 })
  })
})

describe('buildPasteStaging — number strict parsing', () => {
  const at = (raw: string) =>
    buildPasteStaging({ conditionId: '1', parameterCode: 'exposure' }, [[raw]], columns, rows, choiceResources)
      .staging[0]

  it('accepts integers and decimals (trimming surrounding space)', () => {
    expect(at('25')).toEqual({ conditionId: '1', parameterCode: 'exposure', value: '25', valid: true })
    expect(at('  1500  ')).toEqual({ conditionId: '1', parameterCode: 'exposure', value: '1500', valid: true })
    expect(at('-273.15')).toEqual({ conditionId: '1', parameterCode: 'exposure', value: '-273.15', valid: true })
  })

  it('rejects comma-formatted numbers, keeping the raw value for the user to fix', () => {
    const cell = at('1,234')
    expect(cell).toEqual({
      conditionId: '1',
      parameterCode: 'exposure',
      value: '1,234',
      valid: false,
      message: '올바른 소수 형식이 아닙니다.',
      errorCode: 'invalid_decimal',
    })
  })

  it('rejects other non-numeric formats (text, percent, scientific)', () => {
    expect(at('abc').valid).toBe(false)
    expect(at('50%').valid).toBe(false)
    expect(at('1e3').valid).toBe(false)
    expect(at('1500.').value).toBe('1500')
  })

  it('treats a blank cell as clearing the cell (null, always valid)', () => {
    expect(at('')).toEqual({ conditionId: '1', parameterCode: 'exposure', value: null, valid: true })
    expect(at('   ')).toEqual({ conditionId: '1', parameterCode: 'exposure', value: null, valid: true })
  })
})

describe('buildPasteStaging — choice matching', () => {
  const at = (raw: string) =>
    buildPasteStaging({ conditionId: '1', parameterCode: 'pr_type' }, [[raw]], columns, rows, choiceResources)
      .staging[0]

  it('accepts a value present in the shared selectable aggregate', () => {
    expect(at('pos')).toEqual({ conditionId: '1', parameterCode: 'pr_type', value: 'pos', valid: true })
  })

  it('rejects a value not in choiceOptions', () => {
    expect(at('unknown')).toEqual({
      conditionId: '1',
      parameterCode: 'pr_type',
      value: 'unknown',
      valid: false,
      message: '현재 선택지에 없는 코드입니다.',
      errorCode: 'choice_unknown',
    })
  })

  it('rejects a newly pasted inactive code with the shared domain identifier', () => {
    expect(at('old')).toEqual(
      expect.objectContaining({ valid: false, errorCode: 'choice_option_inactive' }),
    )
  })

  it('uses the displayed dirty overlay as old-value context for unchanged inactive cells', () => {
    const displayedRows = [{ ...rows[0], values: { pr_type: 'old' } }, ...rows.slice(1)]
    expect(
      buildPasteStaging(
        { conditionId: '1', parameterCode: 'pr_type' },
        [['old']],
        columns,
        displayedRows,
        choiceResources,
      ).staging[0],
    ).toEqual({ conditionId: '1', parameterCode: 'pr_type', value: 'old', valid: true })
  })

  it('rejects an unchanged stored raw code that the exact aggregate confirms is unknown', () => {
    const displayedRows = [{ ...rows[0], values: { pr_type: 'RAW' } }, ...rows.slice(1)]

    expect(
      buildPasteStaging(
        { conditionId: '1', parameterCode: 'pr_type' },
        [['RAW']],
        columns,
        displayedRows,
        choiceResources,
      ).staging[0],
    ).toEqual({
      conditionId: '1',
      parameterCode: 'pr_type',
      value: 'RAW',
      valid: false,
      message: '현재 선택지에 없는 코드입니다.',
      errorCode: 'choice_unknown',
    })
  })

  it('rejects an unchanged unknown raw code from an exact loaded inactive set', () => {
    const displayedRows = [{ ...rows[0], values: { pr_type: 'RAW' } }, ...rows.slice(1)]
    const inactiveResources = new Map([
      [
        'photo_resist',
        {
          ...choiceResource,
          setIsActive: false,
          selectableAggregate: null,
          selectionReady: false,
        },
      ],
    ])

    expect(
      buildPasteStaging(
        { conditionId: '1', parameterCode: 'pr_type' },
        [['RAW']],
        columns,
        displayedRows,
        inactiveResources,
      ).staging[0],
    ).toEqual(expect.objectContaining({ valid: false, errorCode: 'choice_unknown' }))
  })

  it('omits an unavailable-resource raw no-op from a mixed persisted batch', () => {
    const displayedRows = [{ ...rows[0], values: { pr_type: 'RAW' } }, ...rows.slice(1)]
    const unavailableResources = new Map([
      [
        'photo_resist',
        {
          ...choiceResource,
          displayAggregate: null,
          selectableAggregate: null,
          selectionReady: false,
          isStale: true,
          error: 'network',
        },
      ],
    ])
    const staged = buildPasteStaging(
      { conditionId: '1', parameterCode: 'pr_type' },
      [['RAW', 'changed memo']],
      columns,
      displayedRows,
      unavailableResources,
    )

    expect(staged.staging).toHaveLength(2)
    expect(persistablePasteCells(staged, displayedRows)).toEqual([
      { conditionId: '1', parameterCode: 'memo', value: 'changed memo' },
    ])
  })

  it('treats a blank choice cell as clearing (null, valid)', () => {
    expect(at('').value).toBeNull()
    expect(at('').valid).toBe(true)
  })
})

describe('paste choice authorization refresh', () => {
  it('changes the callback epoch when exact selectable authorization changes', () => {
    const unavailable = new Map([
      [
        'photo_resist',
        { ...choiceResource, selectionReady: false, selectableAggregate: null },
      ],
    ])

    expect(sheetChoiceAuthorizationEpoch(unavailable)).not.toBe(
      sheetChoiceAuthorizationEpoch(choiceResources),
    )
  })

  it('changes the callback epoch when an inactive set gains exact knownness', () => {
    const unavailable = new Map([
      [
        'photo_resist',
        {
          ...choiceResource,
          setIsActive: false,
          displayAggregate: null,
          selectableAggregate: null,
          selectionReady: false,
          isStale: true,
        },
      ],
    ])
    const exactInactive = new Map([
      [
        'photo_resist',
        {
          ...choiceResource,
          setIsActive: false,
          selectableAggregate: null,
          selectionReady: false,
        },
      ],
    ])

    expect(sheetChoiceAuthorizationEpoch(unavailable)).not.toBe(
      sheetChoiceAuthorizationEpoch(exactInactive),
    )
  })

  it('revalidates a staged active code against the latest aggregate before allocation', () => {
    const staged = buildPasteStaging(
      { conditionId: '1', parameterCode: 'pr_type' },
      [['pos']],
      columns,
      rows,
      choiceResources,
    )
    const versionEight: ChoiceOptionAggregate = {
      set_code: 'photo_resist',
      version: 8,
      items: [{ code: 'pos', label: 'Positive', sort_order: 0, is_active: false }],
    }
    const latestResources = new Map([
      [
        'photo_resist',
        {
          ...choiceResource,
          targetVersion: 8,
          summaryVersion: 8,
          displayAggregate: versionEight,
          selectableAggregate: versionEight,
        },
      ],
    ])

    expect(
      revalidatePasteStaging(staged, columns, rows, latestResources).staging[0],
    ).toEqual({
      conditionId: '1',
      parameterCode: 'pr_type',
      value: 'pos',
      valid: false,
      message: '사용 중지된 선택지는 새 값으로 저장할 수 없습니다.',
      errorCode: 'choice_option_inactive',
    })
  })
})

describe('buildPasteStaging — text', () => {
  it('always accepts text values (trimmed)', () => {
    const result = buildPasteStaging(
      { conditionId: '1', parameterCode: 'memo' },
      [['  자유 입력  ']],
      columns,
      rows,
      choiceResources,
    )
    expect(result.staging[0]).toEqual({
      conditionId: '1',
      parameterCode: 'memo',
      value: '자유 입력',
      valid: true,
    })
  })
})

describe('buildPasteStaging — boundary truncation', () => {
  it('truncates rows past the sheet end and reports the count', () => {
    // 대상 행 '3'(마지막). 붙여넣기 3행 → 1행만 매핑, 2행은 잘림.
    const result = buildPasteStaging(
      { conditionId: '3', parameterCode: 'exposure' },
      [['10'], ['20'], ['30']],
      columns,
      rows,
      choiceResources,
    )
    expect(result.truncatedRows).toBe(2)
    expect(result.truncatedCols).toBe(0)
    expect(result.staging).toEqual([
      { conditionId: '3', parameterCode: 'exposure', value: '10', valid: true },
    ])
  })

  it('truncates columns past the last visible column and reports the count', () => {
    // 대상 열 pr_type(끝에서 두 번째). 폭 3 → 2열(pr_type, memo)만 매핑, 1열 잘림.
    const result = buildPasteStaging(
      { conditionId: '1', parameterCode: 'pr_type' },
      [['pos', 'note', 'overflow']],
      columns,
      rows,
      choiceResources,
    )
    expect(result.truncatedRows).toBe(0)
    expect(result.truncatedCols).toBe(1)
    expect(result.staging.map((cell) => cell.parameterCode)).toEqual(['pr_type', 'memo'])
  })

  it('truncates both dimensions at once', () => {
    const result = buildPasteStaging(
      { conditionId: '3', parameterCode: 'pr_type' },
      [
        ['pos', 'x', 'y'],
        ['neg', 'z', 'w'],
      ],
      columns,
      rows,
      choiceResources,
    )
    expect(result.truncatedRows).toBe(1)
    expect(result.truncatedCols).toBe(1)
    expect(result.staging).toEqual([
      { conditionId: '3', parameterCode: 'pr_type', value: 'pos', valid: true },
      { conditionId: '3', parameterCode: 'memo', value: 'x', valid: true },
    ])
  })
})
