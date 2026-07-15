import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AxiosResponse } from 'axios'

vi.mock('./client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}))

import { apiClient } from './client'
import { validateProject } from './validation'
import type { ProjectValidationOut } from './types'

function response<T>(data: T): AxiosResponse<T> {
  return { data } as unknown as AxiosResponse<T>
}

const result: ProjectValidationOut = {
  summary: { error_count: 1, warning_count: 0 },
  issues: [
    {
      key: '1:amount:required',
      code: 'required',
      rule_code: null,
      rule_version: null,
      severity: 'error',
      condition_id: 1,
      layer_key: 'L1',
      parameter_code: 'amount',
      details: {},
    },
  ],
  evaluated_at: '2026-07-15T00:00:00Z',
  basis_hash: 'sha256:basis',
  rule_versions: {},
}

const post = vi.mocked(apiClient.post)

describe('validation api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts no body and returns the typed whole-project result', async () => {
    post.mockResolvedValue(response(result))

    await expect(validateProject(42)).resolves.toBe(result)

    expect(post).toHaveBeenCalledWith('/projects/42/validate')
  })

  it('forwards a caller-owned abort signal without adding a request body', async () => {
    post.mockResolvedValue(response(result))
    const controller = new AbortController()

    await validateProject(42, controller.signal)

    expect(post).toHaveBeenCalledWith('/projects/42/validate', undefined, {
      signal: controller.signal,
    })
  })
})
