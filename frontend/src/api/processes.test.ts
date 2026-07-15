import type { AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

import { apiClient } from './client'
import { getProcess } from './processes'
import type { ProcessDetailOut } from './types'

function response<T>(data: T): AxiosResponse<T> {
  return { data } as AxiosResponse<T>
}

const process: ProcessDetailOut = {
  key: 'LINE A::coat & bake',
  line_id: 'LINE A',
  process_id: 'coat & bake',
  display_name: 'LINE A / coat & bake',
  step_count: 2,
  area_names: ['COAT'],
  has_project: false,
  project_count: 0,
}

const get = vi.mocked(apiClient.get)

describe('processes api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('encodes a direct Process key exactly once in the path', async () => {
    get.mockResolvedValue(response(process))

    await expect(getProcess(process.key)).resolves.toEqual(process)

    expect(get).toHaveBeenCalledWith('/processes/LINE%20A%3A%3Acoat%20%26%20bake')
  })
})
