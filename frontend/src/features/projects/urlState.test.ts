import { describe, expect, it } from 'vitest'

import {
  parseProjectListSearch,
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
