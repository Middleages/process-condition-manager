import type { ParameterCreate, ParameterOut, ParameterUpdate } from '@/api/types'

import type { ParameterCreatePlan, ParameterUpdatePlan } from './form'

export type PersistParameterInput =
  | { mode: 'create'; plan: ParameterCreatePlan }
  | { mode: 'edit'; parameterId: number; plan: ParameterUpdatePlan }

export interface ParameterPersistenceApi {
  create(data: ParameterCreate): Promise<ParameterOut>
  update(parameterId: number, data: ParameterUpdate): Promise<ParameterOut>
}

export async function persistParameter(
  input: PersistParameterInput,
  api: ParameterPersistenceApi,
): Promise<ParameterOut> {
  assertPlanReady(input.plan)

  if (input.mode === 'create') return api.create(input.plan.payload)
  return api.update(input.parameterId, input.plan.payload)
}

function assertPlanReady(plan: ParameterCreatePlan | ParameterUpdatePlan): void {
  if (Object.keys(plan.fieldErrors).length > 0) {
    throw new Error('A parameter plan with field errors cannot be persisted.')
  }
  if (!plan.dirty) throw new Error('A clean parameter plan cannot be persisted.')
}
