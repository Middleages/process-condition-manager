import { describe, expect, it } from 'vitest'

import { parsePositiveInt, shouldBlockNavigation } from './routeState'

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

describe('shouldBlockNavigation', () => {
  it('blocks a dirty route change but not the allowed success path', () => {
    expect(shouldBlockNavigation(true, '/projects/new?step=3', '/projects', undefined)).toBe(true)
    expect(shouldBlockNavigation(true, '/projects/new?step=3', '/projects/9', '/projects/9')).toBe(false)
    expect(shouldBlockNavigation(false, '/projects/new', '/projects', undefined)).toBe(false)
  })

  it('does not block the current URL or an allowed pathname with route state', () => {
    expect(shouldBlockNavigation(true, '/parameters?edit=4', '/parameters?edit=4')).toBe(false)
    expect(
      shouldBlockNavigation(true, '/projects/new?step=3', '/projects/9?created=true#summary', '/projects/9'),
    ).toBe(false)
  })

  it('does not treat a prefix of the allowed pathname as allowed', () => {
    expect(shouldBlockNavigation(true, '/projects/new', '/projects/90', '/projects/9')).toBe(true)
  })
})
