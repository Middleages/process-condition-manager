import { describe, expect, it } from 'vitest'

import {
  parseChoiceSetDetailSearch,
  parseChoiceSetListSearch,
  serializeChoiceSetDetailSearch,
  serializeChoiceSetListSearch,
} from './choiceSetUrlState'

describe('choice-set URL state', () => {
  it('parses list search and the approved active filters', () => {
    expect(parseChoiceSetListSearch(new URLSearchParams('q=mode&active=all'))).toEqual({
      query: 'mode',
      active: 'all',
    })
  })

  it('omits list defaults from the URL', () => {
    expect(
      serializeChoiceSetListSearch({ query: '', active: 'active' }).toString(),
    ).toBe('')
  })

  it('parses detail-local search without duplicating the path-owned set code', () => {
    expect(
      parseChoiceSetDetailSearch(
        new URLSearchParams('q=auto&active=inactive&setCode=wrong'),
      ),
    ).toEqual({ query: 'auto', active: 'inactive' })
    expect(
      serializeChoiceSetDetailSearch({ query: 'auto', active: 'inactive' }).has(
        'setCode',
      ),
    ).toBe(false)
  })

  it('repairs unknown filter values to each screens approved default', () => {
    expect(parseChoiceSetListSearch(new URLSearchParams('active=deleted'))).toEqual({
      query: '',
      active: 'active',
    })
    expect(parseChoiceSetDetailSearch(new URLSearchParams('active=deleted'))).toEqual({
      query: '',
      active: 'all',
    })
    expect(
      serializeChoiceSetDetailSearch({ query: '', active: 'all' }).toString(),
    ).toBe('')
  })
})
