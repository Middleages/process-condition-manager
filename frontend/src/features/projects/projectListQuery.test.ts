import { describe, expect, it } from 'vitest'

import type { ProjectListRouteState } from './urlState'
import {
  deriveHistoricalChoiceFilterState,
  projectListQueryKey,
} from './projectListQuery'

const filtered: ProjectListRouteState = {
  query: 'foundry',
  status: 'draft',
  deviceTypeCode: 'FOUNDRY',
  projectCategoryCode: 'LOGIC',
}

describe('project list query state', () => {
  it('keys every server-side filter into the paginated query', () => {
    expect(projectListQueryKey(filtered)).toEqual([
      'projects',
      'list',
      {
        lineId: null,
        cursor: null,
        query: 'foundry',
        status: 'draft',
        deviceTypeCode: 'FOUNDRY',
        projectCategoryCode: 'LOGIC',
      },
    ])
  })

  it('clearing one exact filter resets the paginated query without clearing the other', () => {
    const categoryOnly = { ...filtered, deviceTypeCode: null }

    expect(projectListQueryKey(categoryOnly)).not.toEqual(projectListQueryKey(filtered))
    expect(categoryOnly.projectCategoryCode).toBe('LOGIC')
    expect(categoryOnly.query).toBe('foundry')
    expect(categoryOnly.status).toBe('draft')
  })

  it('separates LINEs and pages in the cache', () => {
    expect(projectListQueryKey({ ...filtered, lineId: 'L1', cursor: 90 })).not.toEqual(projectListQueryKey({ ...filtered, lineId: 'L2', cursor: 90 }))
    expect(projectListQueryKey({ ...filtered, lineId: 'L1', cursor: 90 })).not.toEqual(projectListQueryKey({ ...filtered, lineId: 'L1', cursor: 80 }))
  })

  it('allows historical inactive options from a positively inactive set in list filters', () => {
    expect(
      deriveHistoricalChoiceFilterState({
        version: 3,
        setIsActive: false,
        loading: false,
        refreshing: false,
        error: null,
      }),
    ).toEqual({ loading: false, selectionReady: true })
  })

  it('fails selection closed on lookup errors without disabling raw-code clearing', () => {
    expect(
      deriveHistoricalChoiceFilterState({
        version: null,
        setIsActive: null,
        loading: false,
        refreshing: false,
        error: 'request failed',
      }),
    ).toEqual({ loading: false, selectionReady: false })
  })
})
