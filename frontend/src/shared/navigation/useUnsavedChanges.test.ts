import { describe, expect, it } from 'vitest'

import { getUnsavedNavigationAction } from './useUnsavedChanges'

describe('getUnsavedNavigationAction', () => {
  it('freezes every route change while a mutation is pending', () => {
    expect(getUnsavedNavigationAction({ when: true, freezeWhen: true })).toBe('reset')
    expect(getUnsavedNavigationAction({ when: false, freezeWhen: true })).toBe('reset')
  })

  it('asks only for dirty navigation and otherwise allows it', () => {
    expect(getUnsavedNavigationAction({ when: true, freezeWhen: false })).toBe('confirm')
    expect(getUnsavedNavigationAction({ when: false, freezeWhen: false })).toBe('allow')
  })
})
