import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AxiosResponse } from 'axios'

vi.mock('./client', () => ({
  apiClient: {
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

import { apiClient } from './client'
import { acquireLock, heartbeatLock, releaseLock } from './locks'
import type { LockOut } from './types'

function response<T>(data: T): AxiosResponse<T> {
  return { data } as unknown as AxiosResponse<T>
}

const post = vi.mocked(apiClient.post)
const del = vi.mocked(apiClient.delete)

const lock: LockOut = {
  locked_by: 'dev-admin',
  lock_token: 'tok',
  locked_at: '2026-07-12T00:00:00Z',
  expires_at: '2026-07-12T00:05:00Z',
}

describe('locks api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('acquires a lock via POST /lock', async () => {
    post.mockResolvedValue(response(lock))

    const result = await acquireLock(7)

    expect(post).toHaveBeenCalledWith('/projects/7/lock')
    expect(result).toEqual(lock)
  })

  it('heartbeats via POST /lock/heartbeat with the token in the body', async () => {
    post.mockResolvedValue(response(lock))

    const result = await heartbeatLock(7, 'tok')

    expect(post).toHaveBeenCalledWith('/projects/7/lock/heartbeat', { lock_token: 'tok' })
    expect(result).toEqual(lock)
  })

  it('releases via DELETE /lock with the token in the body', async () => {
    del.mockResolvedValue(response(undefined))

    await releaseLock(7, 'tok')

    expect(del).toHaveBeenCalledWith('/projects/7/lock', { data: { lock_token: 'tok' } })
  })
})
