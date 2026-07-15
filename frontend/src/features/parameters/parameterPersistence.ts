import type {
  OptionIn,
  ParameterCreate,
  ParameterOut,
  ParameterUpdate,
  ValueType,
} from '@/api/types'

import type { ParameterCreatePlan, ParameterUpdatePlan } from './form'

export type PersistParameterInput =
  | { mode: 'create'; plan: ParameterCreatePlan }
  | {
      mode: 'edit'
      parameterId: number
      valueType: ValueType
      plan: ParameterUpdatePlan
    }

export interface ParameterPersistenceApi {
  create(data: ParameterCreate): Promise<ParameterOut>
  update(parameterId: number, data: ParameterUpdate): Promise<ParameterOut>
  replaceOptions(parameterId: number, options: OptionIn[]): Promise<ParameterOut>
}

export type PersistResult =
  | { kind: 'saved'; parameter: ParameterOut }
  | {
      kind: 'options-partial-failure'
      baseParameter: ParameterOut
      optionsDraft: OptionIn[]
      error: unknown
    }

export async function persistParameter(
  input: PersistParameterInput,
  api: ParameterPersistenceApi,
): Promise<PersistResult> {
  assertPlanReady(input.plan)

  if (input.mode === 'create') {
    return { kind: 'saved', parameter: await api.create(input.plan.payload) }
  }

  if (input.plan.unsupportedClears.length > 0) {
    throw new Error('Unsupported parameter clears must be restored before saving.')
  }

  const baseParameter = await api.update(input.parameterId, input.plan.payload)
  if (input.valueType !== 'choice' || !input.plan.optionsDirty) {
    return { kind: 'saved', parameter: baseParameter }
  }

  try {
    const parameter = await api.replaceOptions(input.parameterId, input.plan.options)
    return { kind: 'saved', parameter }
  } catch (error: unknown) {
    return {
      kind: 'options-partial-failure',
      baseParameter,
      optionsDraft: input.plan.options.map((option) => ({ ...option })),
      error,
    }
  }
}

export async function retryParameterOptions(
  parameterId: number,
  optionsDraft: OptionIn[],
  api: ParameterPersistenceApi,
): Promise<ParameterOut> {
  return api.replaceOptions(parameterId, optionsDraft)
}

function assertPlanReady(plan: ParameterCreatePlan | ParameterUpdatePlan): void {
  if (!plan.dirty) throw new Error('A clean parameter plan cannot be persisted.')
  if (Object.keys(plan.fieldErrors).length > 0) {
    throw new Error('A parameter plan with field errors cannot be persisted.')
  }
}
