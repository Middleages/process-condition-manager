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
import * as parameterApi from './parameters'
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
  min_value: '0',
  max_value: '100',
  required: false,
  pattern: null,
  pattern_hint: null,
  choice_set: null,
  sort_order: 0,
  is_active: true,
}

const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)
const patch = vi.mocked(apiClient.patch)
const put = vi.mocked(apiClient.put)

describe('parameters api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists active parameters by default and can include inactive rows', async () => {
    get.mockResolvedValueOnce(response([sampleParameter])).mockResolvedValueOnce(response([]))

    await expect(parameterApi.listParameters()).resolves.toEqual([sampleParameter])
    await parameterApi.listParameters(true)

    expect(get).toHaveBeenNthCalledWith(1, '/parameters', {
      params: { include_inactive: false },
    })
    expect(get).toHaveBeenNthCalledWith(2, '/parameters', {
      params: { include_inactive: true },
    })
  })

  it('gets a parameter by id and forwards a query-owned abort signal', async () => {
    get.mockResolvedValue(response(sampleParameter))
    const controller = new AbortController()

    await expect(parameterApi.getParameter(42)).resolves.toBe(sampleParameter)
    await parameterApi.getParameter(42, controller.signal)

    expect(get).toHaveBeenNthCalledWith(1, '/parameters/42')
    expect(get).toHaveBeenNthCalledWith(2, '/parameters/42', {
      signal: controller.signal,
    })
  })

  it('posts CSV text to the preview and atomic apply endpoints', async () => {
    const result = { created_count: 0, updated_count: 0, error_count: 0, rows: [] }
    post.mockResolvedValue(response(result))

    await parameterApi.previewParameterImport('code,choice_set_code')
    await parameterApi.applyParameterImport('code,choice_set_code')

    expect(post).toHaveBeenNthCalledWith(1, '/parameters/import/preview', {
      csv_text: 'code,choice_set_code',
    })
    expect(post).toHaveBeenNthCalledWith(2, '/parameters/import/apply', {
      csv_text: 'code,choice_set_code',
    })
  })

  it('posts the managed ChoiceSet create payload exactly once', async () => {
    post.mockResolvedValue(response(sampleParameter))
    const payload: ParameterCreate = {
      code: 'mode',
      display_name: '모드',
      value_type: 'choice',
      choice_set_code: 'equipment_mode',
      min_value: null,
      max_value: null,
    }

    await expect(parameterApi.createParameter(payload)).resolves.toBe(sampleParameter)

    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/parameters', payload)
    expect(put).not.toHaveBeenCalled()
  })

  it('patches only the mutable item payload', async () => {
    patch.mockResolvedValue(response(sampleParameter))
    const payload: ParameterUpdate = { display_name: '수정된 이름', min_value: '0.1' }

    await parameterApi.updateParameter(42, payload)

    expect(patch).toHaveBeenCalledWith('/parameters/42', payload)
    expect(put).not.toHaveBeenCalled()
  })

  it('soft-deactivates through the dedicated action endpoint', async () => {
    post.mockResolvedValue(response({ ...sampleParameter, is_active: false }))

    const result = await parameterApi.deactivateParameter(42)

    expect(post).toHaveBeenCalledWith('/parameters/42/deactivate')
    expect(result.is_active).toBe(false)
  })

  it('does not expose the removed parameter options sub-resource client', () => {
    expect('replaceParameterOptions' in parameterApi).toBe(false)
    expect(put).not.toHaveBeenCalled()
  })
})
