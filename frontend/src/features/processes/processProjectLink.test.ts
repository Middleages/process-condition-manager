import { describe, expect, it } from 'vitest'

import type { ProcessDetailOut } from '@/api/types'

import { getProcessProjectHref } from './processProjectLink'

const baseProcess: ProcessDetailOut = {
  key: 'L1::PROC_ALPHA',
  line_id: 'L1',
  process_id: 'PROC_ALPHA',
  display_name: 'L1 / PROC_ALPHA',
  step_count: 3,
  area_names: ['PHOTO'],
  has_project: false,
  project_count: 0,
}

function makeProcess(overrides: Partial<ProcessDetailOut>): ProcessDetailOut {
  return { ...baseProcess, ...overrides }
}

describe('getProcessProjectHref', () => {
  it('routes an unused Process to the prefilled wizard', () => {
    expect(getProcessProjectHref(makeProcess({ has_project: false, key: 'L1::P&1' }))).toBe(
      '/projects/new?step=1&process=L1%3A%3AP%261',
    )
  })

  it('routes an existing Process to a searchable list', () => {
    expect(getProcessProjectHref(makeProcess({ has_project: true, process_id: 'PHOTO-1' }))).toBe(
      '/projects?query=PHOTO-1',
    )
  })
})
