import { describe, expect, it } from 'vitest'

import type { ChoiceOptionAggregate } from '@/api/types'

import type { ConditionGridColumn, SheetChoiceResource } from './types'
import {
  shouldPersistCellChange,
  validateCellCandidate,
  validatePasteCell,
  validateSingleCellEdit,
} from './cellValue'

const baseColumn = {
  headerName: 'Value',
  categoryCode: null,
  unit: null,
  description: null,
  choiceSetCode: null,
  choiceSetVersion: null,
  required: false,
  minValue: null,
  maxValue: null,
} as const

const textColumn: ConditionGridColumn = { ...baseColumn, key: 'memo', valueType: 'text' }
const numberColumn: ConditionGridColumn = { ...baseColumn, key: 'decimal', valueType: 'number' }
const choiceColumn: ConditionGridColumn = {
  ...baseColumn,
  key: 'mode',
  valueType: 'choice',
  choiceSetCode: 'equipment_mode',
  choiceSetVersion: 7,
}

const boundedNumber: ConditionGridColumn = {
  ...numberColumn,
  required: true,
  minValue: '0',
  maxValue: '500',
  unit: 'kPa',
}

const aggregate: ChoiceOptionAggregate = {
  set_code: 'equipment_mode',
  version: 7,
  items: [
    { code: 'AUTO', label: 'Automatic', sort_order: 0, is_active: true },
    { code: 'LEGACY', label: 'Legacy', sort_order: 1, is_active: false },
  ],
}

function resource(overrides: Partial<SheetChoiceResource> = {}): SheetChoiceResource {
  return {
    setCode: 'equipment_mode',
    targetVersion: 7,
    summaryVersion: 7,
    setIsActive: true,
    displayAggregate: aggregate,
    selectableAggregate: aggregate,
    selectionReady: true,
    isStale: false,
    loading: false,
    error: null,
    prepareToOpen: async () => undefined,
    retry: async () => undefined,
    ...overrides,
  }
}

describe('validateCellCandidate', () => {
  it('omits normalized true no-ops from persistence', () => {
    expect(shouldPersistCellChange('RAW', 'RAW')).toBe(false)
    expect(shouldPersistCellChange(null, null)).toBe(false)
    expect(shouldPersistCellChange('RAW', 'AUTO')).toBe(true)
  })

  it('trims text and treats blank input as clear', () => {
    expect(validateCellCandidate(textColumn, 'old', '  note  ')).toEqual({ ok: true, value: 'note' })
    expect(validateCellCandidate(textColumn, 'old', '   ')).toEqual({ ok: true, value: null })
  })

  it.each([
    ['001.5000', '1.5'],
    ['.5', '0.5'],
    ['1.', '1'],
    ['-0.000', '0'],
    ['-.5000', '-0.5'],
    ['000', '0'],
  ])('canonicalizes decimal %s to %s without a number value', (raw, expected) => {
    const result = validateCellCandidate(numberColumn, null, raw)
    expect(result).toEqual({ ok: true, value: expected })
    if (result.ok) expect(typeof result.value).not.toBe('number')
  })

  it.each(['1e3', '1,000', '+1', '9'.repeat(129)])('rejects invalid decimal %s', (raw) => {
    expect(validateCellCandidate(numberColumn, null, raw)).toEqual(
      expect.objectContaining({ ok: false, code: 'invalid_decimal' }),
    )
  })

  it('requires a value for required columns', () => {
    expect(validateSingleCellEdit(boundedNumber, '100', '')).toEqual({
      ok: false,
      code: 'required_value',
      message: '필수값을 입력하세요',
      constraint: null,
      rawValue: '',
    })
  })

  it('rejects normalized decimals outside configured bounds without number conversion', () => {
    expect(validateSingleCellEdit(boundedNumber, '100', '501')).toEqual({
      ok: false,
      code: 'number_out_of_range',
      message: '허용 범위를 벗어났습니다',
      constraint: '0–500 kPa 범위로 입력하세요',
      rawValue: '501',
    })
    expect(
      validateSingleCellEdit(
        { ...boundedNumber, minValue: '9007199254740993', maxValue: null },
        null,
        '9007199254740992.9999',
      ),
    ).toMatchObject({ ok: false, code: 'number_out_of_range' })
  })

  it('accepts a changed active known choice', () => {
    expect(validateCellCandidate(choiceColumn, null, ' AUTO ', resource())).toEqual({
      ok: true,
      value: 'AUTO',
    })
  })

  it('allows an unchanged stored inactive or raw value as a no-op', () => {
    expect(validateCellCandidate(choiceColumn, 'LEGACY', 'LEGACY', resource())).toEqual({
      ok: true,
      value: 'LEGACY',
    })
    expect(
      validateCellCandidate(
        choiceColumn,
        'RAW',
        'RAW',
        resource({
          displayAggregate: null,
          selectableAggregate: null,
          selectionReady: false,
          isStale: true,
          error: 'network',
        }),
      ),
    ).toEqual({ ok: true, value: 'RAW' })
  })

  it('rejects an unchanged stored raw code when the exact aggregate confirms it is unknown', () => {
    expect(validateSingleCellEdit(choiceColumn, 'RAW', ' RAW ', resource())).toEqual(
      expect.objectContaining({ ok: false, code: 'choice_unknown' }),
    )
  })

  it('uses an exact inactive-set aggregate for knownness without allowing new selection', () => {
    const inactiveSet = resource({
      setIsActive: false,
      selectableAggregate: null,
      selectionReady: false,
    })

    expect(validateSingleCellEdit(choiceColumn, 'LEGACY', 'LEGACY', inactiveSet)).toEqual({
      ok: true,
      value: 'LEGACY',
    })
    expect(validateSingleCellEdit(choiceColumn, 'RAW', 'RAW', inactiveSet)).toEqual(
      expect.objectContaining({ ok: false, code: 'choice_unknown' }),
    )
    expect(validateSingleCellEdit(choiceColumn, null, 'AUTO', inactiveSet)).toEqual(
      expect.objectContaining({ ok: false, code: 'choice_set_inactive' }),
    )
  })

  it('rejects changed inactive, unknown, inactive-set, and stale-resource choices', () => {
    expect(validateCellCandidate(choiceColumn, null, 'LEGACY', resource())).toEqual(
      expect.objectContaining({ ok: false, code: 'choice_option_inactive' }),
    )
    expect(validateCellCandidate(choiceColumn, null, 'UNKNOWN', resource())).toEqual(
      expect.objectContaining({ ok: false, code: 'choice_unknown' }),
    )
    expect(
      validateCellCandidate(choiceColumn, null, 'AUTO', resource({ setIsActive: false })),
    ).toEqual(expect.objectContaining({ ok: false, code: 'choice_set_inactive' }))
    expect(
      validateCellCandidate(
        choiceColumn,
        null,
        'AUTO',
        resource({ selectionReady: false, selectableAggregate: null }),
      ),
    ).toEqual(expect.objectContaining({ ok: false, code: 'choice_resource_unavailable' }))
  })

  it('always allows clearing even when the choice resource is stale or inactive', () => {
    expect(
      validateCellCandidate(
        choiceColumn,
        'AUTO',
        ' ',
        resource({ setIsActive: false, selectionReady: false, selectableAggregate: null }),
      ),
    ).toEqual({ ok: true, value: null })
  })
})

describe('single/paste validation equivalence', () => {
  it.each([
    [numberColumn, '1', '001.5000', undefined],
    [numberColumn, null, '1e3', undefined],
    [choiceColumn, null, 'AUTO', resource()],
    [choiceColumn, null, 'LEGACY', resource()],
    [choiceColumn, null, 'UNKNOWN', resource()],
  ] as const)('returns the same value/error identifier', (column, oldValue, raw, context) => {
    expect(validateSingleCellEdit(column, oldValue, raw, context)).toEqual(
      validatePasteCell(column, oldValue, raw, context),
    )
  })
})
