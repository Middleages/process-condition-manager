import { describe, expect, it } from 'vitest'

import { makeChoiceCell } from './choiceCell'

describe('makeChoiceCell', () => {
  it('opens an editable choice on the first click', () => {
    const cell = makeChoiceCell('pos', ['pos', 'neg'], false)
    expect(cell.activationBehaviorOverride).toBe('single-click')
    expect(cell.readonly).toBe(false)
  })

  it('does not advertise activation for a readonly choice', () => {
    const cell = makeChoiceCell('pos', ['pos', 'neg'], true)
    expect(cell.activationBehaviorOverride).toBeUndefined()
    expect(cell.readonly).toBe(true)
  })
})
