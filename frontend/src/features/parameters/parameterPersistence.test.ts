import { describe, expect, it, vi } from 'vitest'

import { buildParameterCreatePlan, buildParameterUpdatePlan, stateFromParameter } from './form'
import {
  persistParameter,
  retryParameterOptions,
  type ParameterPersistenceApi,
} from './parameterPersistence'

import type { ParameterFormState } from './form'
import type { ParameterOut } from '@/api/types'

const numberParameter: ParameterOut = {
  id: 42,
  code: 'exposure',
  display_name: 'Exposure',
  description: 'Wafer dose',
  value_type: 'number',
  category_id: 3,
  unit: 'mJ',
  min_value: 0,
  max_value: 100,
  sort_order: 0,
  is_active: true,
  options: [],
}

const choiceParameter: ParameterOut = {
  ...numberParameter,
  id: 43,
  code: 'polarity',
  display_name: 'Polarity',
  description: null,
  value_type: 'choice',
  category_id: null,
  unit: null,
  min_value: null,
  max_value: null,
  options: [
    { id: 1, value: 'pos', display_name: 'pos', sort_order: 0, is_active: true },
  ],
}

function fakeApi(): ParameterPersistenceApi {
  return {
    create: vi.fn(),
    update: vi.fn(),
    replaceOptions: vi.fn(),
  }
}

function validCreateState(): ParameterFormState {
  return {
    code: 'exposure',
    displayName: 'Exposure',
    valueType: 'number',
    description: '',
    categoryId: '',
    unit: 'mJ',
    minValue: '0',
    maxValue: '100',
    optionsText: '',
  }
}

describe('parameter persistence', () => {
  it('creates with POST only', async () => {
    const api = fakeApi()
    vi.mocked(api.create).mockResolvedValue(numberParameter)
    const plan = buildParameterCreatePlan(validCreateState())

    await expect(persistParameter({ mode: 'create', plan }, api)).resolves.toEqual({
      kind: 'saved',
      parameter: numberParameter,
    })

    expect(api.create).toHaveBeenCalledWith(plan.payload)
    expect(api.update).not.toHaveBeenCalled()
    expect(api.replaceOptions).not.toHaveBeenCalled()
  })

  it('patches a non-choice edit without replacing options', async () => {
    const api = fakeApi()
    const updated = { ...numberParameter, display_name: 'Updated' }
    vi.mocked(api.update).mockResolvedValue(updated)
    const plan = buildParameterUpdatePlan(numberParameter, {
      ...stateFromParameter(numberParameter),
      displayName: 'Updated',
    })

    await expect(
      persistParameter(
        { mode: 'edit', parameterId: numberParameter.id, valueType: 'number', plan },
        api,
      ),
    ).resolves.toEqual({ kind: 'saved', parameter: updated })

    expect(api.update).toHaveBeenCalledWith(numberParameter.id, plan.payload)
    expect(api.replaceOptions).not.toHaveBeenCalled()
  })

  it('patches a choice parameter before replacing its options', async () => {
    const api = fakeApi()
    const base = { ...choiceParameter, display_name: 'Updated polarity' }
    const complete = { ...base, options: choiceParameter.options }
    vi.mocked(api.update).mockResolvedValue(base)
    vi.mocked(api.replaceOptions).mockResolvedValue(complete)
    const plan = buildParameterUpdatePlan(choiceParameter, {
      ...stateFromParameter(choiceParameter),
      displayName: 'Updated polarity',
      optionsText: 'neg, pos',
    })

    await expect(
      persistParameter(
        { mode: 'edit', parameterId: choiceParameter.id, valueType: 'choice', plan },
        api,
      ),
    ).resolves.toEqual({ kind: 'saved', parameter: complete })

    expect(api.update).toHaveBeenCalledWith(choiceParameter.id, plan.payload)
    expect(api.replaceOptions).toHaveBeenCalledWith(choiceParameter.id, plan.options)
    expect(vi.mocked(api.update).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.replaceOptions).mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('patches choice metadata without PUT so inactive options cannot be reactivated', async () => {
    const api = fakeApi()
    const original: ParameterOut = {
      ...choiceParameter,
      options: [
        ...choiceParameter.options,
        { id: 2, value: 'old', display_name: 'Deprecated', sort_order: 1, is_active: false },
      ],
    }
    const updated = { ...original, display_name: 'Updated polarity' }
    vi.mocked(api.update).mockResolvedValue(updated)
    const plan = buildParameterUpdatePlan(original, {
      ...stateFromParameter(original),
      displayName: 'Updated polarity',
    })

    expect(plan.optionsDirty).toBe(false)
    await expect(
      persistParameter(
        { mode: 'edit', parameterId: original.id, valueType: 'choice', plan },
        api,
      ),
    ).resolves.toEqual({ kind: 'saved', parameter: updated })

    expect(api.update).toHaveBeenCalledTimes(1)
    expect(api.update).toHaveBeenCalledWith(original.id, plan.payload)
    expect(api.replaceOptions).not.toHaveBeenCalled()
  })

  it('does not replace choice options when PATCH rejects', async () => {
    const api = fakeApi()
    const error = new Error('PATCH failed')
    vi.mocked(api.update).mockRejectedValue(error)
    const plan = buildParameterUpdatePlan(choiceParameter, {
      ...stateFromParameter(choiceParameter),
      displayName: 'Updated polarity',
    })

    await expect(
      persistParameter(
        { mode: 'edit', parameterId: choiceParameter.id, valueType: 'choice', plan },
        api,
      ),
    ).rejects.toBe(error)
    expect(api.replaceOptions).not.toHaveBeenCalled()
  })

  it('returns saved core data and the retained draft when PUT rejects', async () => {
    const api = fakeApi()
    const base = { ...choiceParameter, display_name: 'Updated polarity' }
    const error = new Error('PUT failed')
    vi.mocked(api.update).mockResolvedValue(base)
    vi.mocked(api.replaceOptions).mockRejectedValue(error)
    const plan = buildParameterUpdatePlan(choiceParameter, {
      ...stateFromParameter(choiceParameter),
      displayName: 'Updated polarity',
      optionsText: 'neg, pos',
    })

    await expect(
      persistParameter(
        { mode: 'edit', parameterId: choiceParameter.id, valueType: 'choice', plan },
        api,
      ),
    ).resolves.toEqual({
      kind: 'options-partial-failure',
      baseParameter: base,
      optionsDraft: plan.options,
      error,
    })
  })

  it('retries options with PUT only', async () => {
    const api = fakeApi()
    const optionsDraft = [{ value: 'neg', display_name: 'neg', sort_order: 0 }]
    vi.mocked(api.replaceOptions).mockResolvedValue(choiceParameter)

    await expect(retryParameterOptions(43, optionsDraft, api)).resolves.toBe(choiceParameter)

    expect(api.replaceOptions).toHaveBeenCalledTimes(1)
    expect(api.replaceOptions).toHaveBeenCalledWith(43, optionsDraft)
    expect(api.create).not.toHaveBeenCalled()
    expect(api.update).not.toHaveBeenCalled()
  })

  it('makes zero API calls for clean, invalid, or unsupported-clear plans', async () => {
    const cases = [
      buildParameterUpdatePlan(numberParameter, stateFromParameter(numberParameter)),
      buildParameterUpdatePlan(numberParameter, {
        ...stateFromParameter(numberParameter),
        displayName: ' ',
      }),
      buildParameterUpdatePlan(numberParameter, {
        ...stateFromParameter(numberParameter),
        unit: '',
      }),
    ]

    for (const plan of cases) {
      const api = fakeApi()
      await expect(
        persistParameter(
          { mode: 'edit', parameterId: numberParameter.id, valueType: 'number', plan },
          api,
        ),
      ).rejects.toThrow()
      expect(api.create).not.toHaveBeenCalled()
      expect(api.update).not.toHaveBeenCalled()
      expect(api.replaceOptions).not.toHaveBeenCalled()
    }
  })

  it('makes zero API calls when comma-delimited option editing is ambiguous', async () => {
    const api = fakeApi()
    const original: ParameterOut = {
      ...choiceParameter,
      options: [
        {
          id: 1,
          value: 'warm,high',
          display_name: 'Warm / high',
          sort_order: 0,
          is_active: true,
        },
        {
          id: 2,
          value: 'cool',
          display_name: 'Cool label',
          sort_order: 1,
          is_active: true,
        },
      ],
    }
    const plan = buildParameterUpdatePlan(original, {
      ...stateFromParameter(original),
      optionsText: 'cool, warm, high',
    })

    await expect(
      persistParameter(
        { mode: 'edit', parameterId: original.id, valueType: 'choice', plan },
        api,
      ),
    ).rejects.toThrow()
    expect(api.create).not.toHaveBeenCalled()
    expect(api.update).not.toHaveBeenCalled()
    expect(api.replaceOptions).not.toHaveBeenCalled()
  })

  it.each([
    ['add', 'pos, deprecated, neg, neutral'],
    ['remove', 'pos, neg'],
    ['reorder', 'neg, pos, deprecated'],
    ['value edit', 'pos, replacement, neg'],
  ])('makes zero API calls for an inactive-option %s', async (_operation, optionsText) => {
    const api = fakeApi()
    const original: ParameterOut = {
      ...choiceParameter,
      options: [
        { id: 1, value: 'pos', display_name: 'Positive', sort_order: 0, is_active: true },
        {
          id: 2,
          value: 'deprecated',
          display_name: 'Deprecated',
          sort_order: 1,
          is_active: false,
        },
        { id: 3, value: 'neg', display_name: 'Negative', sort_order: 2, is_active: true },
      ],
    }
    const plan = buildParameterUpdatePlan(original, {
      ...stateFromParameter(original),
      optionsText,
    })

    await expect(
      persistParameter(
        { mode: 'edit', parameterId: original.id, valueType: 'choice', plan },
        api,
      ),
    ).rejects.toThrow()
    expect(api.create).not.toHaveBeenCalled()
    expect(api.update).not.toHaveBeenCalled()
    expect(api.replaceOptions).not.toHaveBeenCalled()
  })
})
