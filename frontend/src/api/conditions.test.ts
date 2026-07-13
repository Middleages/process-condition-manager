import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AxiosResponse } from 'axios'

vi.mock('./client', () => ({
  apiClient: {
    post: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
  },
}))

import { apiClient } from './client'
import { addCondition, deleteCondition, setConditionPor } from './conditions'
import type { ConditionOut } from './types'

function response<T>(data: T): AxiosResponse<T> {
  return { data } as unknown as AxiosResponse<T>
}

const post = vi.mocked(apiClient.post)
const del = vi.mocked(apiClient.delete)
const put = vi.mocked(apiClient.put)

const condition: ConditionOut = {
  id: 42,
  layer_key: 'L1',
  label: 'C3',
  condition_index: 3,
  is_por: false,
}

describe('conditions api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds an empty condition row with the lock token header (source_condition_id null)', async () => {
    post.mockResolvedValue(response(condition))

    const result = await addCondition(7, 'L1', null, 'tok-1')

    expect(post).toHaveBeenCalledWith(
      '/projects/7/layers/L1/conditions',
      { source_condition_id: null },
      { headers: { 'X-Lock-Token': 'tok-1' } },
    )
    expect(result).toEqual(condition)
  })

  it('duplicates a condition row by passing the source id in the body', async () => {
    post.mockResolvedValue(response(condition))

    await addCondition(7, 'L2', 11, 'tok-2')

    expect(post).toHaveBeenCalledWith(
      '/projects/7/layers/L2/conditions',
      { source_condition_id: 11 },
      { headers: { 'X-Lock-Token': 'tok-2' } },
    )
  })

  it('deletes a condition row via DELETE with the token in the header (no body)', async () => {
    del.mockResolvedValue(response(undefined))

    await deleteCondition(7, 11, 'tok-3')

    expect(del).toHaveBeenCalledWith('/projects/7/conditions/11', {
      headers: { 'X-Lock-Token': 'tok-3' },
    })
  })

  it('transfers POR via PUT /por with an empty body and the token header', async () => {
    put.mockResolvedValue(response({ ...condition, is_por: true }))

    const result = await setConditionPor(7, 11, 'tok-4')

    expect(put).toHaveBeenCalledWith('/projects/7/conditions/11/por', undefined, {
      headers: { 'X-Lock-Token': 'tok-4' },
    })
    expect(result.is_por).toBe(true)
  })
})
