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
    const params = serializeProjectListSearch({
      query: '',
      status: 'all',
      deviceTypeCode: null,
      projectCategoryCode: null,
    })

    expect(params.toString()).toBe('')
    expect(params.has('cursor')).toBe(false)
  })

  it('round-trips query, draft status, and exact managed-choice codes', () => {
    const state = {
      query: 'L1 & coat',
      status: 'draft',
      deviceTypeCode: 'FOUNDRY',
      projectCategoryCode: 'LOGIC',
    } as const

    expect(parseProjectListSearch(serializeProjectListSearch(state))).toEqual(state)
    expect(serializeProjectListSearch(state).toString()).toBe(
      'query=L1+%26+coat&status=draft&device_type=FOUNDRY&project_category=LOGIC',
    )
  })

  it('canonicalizes unknown status to all', () => {
    expect(parseProjectListSearch(new URLSearchParams('status=approved')).status).toBe('all')
  })

  it('builds a project-list href with encoded special characters', () => {
    expect(
      toProjectListHref({
        query: 'L1 & coat',
        status: 'draft',
        deviceTypeCode: null,
        projectCategoryCode: null,
      }),
    ).toBe(
      '/projects?query=L1+%26+coat&status=draft',
    )
  })

  it('uses the first duplicate filter value and normalizes duplicates on write', () => {
    const parsed = parseProjectListSearch(
      new URLSearchParams(
        'device_type=FIRST&device_type=SECOND&project_category=LOGIC&project_category=MEMORY',
      ),
    )

    expect(parsed).toMatchObject({
      deviceTypeCode: 'FIRST',
      projectCategoryCode: 'LOGIC',
    })
    expect(serializeProjectListSearch(parsed).toString()).toBe(
      'device_type=FIRST&project_category=LOGIC',
    )
  })

  it('normalizes blank fixed-set filters to omitted defaults', () => {
    const parsed = parseProjectListSearch(
      new URLSearchParams('device_type=&project_category=%20%20'),
    )

    expect(parsed.deviceTypeCode).toBeNull()
    expect(parsed.projectCategoryCode).toBeNull()
    expect(serializeProjectListSearch(parsed).toString()).toBe('')
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

  it('never serializes wizard-local Profile draft values', () => {
    const params = serializeProjectCreateSearch({
      step: 3,
      processKey: 'L1::PROC_ALPHA',
      backboneId: 7,
      deviceTypeCode: 'FOUNDRY',
      projectCategoryCode: 'LOGIC',
      comment: 'local only',
      commentTouched: true,
    } as Parameters<typeof serializeProjectCreateSearch>[0] & Record<string, unknown>)

    expect(params.toString()).toBe('step=3&process=L1%3A%3APROC_ALPHA&backbone=7')
    expect([...params.keys()]).toEqual(['step', 'process', 'backbone'])
  })
})
