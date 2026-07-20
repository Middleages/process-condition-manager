import type { AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

import { apiClient } from './client'
import { getCurrentUser, resolveAuthPermissions } from './auth'
import type { MeOut } from './auth'

function response<T>(data: T): AxiosResponse<T> {
  return { data } as AxiosResponse<T>
}

const me: MeOut = {
  id: 'me-1',
  display_name: 'Alice',
  email: 'alice@example.com',
  roles: ['editor'],
  permissions: ['project.edit', 'project.comment'],
}

const get = vi.mocked(apiClient.get)

describe('api/auth', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('GETs /auth/me through the API client', async () => {
    get.mockResolvedValueOnce(response(me))

    await getCurrentUser()

    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/auth/me')
  })

  it('derives permissions directly from permission strings', () => {
    const permissions = resolveAuthPermissions(me)

    expect(permissions).toEqual({
      canEditDraft: true,
      canRequestReview: false,
      canApprove: false,
      canReject: false,
      canReturnToDraft: false,
      canCreateRevision: false,
      canComment: true,
    })
  })
})
