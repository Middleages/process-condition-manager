import { describe, expect, it } from 'vitest'

import {
  parseProjectCreateSearch,
  parseProjectListSearch,
  serializeProjectCreateSearch,
  serializeProjectListSearch,
  toProjectListHref,
} from './urlState'

describe('project list URL state', () => {
  it('omits defaults and never serializes a cursor', () => {
    const params = serializeProjectListSearch({ query: '', status: 'all' })

    expect(params.toString()).toBe('')
    expect(params.has('cursor')).toBe(false)
  })

  it('round-trips query and draft status', () => {
    const state = { query: 'L1 & coat', status: 'draft' } as const

    expect(parseProjectListSearch(serializeProjectListSearch(state))).toEqual(state)
  })

  it('canonicalizes unknown status to all', () => {
    expect(parseProjectListSearch(new URLSearchParams('status=approved')).status).toBe('all')
  })

  it('builds a project-list href with encoded special characters', () => {
    expect(toProjectListHref({ query: 'L1 & coat', status: 'draft' })).toBe(
      '/projects?query=L1+%26+coat&status=draft',
    )
  })
})

describe('project create URL state', () => {
  it('round-trips an encoded Process key and backbone', () => {
    const state = { step: 3, processKey: 'LINE A::coat & bake', backboneId: 19 } as const

    expect(parseProjectCreateSearch(serializeProjectCreateSearch(state))).toEqual(state)
  })

  it.each(['0', '-1', '1.5', 'abc'])('rejects invalid backbone %s', (raw) => {
    expect(parseProjectCreateSearch(new URLSearchParams(`backbone=${raw}`)).backboneId).toBeNull()
  })

  it('canonicalizes an unknown step to one', () => {
    expect(parseProjectCreateSearch(new URLSearchParams('step=9')).step).toBe(1)
  })

  it('serializes step one explicitly for stable entry links', () => {
    expect(
      serializeProjectCreateSearch({
        step: 1,
        processKey: 'L1::PROC_ALPHA',
        backboneId: null,
      }).toString(),
    ).toBe('step=1&process=L1%3A%3APROC_ALPHA')
  })
})
