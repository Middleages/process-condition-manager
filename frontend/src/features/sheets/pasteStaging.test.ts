import { describe, expect, it } from 'vitest'

import type { ConditionGridColumn, ConditionGridRow } from '@/grid/types'

import { buildPasteStaging, parseTsv } from './pasteStaging'

// 컬럼 순서(= 화면에 보이는 순서): exposure(number) · spin_speed(number) · pr_type(choice) · memo(text)
const columns: ConditionGridColumn[] = [
  { key: 'exposure', headerName: '노광량', valueType: 'number', categoryCode: 'litho', unit: 'mJ' },
  { key: 'spin_speed', headerName: 'Spin', valueType: 'number', categoryCode: 'coat', unit: 'rpm' },
  { key: 'pr_type', headerName: 'PR', valueType: 'choice', categoryCode: 'coat', choiceOptions: ['pos', 'neg'] },
  { key: 'memo', headerName: '메모', valueType: 'text', categoryCode: null },
]

const rows: ConditionGridRow[] = [
  { id: '1', layerKey: 'L1', layerLabel: 'L1 (S01)', conditionLabel: 'C1', isPor: true, values: {} },
  { id: '2', layerKey: 'L1', layerLabel: 'L1 (S01)', conditionLabel: 'C2', isPor: false, values: {} },
  { id: '3', layerKey: 'L2', layerLabel: 'L2 (S02)', conditionLabel: 'C1', isPor: true, values: {} },
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
    )
    expect(result).toEqual({ staging: [], truncatedRows: 0, truncatedCols: 0 })
  })

  it('returns empty staging when the target row is missing', () => {
    const result = buildPasteStaging(
      { conditionId: '999', parameterCode: 'exposure' },
      [['1']],
      columns,
      rows,
    )
    expect(result).toEqual({ staging: [], truncatedRows: 0, truncatedCols: 0 })
  })

  it('returns empty staging for an empty matrix', () => {
    const result = buildPasteStaging(
      { conditionId: '1', parameterCode: 'exposure' },
      [],
      columns,
      rows,
    )
    expect(result).toEqual({ staging: [], truncatedRows: 0, truncatedCols: 0 })
  })
})

describe('buildPasteStaging — number strict parsing', () => {
  const at = (raw: string) =>
    buildPasteStaging({ conditionId: '1', parameterCode: 'exposure' }, [[raw]], columns, rows)
      .staging[0]

  it('accepts integers and decimals (trimming surrounding space)', () => {
    expect(at('25')).toEqual({ conditionId: '1', parameterCode: 'exposure', value: '25', valid: true })
    expect(at('  1500  ')).toEqual({ conditionId: '1', parameterCode: 'exposure', value: '1500', valid: true })
    expect(at('-273.15')).toEqual({ conditionId: '1', parameterCode: 'exposure', value: '-273.15', valid: true })
  })

  it('rejects comma-formatted numbers, keeping the raw value for the user to fix', () => {
    // "1,234"는 정규식에서 걸러지고 Number("1,234")도 NaN이라 이중으로 안전하다.
    expect(Number('1,234')).toBeNaN()
    const cell = at('1,234')
    expect(cell).toEqual({
      conditionId: '1',
      parameterCode: 'exposure',
      value: '1,234',
      valid: false,
      message: '숫자 형식이 아니다',
    })
  })

  it('rejects other non-numeric formats (text, percent, scientific)', () => {
    expect(at('abc').valid).toBe(false)
    expect(at('50%').valid).toBe(false)
    expect(at('1e3').valid).toBe(false)
    expect(at('1500.').valid).toBe(false)
  })

  it('treats a blank cell as clearing the cell (null, always valid)', () => {
    expect(at('')).toEqual({ conditionId: '1', parameterCode: 'exposure', value: null, valid: true })
    expect(at('   ')).toEqual({ conditionId: '1', parameterCode: 'exposure', value: null, valid: true })
  })
})

describe('buildPasteStaging — choice matching', () => {
  const at = (raw: string) =>
    buildPasteStaging({ conditionId: '1', parameterCode: 'pr_type' }, [[raw]], columns, rows)
      .staging[0]

  it('accepts a value present in choiceOptions', () => {
    expect(at('pos')).toEqual({ conditionId: '1', parameterCode: 'pr_type', value: 'pos', valid: true })
  })

  it('rejects a value not in choiceOptions', () => {
    expect(at('unknown')).toEqual({
      conditionId: '1',
      parameterCode: 'pr_type',
      value: 'unknown',
      valid: false,
      message: '선택지에 없는 값이다',
    })
  })

  it('treats a blank choice cell as clearing (null, valid)', () => {
    expect(at('').value).toBeNull()
    expect(at('').valid).toBe(true)
  })
})

describe('buildPasteStaging — text', () => {
  it('always accepts text values (trimmed)', () => {
    const result = buildPasteStaging(
      { conditionId: '1', parameterCode: 'memo' },
      [['  자유 입력  ']],
      columns,
      rows,
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
    )
    expect(result.truncatedRows).toBe(1)
    expect(result.truncatedCols).toBe(1)
    expect(result.staging).toEqual([
      { conditionId: '3', parameterCode: 'pr_type', value: 'pos', valid: true },
      { conditionId: '3', parameterCode: 'memo', value: 'x', valid: true },
    ])
  })
})
