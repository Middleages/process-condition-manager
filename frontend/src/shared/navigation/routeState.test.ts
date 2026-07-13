import { describe, expect, it } from 'vitest'

import { parsePositiveInt } from './routeState'

describe('parsePositiveInt', () => {
  it.each([
    ['42', 42],
    ['1', 1],
  ])('parses %s', (raw, expected) => {
    expect(parsePositiveInt(raw)).toBe(expected)
  })

  it.each([null, undefined, '', '0', '-1', '1.5', 'abc'])('rejects %s', (raw) => {
    expect(parsePositiveInt(raw)).toBeNull()
  })
})
