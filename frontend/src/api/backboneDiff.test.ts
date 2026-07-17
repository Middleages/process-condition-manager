import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosResponse } from 'axios'

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

import { apiClient } from './client'
import {
  getBackboneDiffCells,
  getBackboneDiffConditions,
  getBackboneDiffRoot,
  isDiffBasisChanged,
} from './backboneDiff'

function response<T>(data: T): AxiosResponse<T> {
  return { data } as unknown as AxiosResponse<T>
}

const get = vi.mocked(apiClient.get)

describe('backboneDiff API client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GETs root with normalized filters and default preview', async () => {
    get.mockResolvedValue(
      response({
        scope: 'root',
        basis_hash: 'sha256:abc',
        counts: {
          layer_count: 0,
          available_layer_count: 0,
          unavailable_layer_count: 0,
          row_count: 0,
          cell_count: 0,
          full_row_count: 0,
          full_cell_count: 0,
          ambiguous_lineage_count: 0,
          added_count: 0,
          changed_count: 0,
          cleared_count: 0,
          removed_count: 0,
          unchanged_count: 0,
        },
        layer_summaries: [],
        changed_preview: [],
      }),
    )

    await getBackboneDiffRoot(7, {
      classification: ['changed', 'added', 'changed'],
      includeUnchanged: true,
      previewLimit: 5,
    })

    expect(get).toHaveBeenCalledWith(
      '/projects/7/backbone-diff?classification=added&classification=changed&include_unchanged=true&preview_limit=5',
    )
  })

  it('GETs branch with encoded layer key and scoped cursor', async () => {
    const out = {
      scope: 'scope',
      basis_hash: 'sha256:abc',
      items: [],
      next_cursor: null,
    }
    get.mockResolvedValue(response(out))

    await getBackboneDiffConditions(7, 'L1::PROC_A::010::ETCH', {
      scope: 'scope-token_1',
      cursor: 'cursor_2',
      limit: 10,
    })

    expect(get).toHaveBeenCalledWith(
      '/projects/7/backbone-diff/layers/L1%3A%3APROC_A%3A%3A010%3A%3AETCH/conditions?scope=scope-token_1&cursor=cursor_2&limit=10',
    )
  })

  it('GETs cells with encoded path segments and query strings', async () => {
    const out = {
      scope: 'scope',
      basis_hash: 'sha256:abc',
      row_ref: 'row',
      items: [],
      next_cursor: null,
    }
    get.mockResolvedValue(response(out))

    await getBackboneDiffCells(7, 'L1::PROC_A::010::ETCH', 'cmVfcm93X3JlZg', {
      scope: 'scope-token_2',
      limit: 50,
    })

    expect(get).toHaveBeenCalledWith(
      '/projects/7/backbone-diff/layers/L1%3A%3APROC_A%3A%3A010%3A%3AETCH/conditions/cmVfcm93X3JlZg/cells?scope=scope-token_2&limit=50',
    )
  })

  it('classifies exact 409 diff basis change responses', () => {
    const basisChanged = {
      isAxiosError: true,
      response: { status: 409, data: { code: 'diff_basis_changed', message: 'basis changed' } },
    }
    const unrelated = {
      isAxiosError: true,
      response: { status: 409, data: { code: 'lock_conflict', message: 'locked' } },
    }

    expect(isDiffBasisChanged(basisChanged)).toBe(true)
    expect(isDiffBasisChanged(unrelated)).toBe(false)
    expect(isDiffBasisChanged(new Error('offline'))).toBe(false)
  })

  it('fails closed on missing required scope before fetching branch/cell', async () => {
    await expect(
      getBackboneDiffConditions(7, 'L1::PROC_A::010::ETCH', {
        scope: '   ',
        limit: 10,
      }),
    ).rejects.toThrow(TypeError)
    await expect(
      getBackboneDiffCells(7, 'L1::PROC_A::010::ETCH', ' ', {
        scope: 'scope',
        limit: 10,
      }),
    ).rejects.toThrow(TypeError)
    await expect(
      getBackboneDiffConditions(7, 'L1::PROC_A::010::ETCH', {
        scope: 'scope-token_1',
        cursor: ' cursor-2 ',
        limit: 10,
      }),
    ).rejects.toThrow(TypeError)

    expect(get).not.toHaveBeenCalled()
  })
})
