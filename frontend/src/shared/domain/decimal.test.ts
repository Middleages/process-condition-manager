import { describe, expect, it } from 'vitest'

import { compareCanonicalDecimals, normalizeDecimalInput } from './decimal'

describe('decimal contract', () => {
  it.each([
    [' 001.5000 ', '1.5'],
    ['.5', '0.5'],
    ['1.', '1'],
    ['-0.000', '0'],
    ['-.5000', '-0.5'],
    ['000', '0'],
  ])('normalizes %s to %s', (raw, expected) => {
    expect(normalizeDecimalInput(raw)).toEqual({ kind: 'valid', value: expected })
  })

  it.each(['+1', '1e3', '1,000', '1_000', 'NaN', 'Infinity', '--1', '.', '١', '１'])(
    'rejects %s',
    (raw) => expect(normalizeDecimalInput(raw).kind).toBe('invalid'),
  )

  it('distinguishes clear, digit limit, and ordering without Number', () => {
    expect(normalizeDecimalInput('   ')).toEqual({ kind: 'empty', value: null })
    expect(normalizeDecimalInput('9'.repeat(128)).kind).toBe('valid')
    expect(normalizeDecimalInput('9'.repeat(129))).toEqual({ kind: 'invalid', reason: 'too_many_digits' })
    expect(compareCanonicalDecimals('-10', '-2')).toBe(-1)
    expect(compareCanonicalDecimals('0.5', '0.50')).toBe(0)
    expect(compareCanonicalDecimals('99.9', '100')).toBe(-1)
  })
})
