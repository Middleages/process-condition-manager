import { describe, expect, it, vi } from 'vitest'

import type { ParameterOut } from '@/api/types'

import {
  persistParameter,
  type ParameterPersistenceApi,
} from './parameterPersistence'
import {
  buildParameterCreatePlan,
  buildParameterUpdatePlan,
  initialParameterFormState,
  stateFromParameter,
} from './form'

const numberParameter: ParameterOut = {
  id: 42,
  code: 'exposure',
  display_name: 'Exposure',
  description: null,
  value_type: 'number',
  category_id: null,
  unit: 'mJ',
  min_value: '0',
  max_value: '100',
  choice_set: null,
  sort_order: 0,
  is_active: true,
}

function api() {
  return {
    create: vi.fn<ParameterPersistenceApi['create']>(),
    update: vi.fn<ParameterPersistenceApi['update']>(),
  }
}

describe('atomic parameter persistence', () => {
  it('creates once and returns the ParameterOut directly', async () => {
    const client = api()
    client.create.mockResolvedValue(numberParameter)
    const plan = buildParameterCreatePlan({
      ...initialParameterFormState,
      code: 'exposure',
      displayName: 'Exposure',
      valueType: 'number',
      minValue: '000.0',
      maxValue: '100.00',
    })

    const result = await persistParameter({ mode: 'create', plan }, client)

    expect(result).toBe(numberParameter)
    expect(client.create).toHaveBeenCalledTimes(1)
    expect(client.create).toHaveBeenCalledWith(plan.payload)
    expect(client.update).not.toHaveBeenCalled()
    expect(result).not.toHaveProperty('kind')
  })

  it('updates once with no ChoiceSet or option follow-up call', async () => {
    const client = api()
    const updated = { ...numberParameter, display_name: 'Updated' }
    client.update.mockResolvedValue(updated)
    const plan = buildParameterUpdatePlan(numberParameter, {
      ...stateFromParameter(numberParameter),
      displayName: 'Updated',
    })

    const result = await persistParameter(
      { mode: 'edit', parameterId: numberParameter.id, plan },
      client,
    )

    expect(result).toBe(updated)
    expect(client.update).toHaveBeenCalledTimes(1)
    expect(client.update).toHaveBeenCalledWith(numberParameter.id, plan.payload)
    expect(client.create).not.toHaveBeenCalled()
    expect(client).not.toHaveProperty('replaceOptions')
  })

  it('propagates the only mutation failure instead of creating partial retry state', async () => {
    const client = api()
    const failure = new Error('PATCH failed')
    client.update.mockRejectedValue(failure)
    const plan = buildParameterUpdatePlan(numberParameter, {
      ...stateFromParameter(numberParameter),
      displayName: 'Updated',
    })

    await expect(
      persistParameter(
        { mode: 'edit', parameterId: numberParameter.id, plan },
        client,
      ),
    ).rejects.toBe(failure)
    expect(client.update).toHaveBeenCalledTimes(1)
  })

  it('makes no request for clean, invalid, or unsupported-clear plans', async () => {
    const client = api()
    const clean = buildParameterUpdatePlan(numberParameter, stateFromParameter(numberParameter))
    const invalid = buildParameterCreatePlan({
      ...initialParameterFormState,
      code: '',
      displayName: '',
    })
    const unsupportedClear = buildParameterUpdatePlan(numberParameter, {
      ...stateFromParameter(numberParameter),
      unit: '',
    })

    await expect(
      persistParameter(
        { mode: 'edit', parameterId: numberParameter.id, plan: clean },
        client,
      ),
    ).rejects.toThrow('clean')
    await expect(
      persistParameter({ mode: 'create', plan: invalid }, client),
    ).rejects.toThrow('field errors')
    await expect(
      persistParameter(
        { mode: 'edit', parameterId: numberParameter.id, plan: unsupportedClear },
        client,
      ),
    ).rejects.toThrow('Unsupported parameter clears')

    expect(client.create).not.toHaveBeenCalled()
    expect(client.update).not.toHaveBeenCalled()
  })
})
