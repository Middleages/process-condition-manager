import { describe, expect, it } from 'vitest'

import type { ProjectListRouteState } from './urlState'
import {
  deriveHistoricalChoiceFilterState,
  mergeDebouncedQuery,
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

  it('merges a pending debounce into the latest route filters instead of a stale snapshot', () => {
    const latestRouteState: ProjectListRouteState = {
      query: '',
      status: 'all',
      deviceTypeCode: 'MEMORY',
      projectCategoryCode: 'PRODUCT',
    }

    expect(mergeDebouncedQuery(latestRouteState, 'new search')).toEqual({
      query: 'new search',
      status: 'all',
      deviceTypeCode: 'MEMORY',
      projectCategoryCode: 'PRODUCT',
    })
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
