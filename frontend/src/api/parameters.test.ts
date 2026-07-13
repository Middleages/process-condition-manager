import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AxiosResponse } from 'axios'

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
  },
}))

import { apiClient } from './client'
import {
  applyParameterImport,
  createParameter,
  deactivateParameter,
  getParameter,
  listParameters,
  previewParameterImport,
  replaceParameterOptions,
  updateParameter,
} from './parameters'
import type { ParameterCreate, ParameterOut, ParameterUpdate } from './types'

function response<T>(data: T): AxiosResponse<T> {
  return { data } as unknown as AxiosResponse<T>
}

const sampleParameter: ParameterOut = {
  id: 42,
  code: 'exposure',
  display_name: '노광량',
  description: null,
  value_type: 'number',
  category_id: null,
  unit: 'mJ',
  min_value: 0,
  max_value: 100,
  sort_order: 0,
  is_active: true,
  options: [],
}

const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)
const patch = vi.mocked(apiClient.patch)
const put = vi.mocked(apiClient.put)

describe('parameters api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists active parameters by default', async () => {
    get.mockResolvedValue(response([sampleParameter]))

    const result = await listParameters()

    expect(get).toHaveBeenCalledWith('/parameters', {
      params: { include_inactive: false },
    })
    expect(result).toEqual([sampleParameter])
  })

  it('passes include_inactive when requested', async () => {
    get.mockResolvedValue(response([]))

    await listParameters(true)

    expect(get).toHaveBeenCalledWith('/parameters', {
      params: { include_inactive: true },
    })
  })

  it('gets a parameter directly by id', async () => {
    get.mockResolvedValue(response(sampleParameter))

    const result = await getParameter(42)

    expect(get).toHaveBeenCalledWith('/parameters/42')
    expect(result).toEqual(sampleParameter)
  })

  it('posts CSV text to preview and apply endpoints', async () => {
    const result = { created_count: 0, updated_count: 0, error_count: 0, rows: [] }
    post.mockResolvedValue(response(result))

    await previewParameterImport('code,display_name,type')
    await applyParameterImport('code,display_name,type')

    expect(post).toHaveBeenNthCalledWith(1, '/parameters/import/preview', {
      csv_text: 'code,display_name,type',
    })
    expect(post).toHaveBeenNthCalledWith(2, '/parameters/import/apply', {
      csv_text: 'code,display_name,type',
    })
  })

  it('posts a create payload to the collection endpoint', async () => {
    post.mockResolvedValue(response(sampleParameter))
    const payload: ParameterCreate = {
      code: 'exposure',
      display_name: '노광량',
      value_type: 'number',
    }

    const result = await createParameter(payload)

    expect(post).toHaveBeenCalledWith('/parameters', payload)
    expect(result).toEqual(sampleParameter)
  })

  it('patches an update payload to the item endpoint', async () => {
    patch.mockResolvedValue(response(sampleParameter))
    const payload: ParameterUpdate = { display_name: '수정된 이름' }

    await updateParameter(42, payload)

    expect(patch).toHaveBeenCalledWith('/parameters/42', payload)
  })

  it('deactivates via the dedicated action endpoint (soft delete, not DELETE)', async () => {
    post.mockResolvedValue(response({ ...sampleParameter, is_active: false }))

    const result = await deactivateParameter(42)

    expect(post).toHaveBeenCalledWith('/parameters/42/deactivate')
    expect(result.is_active).toBe(false)
  })

  it('replaces options via PUT on the options sub-resource', async () => {
    put.mockResolvedValue(response(sampleParameter))
    const options = [{ value: 'pos', display_name: 'pos', sort_order: 0 }]

    await replaceParameterOptions(42, options)

    expect(put).toHaveBeenCalledWith('/parameters/42/options', options)
  })
})
