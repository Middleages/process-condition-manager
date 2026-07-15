import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AxiosResponse } from 'axios'

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

import { apiClient } from './client'
import { getSheet } from './sheets'
import type { SheetOut } from './types'

function response<T>(data: T): AxiosResponse<T> {
  return { data } as unknown as AxiosResponse<T>
}

const sampleSheet: SheetOut = {
  columns: [
    {
      parameter_code: 'exposure',
      display_name: '노광량',
      value_type: 'number',
      category_code: 'litho',
      unit: 'mJ',
      description: '노광 에너지',
      choice_set_code: null,
      choice_set_version: null,
      sort_order: 0,
    },
  ],
  rows: [
    {
      condition_id: 7,
      layer_key: 'STEP01|L1',
      layer_label: 'L1 (STEP01)',
      condition_label: 'C1',
      is_por: true,
      cells: { exposure: '25' },
    },
  ],
  lock: {
    locked_by: null,
    locked_at: null,
    expires_at: null,
    is_mine: true,
    heartbeat_seconds: 45,
  },
}

const get = vi.mocked(apiClient.get)

describe('sheets api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches the sheet for a project by id', async () => {
    get.mockResolvedValue(response(sampleSheet))

    const result = await getSheet(42)

    expect(get).toHaveBeenCalledWith('/projects/42/sheet')
    expect(result).toEqual(sampleSheet)
    expect(result.columns[0]).not.toHaveProperty('choice_options')
  })
})
