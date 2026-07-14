import type { ManualOverrideIn, MatchType, ProjectCreate } from '@/api/types'

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

export function updateManualOverride(
  current: Record<string, string>,
  targetLayerKey: string,
  sourceLayerKey: string,
): Record<string, string> {
  if ((current[targetLayerKey] ?? '') === sourceLayerKey) return current

  const next = { ...current }
  if (sourceLayerKey === '') delete next[targetLayerKey]
  else next[targetLayerKey] = sourceLayerKey
  return next
}

export function getManualOverrideDefaultLabel({
  matchType,
  sourceLayerKey,
  baselineAutomaticSource,
}: {
  matchType: MatchType
  sourceLayerKey: string | null
  baselineAutomaticSource: string | null
}): string {
  if (matchType === 'auto') {
    return sourceLayerKey
      ? `자동 매칭 유지 · ${sourceLayerKey}`
      : '자동 매칭 유지'
  }
  if (matchType === 'manual') {
    return baselineAutomaticSource
      ? `수동 매칭 해제 · 자동 규칙 재적용 · ${baselineAutomaticSource}`
      : '수동 매칭 해제 · 빈 값'
  }
  return '미매칭 · 빈 값'
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
  | 'device-types-loading'
  | 'device-types-error'
  | 'device-types-empty'
  | 'device-types-inactive'
  | 'categories-loading'
  | 'categories-error'
  | 'categories-empty'
  | 'categories-inactive'
  | 'profile-required-fields'
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
  deviceTypeCode: string
  deviceTypesLoading: boolean
  deviceTypesError: boolean
  deviceTypeSetIsActive: boolean | null
  deviceTypesReady: boolean
  deviceTypeHasActiveOptions: boolean
  deviceTypeSelectionIsActive: boolean
  categoryCode: string
  categoriesLoading: boolean
  categoriesError: boolean
  categorySetIsActive: boolean | null
  categoriesReady: boolean
  categoryHasActiveOptions: boolean
  categorySelectionIsActive: boolean
  isSubmitting: boolean
}

export interface RequiredChoiceResourceState {
  loading: boolean
  refreshing: boolean
  error: string | null
  setIsActive: boolean | null
  selectionReady: boolean
  displayOptions: readonly { code: string; is_active: boolean }[]
  selectableOptions: readonly { code: string; is_active: boolean }[]
}

export interface RequiredChoiceState {
  loading: boolean
  error: boolean
  setIsActive: boolean | null
  ready: boolean
  hasActiveOptions: boolean
  selectionIsActive: boolean
  sourceActive: boolean
  sourceInactive: boolean
}

export function deriveRequiredChoiceState(
  resource: RequiredChoiceResourceState,
  rawCode: string,
): RequiredChoiceState {
  const normalizedCode = rawCode.trim()
  const selectedActive =
    resource.selectionReady &&
    normalizedCode !== '' &&
    resource.selectableOptions.some(
      (option) => option.is_active && option.code === normalizedCode,
    )

  return {
    loading: resource.loading || resource.refreshing,
    error: resource.error !== null,
    setIsActive: resource.setIsActive,
    ready: resource.selectionReady,
    hasActiveOptions: resource.selectableOptions.some((option) => option.is_active),
    selectionIsActive: selectedActive,
    sourceActive: resource.setIsActive === true,
    sourceInactive:
      resource.selectionReady && normalizedCode !== '' && !selectedActive,
  }
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
  if (state.deviceTypesError) return 'device-types-error'
  if (state.deviceTypeSetIsActive === false) return 'device-types-inactive'
  if (state.deviceTypesLoading) return 'device-types-loading'
  if (state.deviceTypeSetIsActive === null || !state.deviceTypesReady) {
    return 'device-types-loading'
  }
  if (!state.deviceTypeHasActiveOptions) return 'device-types-empty'
  if (state.deviceTypeCode.trim() !== '' && !state.deviceTypeSelectionIsActive) {
    return 'device-types-inactive'
  }
  if (state.categoriesError) return 'categories-error'
  if (state.categorySetIsActive === false) return 'categories-inactive'
  if (state.categoriesLoading) return 'categories-loading'
  if (state.categorySetIsActive === null || !state.categoriesReady) {
    return 'categories-loading'
  }
  if (!state.categoryHasActiveOptions) return 'categories-empty'
  if (state.categoryCode.trim() !== '' && !state.categorySelectionIsActive) {
    return 'categories-inactive'
  }
  if (state.deviceTypeCode.trim() === '' || state.categoryCode.trim() === '') {
    return 'profile-required-fields'
  }
  if (!state.requiredFieldsComplete) return 'required-fields'

  return null
}

export interface ProjectCreateDraft {
  lineId: string
  processId: string
  partId: string
  name: string
  deviceTypeCode: string
  projectCategoryCode: string
  comment: string
  commentTouched: boolean
  backboneId: number | null
  overrides: Record<string, string>
}

export function toProjectCreatePayload(draft: ProjectCreateDraft): ProjectCreate {
  const payload: ProjectCreate = {
    line_id: draft.lineId.trim(),
    process_id: draft.processId.trim(),
    part_id: draft.partId.trim(),
    name: draft.name.trim(),
    device_type_code: draft.deviceTypeCode.trim(),
    project_category_code: draft.projectCategoryCode.trim(),
    backbone_project_id: draft.backboneId,
    manual_overrides: toManualOverrides(draft.overrides),
  }

  if (draft.commentTouched) {
    const comment = draft.comment.trim()
    payload.comment = comment === '' ? null : comment
  }

  return payload
}

export function isProjectCreateDraftDirty(
  draft: Pick<
    ProjectCreateDraft,
    | 'partId'
    | 'name'
    | 'deviceTypeCode'
    | 'projectCategoryCode'
    | 'comment'
    | 'commentTouched'
    | 'overrides'
  >,
): boolean {
  return (
    draft.partId !== '' ||
    draft.name !== '' ||
    draft.deviceTypeCode !== '' ||
    draft.projectCategoryCode !== '' ||
    draft.comment !== '' ||
    draft.commentTouched ||
    Object.keys(draft.overrides).length > 0
  )
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
