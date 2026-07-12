import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AxiosResponse } from 'axios'

vi.mock('./client', () => ({
  apiClient: {
    patch: vi.fn(),
  },
}))

import { apiClient } from './client'
import { patchCells } from './cells'
import type { CellsPatchOut } from './types'

function response<T>(data: T): AxiosResponse<T> {
  return { data } as unknown as AxiosResponse<T>
}

const patch = vi.mocked(apiClient.patch)

describe('patchCells', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PATCHes cells with the lock token header and origin in the body', async () => {
    const out: CellsPatchOut = {
      cells: [{ condition_id: 11, parameter_code: 'spin', value: '1600' }],
      batch_id: 'batch-1',
    }
    patch.mockResolvedValue(response(out))

    const result = await patchCells(
      7,
      [{ condition_id: 11, parameter_code: 'spin', value: '1600' }],
      'manual',
      'tok-1',
    )

    expect(patch).toHaveBeenCalledWith(
      '/projects/7/cells',
      { cells: [{ condition_id: 11, parameter_code: 'spin', value: '1600' }], origin: 'manual' },
      { headers: { 'X-Lock-Token': 'tok-1' } },
    )
    expect(result).toEqual(out)
  })

  it('omits origin from the body when it is undefined', async () => {
    patch.mockResolvedValue(response({ cells: [], batch_id: 'batch-2' }))

    await patchCells(7, [{ condition_id: 12, parameter_code: 'pr', value: null }], undefined, 'tok-2')

    expect(patch).toHaveBeenCalledWith(
      '/projects/7/cells',
      { cells: [{ condition_id: 12, parameter_code: 'pr', value: null }] },
      { headers: { 'X-Lock-Token': 'tok-2' } },
    )
  })
})
