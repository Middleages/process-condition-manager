import type { ManualOverrideIn } from '@/api/types'

import type { ProjectCreateRouteState } from './urlState'

export interface WizardSelectionState {
  processKey: string | null
  backboneId: number | null
  overrides: Record<string, string>
}

export function selectProcess(
  current: WizardSelectionState,
  processKey: string | null,
): WizardSelectionState {
  if (current.processKey === processKey) return current

  return { processKey, backboneId: null, overrides: {} }
}

export function selectBackbone(
  current: WizardSelectionState,
  backboneId: number | null,
): WizardSelectionState {
  if (current.backboneId === backboneId) return current

  return { ...current, backboneId, overrides: {} }
}

export function toManualOverrides(overrides: Record<string, string>): ManualOverrideIn[] {
  return Object.entries(overrides)
    .filter(([, sourceLayerKey]) => sourceLayerKey !== '')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([target_layer_key, source_layer_key]) => ({
      target_layer_key,
      source_layer_key,
    }))
}

export function previewFingerprint(
  processKey: string | null,
  backboneId: number | null,
  overrides: Record<string, string>,
): string {
  return JSON.stringify({
    processKey,
    backboneId,
    manualOverrides: toManualOverrides(overrides),
  })
}

export type CreateDisabledReason =
  | 'process-missing'
  | 'process-loading'
  | 'process-invalid'
  | 'duplicate-process'
  | 'backbone-loading'
  | 'backbone-invalid'
  | 'preview-loading'
  | 'preview-error'
  | 'preview-stale'
  | 'required-fields'
  | 'submitting'

export interface CreateGuardState {
  processKey: string | null
  processIsPending: boolean
  processIsError: boolean
  processHasProject: boolean
  backboneId: number | null
  backboneIsPending: boolean
  backboneIsError: boolean
  previewIsPending: boolean
  previewIsFetching: boolean
  previewIsError: boolean
  previewFingerprint: string | null
  currentFingerprint: string
  requiredFieldsComplete: boolean
  isSubmitting: boolean
}

export function getCreateDisabledReason(state: CreateGuardState): CreateDisabledReason | null {
  if (state.isSubmitting) return 'submitting'
  if (state.processKey === null) return 'process-missing'
  if (state.processIsPending) return 'process-loading'
  if (state.processIsError) return 'process-invalid'
  if (state.processHasProject) return 'duplicate-process'
  if (state.backboneId !== null && state.backboneIsPending) return 'backbone-loading'
  if (state.backboneId !== null && state.backboneIsError) return 'backbone-invalid'
  if (state.previewIsPending || state.previewIsFetching) {
    return 'preview-loading'
  }
  if (state.previewIsError) return 'preview-error'
  if (state.previewFingerprint === null) return 'preview-loading'
  if (state.previewFingerprint !== state.currentFingerprint) return 'preview-stale'
  if (!state.requiredFieldsComplete) return 'required-fields'

  return null
}

export interface ProjectCreateRouteReconciliation {
  key: string
  kind: 'process' | 'backbone'
  routeState: ProjectCreateRouteState
}

export function getProjectCreateRouteReconciliation({
  routeState,
  processNotFound,
  processHasProject,
  backboneNotFound,
}: {
  routeState: ProjectCreateRouteState
  processNotFound: boolean
  processHasProject: boolean
  backboneNotFound: boolean
}): ProjectCreateRouteReconciliation | null {
  if (
    routeState.processKey === null &&
    (routeState.step !== 1 || routeState.backboneId !== null)
  ) {
    return {
      key: 'process:missing',
      kind: 'process',
      routeState: { step: 1, processKey: null, backboneId: null },
    }
  }
  if (routeState.processKey !== null && (processNotFound || processHasProject)) {
    if (routeState.step === 1 && routeState.backboneId === null) return null

    return {
      key: `process:${routeState.processKey}:${processNotFound ? 'not-found' : 'duplicate'}`,
      kind: 'process',
      routeState: {
        step: 1,
        processKey: routeState.processKey,
        backboneId: null,
      },
    }
  }

  if (routeState.backboneId !== null && backboneNotFound) {
    return {
      key: `backbone:${routeState.backboneId}:not-found`,
      kind: 'backbone',
      routeState: {
        step: 2,
        processKey: routeState.processKey,
        backboneId: null,
      },
    }
  }

  return null
}

export function shouldApplyRouteReconciliation(
  appliedKey: string | null,
  reconciliationKey: string | null,
): boolean {
  return reconciliationKey !== null && reconciliationKey !== appliedKey
}

export function isWizardInteractionLocked({
  submitLatched,
  mutationPending,
  completionPending,
}: {
  submitLatched: boolean
  mutationPending: boolean
  completionPending: boolean
}): boolean {
  return submitLatched || mutationPending || completionPending
}

interface QueryInvalidator {
  invalidateQueries(options: { queryKey: readonly unknown[] }): Promise<unknown>
}

export async function invalidateProjectCreationQueries(
  queryClient: QueryInvalidator,
  process: { key: string; line_id: string; process_id: string },
): Promise<void> {
  const queryKeys = [
    ['projects'],
    ['process', process.key],
    ['processes', 'picker'],
    ['process-catalog'],
    ['backbone-candidates', process.line_id, process.process_id],
  ] as const

  await Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}
