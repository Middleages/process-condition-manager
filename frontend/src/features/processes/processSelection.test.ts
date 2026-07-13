import { describe, expect, it } from 'vitest'

import { getSettledProcessSelection } from './processSelection'

const alpha = { key: 'L1::ALPHA' }
const beta = { key: 'L1::BETA' }

describe('getSettledProcessSelection', () => {
  it('clears a prior selection when a settled result becomes empty', () => {
    expect(getSettledProcessSelection(alpha.key, [])).toBeNull()
  })

  it('selects the first result when the prior selection disappears', () => {
    expect(getSettledProcessSelection(alpha.key, [beta])).toBe(beta.key)
  })

  it('preserves a selection that remains in the settled result', () => {
    expect(getSettledProcessSelection(beta.key, [alpha, beta])).toBe(beta.key)
  })
})
