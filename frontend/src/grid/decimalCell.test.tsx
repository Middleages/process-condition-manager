import { describe, expect, it, vi } from 'vitest'

import {
  commitDecimalDraft,
  makeDecimalCell,
  validateDecimalDraft,
} from './decimalCell'
import decimalCellSource from './decimalCell.tsx?raw'
import glideSource from './GlideConditionGrid.tsx?raw'

describe('decimalCell', () => {
  it('keeps cell data and copyData as canonical strings', () => {
    const cell = makeDecimalCell('12345678901234567890.0001', 'nm', false)
    expect(cell.data.value).toBe('12345678901234567890.0001')
    expect(cell.copyData).toBe('12345678901234567890.0001')
    expect(typeof cell.data.value).toBe('string')
  })

  it.each([
    ['.5', '0.5'],
    ['001.5000', '1.5'],
    ['', null],
  ])('commits %s as the canonical string %s', (draft, expected) => {
    const commit = vi.fn()
    expect(commitDecimalDraft(draft, commit)).toEqual({ ok: true, value: expected })
    expect(commit).toHaveBeenCalledWith(expected)
  })

  it.each(['1e3', '1,000', '9'.repeat(129)])(
    'keeps invalid draft %s in validation state without committing',
    (draft) => {
      const commit = vi.fn()
      expect(commitDecimalDraft(draft, commit)).toEqual(
        expect.objectContaining({ ok: false, code: 'invalid_decimal' }),
      )
      expect(validateDecimalDraft(draft)).toEqual(
        expect.objectContaining({ ok: false, message: expect.any(String) }),
      )
      expect(commit).not.toHaveBeenCalled()
    },
  )

  it('is the only numeric Glide path and delegates commit validation to the shared validator', () => {
    expect(glideSource).toContain('makeDecimalCell')
    expect(glideSource).toContain('validateSingleCellEdit')
    expect(glideSource).toContain('shouldPersistCellChange(oldValue, validation.value)')
    expect(decimalCellSource).toContain('event.stopPropagation()')
    expect(glideSource).not.toContain('GridCellKind.Number')
    expect(glideSource).not.toMatch(/Number\(trimmed\)/)
  })
})
