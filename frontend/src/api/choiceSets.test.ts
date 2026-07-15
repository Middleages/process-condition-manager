import type { AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  return {
    ...actual,
    apiClient: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
    },
  }
})

import { apiClient } from './client'
import {
  applyChoiceImport,
  createChoiceOption,
  createChoiceSet,
  fetchAllChoiceOptions,
  getChoiceSet,
  listChoiceOptions,
  listChoiceSets,
  patchChoiceOption,
  patchChoiceSet,
  previewChoiceImport,
  reorderChoiceOptions,
} from './choiceSets'
import type {
  ChoiceImportApplyOut,
  ChoiceImportPreviewOut,
  ChoiceOptionMutationOut,
  ChoiceOptionOut,
  ChoiceOptionPageOut,
  ChoiceSetSummaryOut,
} from './types'

function response<T>(data: T, status = 200): AxiosResponse<T> {
  return { data, status } as AxiosResponse<T>
}

function option(code: string): ChoiceOptionOut {
  return { code, label: `Label ${code}`, sort_order: 0, is_active: true }
}

function page(
  version: number,
  items: ChoiceOptionOut[],
  nextCursor: string | null,
  setCode = 'equipment_mode',
): ChoiceOptionPageOut {
  return { set_code: setCode, version, items, next_cursor: nextCursor }
}

function choiceSet(version = 1, code = 'A.B-_1'): ChoiceSetSummaryOut {
  return {
    code,
    display_name: 'Equipment mode',
    description: null,
    is_active: true,
    version,
    option_count: 1,
    active_option_count: 1,
    parameter_usage_count: 0,
    profile_usage_fields: [],
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  }
}

function choiceSetChangedError(expectedVersion: number, actualVersion: number) {
  return {
    isAxiosError: true,
    response: {
      status: 409,
      data: {
        code: 'choice_set_changed',
        message: 'changed',
        details: {
          set_code: 'equipment_mode',
          expected_version: expectedVersion,
          actual_version: actualVersion,
          choice_set: choiceSet(actualVersion, 'equipment_mode'),
        },
      },
    },
  }
}

const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)
const patch = vi.mocked(apiClient.patch)
const put = vi.mocked(apiClient.put)

describe('choice-set API contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes punctuation-safe set identities and preserves snake_case list parameters', async () => {
    const summary = choiceSet()
    get.mockResolvedValueOnce(response([summary])).mockResolvedValueOnce(response(summary))

    await expect(listChoiceSets(true)).resolves.toEqual([summary])
    await expect(getChoiceSet('A.B-_1')).resolves.toEqual(summary)

    expect(get).toHaveBeenNthCalledWith(1, '/choice-sets', {
      params: { include_inactive: true },
    })
    expect(get).toHaveBeenNthCalledWith(2, '/choice-sets/A.B-_1')
  })

  it('returns 201/200 response data and keeps expected_version in JSON bodies', async () => {
    const created = choiceSet()
    const patched = choiceSet(2)
    post.mockResolvedValue(response(created, 201))
    patch.mockResolvedValue(response(patched, 200))

    await expect(
      createChoiceSet({ code: 'A.B-_1', display_name: 'Equipment mode', description: null }),
    ).resolves.toEqual(created)
    await expect(
      patchChoiceSet('A.B-_1', {
        expected_version: 1,
        display_name: 'Equipment modes',
        is_active: true,
      }),
    ).resolves.toEqual(patched)

    expect(post).toHaveBeenCalledWith('/choice-sets', {
      code: 'A.B-_1',
      display_name: 'Equipment mode',
      description: null,
    })
    expect(patch).toHaveBeenCalledWith('/choice-sets/A.B-_1', {
      expected_version: 1,
      display_name: 'Equipment modes',
      is_active: true,
    })
  })

  it('uses exact option collection, item, and order contracts without a version header', async () => {
    const mutation: ChoiceOptionMutationOut = {
      choice_set: choiceSet(2),
      option: option('A.B-_1'),
    }
    post.mockResolvedValue(response(mutation, 201))
    patch.mockResolvedValue(response({ ...mutation, choice_set: choiceSet(3) }))
    put.mockResolvedValue(response(choiceSet(4)))

    await expect(
      createChoiceOption('A.B-_1', {
        expected_version: 1,
        code: 'A.B-_1',
        label: 'Mode',
        sort_order: 10,
        is_active: true,
      }),
    ).resolves.toEqual(mutation)
    await patchChoiceOption('A.B-_1', 'A.B-_1', {
      expected_version: 2,
      label: 'Updated mode',
    })
    await reorderChoiceOptions('A.B-_1', {
      expected_version: 3,
      ordered_codes: ['A.B-_1'],
    })

    expect(post).toHaveBeenCalledWith('/choice-sets/A.B-_1/options', {
      expected_version: 1,
      code: 'A.B-_1',
      label: 'Mode',
      sort_order: 10,
      is_active: true,
    })
    expect(patch).toHaveBeenCalledWith('/choice-sets/A.B-_1/options/A.B-_1', {
      expected_version: 2,
      label: 'Updated mode',
    })
    expect(put).toHaveBeenCalledWith('/choice-sets/A.B-_1/option-order', {
      expected_version: 3,
      ordered_codes: ['A.B-_1'],
    })
  })

  it('passes exact option query and import transports', async () => {
    const optionPage = page(7, [option('A')], null, 'A.B-_1')
    const preview: ChoiceImportPreviewOut = {
      set_code: 'A.B-_1',
      base_version: 7,
      created_count: 1,
      updated_count: 0,
      error_count: 0,
      rows: [{ line: 2, code: 'A', action: 'create', message: null }],
    }
    const applied: ChoiceImportApplyOut = {
      choice_set: choiceSet(8),
      created_count: 1,
      updated_count: 0,
      error_count: 0,
      rows: preview.rows,
    }
    get.mockResolvedValue(response(optionPage))
    post.mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response(applied))

    await expect(
      listChoiceOptions('A.B-_1', {
        q: 'mode',
        version: 7,
        cursor: 'next',
        limit: 25,
        include_inactive: true,
      }),
    ).resolves.toEqual(optionPage)
    await expect(
      previewChoiceImport('A.B-_1', { expected_version: 7, csv_text: 'code,label\nA,Mode' }),
    ).resolves.toEqual(preview)
    await expect(
      applyChoiceImport('A.B-_1', { expected_version: 7, csv_text: 'code,label\nA,Mode' }),
    ).resolves.toEqual(applied)

    expect(get).toHaveBeenCalledWith('/choice-sets/A.B-_1/options', {
      params: {
        q: 'mode',
        version: 7,
        cursor: 'next',
        limit: 25,
        include_inactive: true,
      },
    })
    expect(post).toHaveBeenNthCalledWith(1, '/choice-sets/A.B-_1/import/preview', {
      expected_version: 7,
      csv_text: 'code,label\nA,Mode',
    })
    expect(post).toHaveBeenNthCalledWith(2, '/choice-sets/A.B-_1/import', {
      expected_version: 7,
      csv_text: 'code,label\nA,Mode',
    })
  })

  it.each(['A/B', 'A%2FB', '.', '..', '한글', 'A B'])(
    'rejects unsafe set path identity %j before issuing a request',
    async (unsafeCode) => {
      await expect(getChoiceSet(unsafeCode)).rejects.toThrow(/safe ASCII/i)
      await expect(
        patchChoiceSet(unsafeCode, { expected_version: 1, display_name: 'No request' }),
      ).rejects.toThrow(/safe ASCII/i)

      expect(get).not.toHaveBeenCalled()
      expect(patch).not.toHaveBeenCalled()
    },
  )

  it.each(['A/B', 'A%2FB', '.', '..', '한글', 'A B'])(
    'rejects unsafe option path identity %j before issuing a request',
    async (unsafeCode) => {
      await expect(
        patchChoiceOption('safe_set', unsafeCode, { expected_version: 1, label: 'No request' }),
      ).rejects.toThrow(/safe ASCII/i)

      expect(patch).not.toHaveBeenCalled()
    },
  )
})

describe('fetchAllChoiceOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('discards partial pages and restarts from page one after a version change', async () => {
    get
      .mockResolvedValueOnce(response(page(3, [option('A')], 'v3-next')))
      .mockRejectedValueOnce(choiceSetChangedError(3, 4))
      .mockResolvedValueOnce(response(page(4, [option('B')], null)))

    const result = await fetchAllChoiceOptions('equipment_mode', 3, true)

    expect(result).toEqual({ set_code: 'equipment_mode', version: 4, items: [option('B')] })
    expect(get).toHaveBeenNthCalledWith(
      3,
      '/choice-sets/equipment_mode/options',
      expect.objectContaining({
        params: expect.objectContaining({ version: 4, cursor: undefined }),
      }),
    )
  })

  it('discards a mismatched first page and restarts under its response version', async () => {
    get
      .mockResolvedValueOnce(response(page(4, [option('STALE')], null)))
      .mockResolvedValueOnce(response(page(4, [option('CURRENT')], null)))

    await expect(fetchAllChoiceOptions('equipment_mode', 3, false)).resolves.toEqual({
      set_code: 'equipment_mode',
      version: 4,
      items: [option('CURRENT')],
    })
    expect(get).toHaveBeenNthCalledWith(
      2,
      '/choice-sets/equipment_mode/options',
      expect.objectContaining({
        params: expect.objectContaining({ version: 4, cursor: undefined }),
      }),
    )
  })

  it('pins every later page to the version returned by page one', async () => {
    get
      .mockResolvedValueOnce(response(page(8, [option('A')], 'next')))
      .mockResolvedValueOnce(response(page(8, [option('B')], null)))

    await expect(fetchAllChoiceOptions('equipment_mode', undefined, true)).resolves.toEqual({
      set_code: 'equipment_mode',
      version: 8,
      items: [option('A'), option('B')],
    })
    expect(get).toHaveBeenNthCalledWith(
      2,
      '/choice-sets/equipment_mode/options',
      expect.objectContaining({
        params: expect.objectContaining({ version: 8, cursor: 'next' }),
      }),
    )
  })

  it('rejects a later page from another set or version as malformed', async () => {
    get
      .mockResolvedValueOnce(response(page(3, [option('A')], 'next')))
      .mockResolvedValueOnce(response(page(4, [option('B')], null)))

    await expect(fetchAllChoiceOptions('equipment_mode', 3, true)).rejects.toThrow(
      /malformed choice option page/i,
    )
  })

  it('rejects duplicate option codes across pages as malformed', async () => {
    get
      .mockResolvedValueOnce(response(page(3, [option('A')], 'next')))
      .mockResolvedValueOnce(response(page(3, [option('A')], null)))

    await expect(fetchAllChoiceOptions('equipment_mode', 3, true)).rejects.toThrow(
      /duplicate choice option code/i,
    )
  })

  it('surfaces a third rapid version conflict instead of looping forever', async () => {
    const thirdConflict = choiceSetChangedError(5, 6)
    get
      .mockRejectedValueOnce(choiceSetChangedError(3, 4))
      .mockRejectedValueOnce(choiceSetChangedError(4, 5))
      .mockRejectedValueOnce(thirdConflict)

    await expect(fetchAllChoiceOptions('equipment_mode', 3, true)).rejects.toBe(thirdConflict)
    expect(get).toHaveBeenCalledTimes(3)
  })

  it('passes the same AbortSignal to every page request', async () => {
    const controller = new AbortController()
    get
      .mockResolvedValueOnce(response(page(3, [option('A')], 'next')))
      .mockResolvedValueOnce(response(page(3, [option('B')], null)))

    await fetchAllChoiceOptions('equipment_mode', 3, true, controller.signal)

    expect(get).toHaveBeenNthCalledWith(
      1,
      '/choice-sets/equipment_mode/options',
      expect.objectContaining({ signal: controller.signal }),
    )
    expect(get).toHaveBeenNthCalledWith(
      2,
      '/choice-sets/equipment_mode/options',
      expect.objectContaining({ signal: controller.signal }),
    )
  })
})
