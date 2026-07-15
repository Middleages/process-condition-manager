import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { validateProject } from '@/api/validation'
import type {
  ValidationIssueOut,
  ValidationSummaryOut,
} from '@/api/types'
import type { CellStatus } from '@/grid/types'
import { useIsomorphicLayoutEffect } from '@/shared/lib/useIsomorphicLayoutEffect'
import type { ValidationInput } from '@/shared/domain/validation'

import type { SaveState } from './autosave'
import { SheetAdapterError, withValidationDisplayRows } from './sheetAdapter'
import type { AdaptedConditionGridRow } from './sheetAdapter'
import {
  buildCellStatuses,
  evaluateProvisional,
  selectEffectiveValidation,
  VALIDATION_DEFINITIONS_FAILURE,
  VALIDATION_PERSISTENCE_GUIDANCE,
  VALIDATION_SERVER_FAILURE,
  type CommentStatusFact,
  type DirtyStatusFact,
  type AuthoritativeValidationConfirmation,
  type EffectiveValidationState,
  type ProvisionalValidationState,
} from './validationState'

export type ServerConfirmation =
  | 'idle'
  | 'waiting-for-persistence'
  | 'validating'
  | 'confirmed'
  | 'failed'

export interface PersistenceSnapshot {
  dirtyCount: number
  writeBusy: boolean
  saveStatus: SaveState
  persistedGeneration: number
}

/** A committed runtime publication. Tokens are unique mount/definition authorities, not counters. */
export interface SheetValidationContext {
  projectId: number
  mountAuthority: symbol
  definitionAuthority: symbol
  validationBasisHash: string
  definitionsReady: boolean
  persistedGeneration: number
  persistenceIdle: boolean
  getPersistenceSnapshot: () => PersistenceSnapshot
  waitForPersistence: () => Promise<boolean>
  refetchSheet: () => Promise<void>
}

export interface SheetValidationServerState {
  authoritativeIssues: readonly ValidationIssueOut[]
  authoritativeSummary: ValidationSummaryOut | null
  /** Latest successful confirmation is retained when a later attempt fails. */
  authoritativeConfirmation: AuthoritativeValidationConfirmation | null
  serverConfirmation: ServerConfirmation
  serverFailure: string | null
  explicitValidationCompleted: boolean
}

export interface SheetValidationController {
  getState(): SheetValidationServerState
  subscribe(listener: (state: SheetValidationServerState) => void): () => void
  publish(context: SheetValidationContext): void
  explicitlyValidate(): Promise<boolean>
  retry(): Promise<boolean>
  dispose(): void
}

interface ValidationCapture {
  projectId: number
  mountAuthority: symbol
  definitionAuthority: symbol
  validationBasisHash: string
  persistedGeneration: number
}

interface ActiveRequest {
  token: symbol
  controller: AbortController
  capture: ValidationCapture
}

export function createSheetValidationController({
  validate = validateProject,
  debounceMs = 500,
}: {
  validate?: typeof validateProject
  debounceMs?: number
} = {}): SheetValidationController {
  let state = initialServerState()
  let current: SheetValidationContext | null = null
  let observedPersistedGeneration: number | null = null
  let pendingAutomaticValidation = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let active: ActiveRequest | null = null
  const listeners = new Set<(next: SheetValidationServerState) => void>()

  function update(patch: Partial<SheetValidationServerState>): void {
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }

  function resetForMount(): void {
    state = initialServerState()
    for (const listener of listeners) listener(state)
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function abortActive(): void {
    if (active === null) return
    active.controller.abort()
    active = null
  }

  function persistenceIsIdle(context: SheetValidationContext): boolean {
    const snapshot = context.getPersistenceSnapshot()
    return (
      context.persistenceIdle &&
      snapshot.dirtyCount === 0 &&
      !snapshot.writeBusy &&
      snapshot.saveStatus !== 'saving' &&
      snapshot.saveStatus !== 'error'
    )
  }

  function scheduleIfReady(): void {
    clearTimer()
    if (
      !pendingAutomaticValidation ||
      current === null ||
      !current.definitionsReady ||
      !persistenceIsIdle(current)
    ) return
    timer = setTimeout(() => {
      timer = null
      if (!pendingAutomaticValidation) return
      pendingAutomaticValidation = false
      void startRequest(false)
    }, debounceMs)
  }

  function authorityMatches(
    capture: Pick<ValidationCapture, 'projectId' | 'mountAuthority' | 'definitionAuthority'>,
  ): boolean {
    return (
      current !== null &&
      current.projectId === capture.projectId &&
      current.mountAuthority === capture.mountAuthority &&
      current.definitionAuthority === capture.definitionAuthority
    )
  }

  function captureIsCurrent(request: ActiveRequest): boolean {
    if (active?.token !== request.token || !authorityMatches(request.capture) || current === null) {
      return false
    }
    const persistence = current.getPersistenceSnapshot()
    return (
      persistence.persistedGeneration === request.capture.persistedGeneration &&
      current.validationBasisHash === request.capture.validationBasisHash
    )
  }

  async function startRequest(explicit: boolean): Promise<boolean> {
    clearTimer()
    pendingAutomaticValidation = false
    const context = current
    if (context === null) return false
    if (!context.definitionsReady) {
      update({ serverConfirmation: 'failed', serverFailure: VALIDATION_DEFINITIONS_FAILURE })
      return false
    }

    const persistence = context.getPersistenceSnapshot()
    if (
      persistence.dirtyCount > 0 ||
      persistence.writeBusy ||
      persistence.saveStatus === 'saving' ||
      persistence.saveStatus === 'error'
    ) {
      update({ serverConfirmation: 'failed', serverFailure: VALIDATION_PERSISTENCE_GUIDANCE })
      return false
    }

    abortActive()
    const controller = new AbortController()
    const request: ActiveRequest = {
      token: Symbol('sheet-validation-request'),
      controller,
      capture: {
        projectId: context.projectId,
        mountAuthority: context.mountAuthority,
        definitionAuthority: context.definitionAuthority,
        validationBasisHash: context.validationBasisHash,
        persistedGeneration: persistence.persistedGeneration,
      },
    }
    active = request
    update({ serverConfirmation: 'validating', serverFailure: null })

    try {
      const response = await validate(request.capture.projectId, controller.signal)
      if (!captureIsCurrent(request)) return false

      if (response.basis_hash !== request.capture.validationBasisHash) {
        await current!.refetchSheet()
        if (!captureIsCurrent(request)) return false
        // Refetch publication must establish the matching definition authority before a retry.
        // Never merge an old-capture response into a different definition basis.
        update({ serverConfirmation: 'failed', serverFailure: VALIDATION_DEFINITIONS_FAILURE })
        return false
      }

      update({
        authoritativeIssues: response.issues,
        authoritativeSummary: response.summary,
        authoritativeConfirmation: {
          basisHash: response.basis_hash,
          definitionAuthority: request.capture.definitionAuthority,
          evaluatedAt: response.evaluated_at,
          persistedGeneration: request.capture.persistedGeneration,
        },
        serverConfirmation: 'confirmed',
        serverFailure: null,
        explicitValidationCompleted: state.explicitValidationCompleted || explicit,
      })
      return true
    } catch {
      if (!captureIsCurrent(request)) return false
      update({ serverConfirmation: 'failed', serverFailure: VALIDATION_SERVER_FAILURE })
      return false
    } finally {
      if (active?.token === request.token) active = null
    }
  }

  async function validateAfterPersistence(explicit: boolean): Promise<boolean> {
    const context = current
    if (context === null) return false
    const authority = {
      projectId: context.projectId,
      mountAuthority: context.mountAuthority,
      definitionAuthority: context.definitionAuthority,
    }
    const before = context.getPersistenceSnapshot()
    if (
      before.dirtyCount > 0 ||
      before.writeBusy ||
      before.saveStatus === 'saving' ||
      before.saveStatus === 'error' ||
      !context.persistenceIdle
    ) {
      update({ serverConfirmation: 'waiting-for-persistence', serverFailure: null })
      let saved = false
      try {
        saved = await context.waitForPersistence()
      } catch {
        saved = false
      }
      if (!authorityMatches(authority) || current === null) return false
      const after = current.getPersistenceSnapshot()
      if (
        !saved ||
        after.dirtyCount > 0 ||
        after.writeBusy ||
        after.saveStatus === 'saving' ||
        after.saveStatus === 'error'
      ) {
        update({ serverConfirmation: 'failed', serverFailure: VALIDATION_PERSISTENCE_GUIDANCE })
        return false
      }
    }
    return startRequest(explicit)
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish(next) {
      const previous = current
      current = next
      if (previous === null) {
        observedPersistedGeneration = next.persistedGeneration
        return
      }

      const mountChanged =
        previous.projectId !== next.projectId ||
        previous.mountAuthority !== next.mountAuthority
      const definitionChanged =
        previous.definitionAuthority !== next.definitionAuthority ||
        previous.validationBasisHash !== next.validationBasisHash
      const persistedChanged = observedPersistedGeneration !== next.persistedGeneration
      observedPersistedGeneration = next.persistedGeneration

      if (mountChanged) {
        clearTimer()
        abortActive()
        pendingAutomaticValidation = false
        resetForMount()
        return
      }
      if (definitionChanged || persistedChanged) {
        abortActive()
        pendingAutomaticValidation = true
        // The prior payload remains available for explicit failure/recovery presentation, but it
        // is no longer a confirmation of this newly committed generation/definition authority.
        update({
          serverConfirmation: 'idle',
          serverFailure: next.definitionsReady ? null : VALIDATION_DEFINITIONS_FAILURE,
        })
      }
      scheduleIfReady()
    },
    explicitlyValidate: () => validateAfterPersistence(true),
    retry: () => validateAfterPersistence(false),
    dispose() {
      clearTimer()
      abortActive()
      pendingAutomaticValidation = false
      current = null
      observedPersistedGeneration = null
    },
  }
}

function initialServerState(): SheetValidationServerState {
  return {
    authoritativeIssues: [],
    authoritativeSummary: null,
    authoritativeConfirmation: null,
    serverConfirmation: 'idle',
    serverFailure: null,
    explicitValidationCompleted: false,
  }
}

export function deriveProvisionalValidation(
  definitions: ValidationInput | null,
  displayRows: readonly AdaptedConditionGridRow[],
): ProvisionalValidationState {
  if (definitions === null) return evaluateProvisional(null)
  try {
    return evaluateProvisional(withValidationDisplayRows(definitions, displayRows))
  } catch (error) {
    if (error instanceof SheetAdapterError) return evaluateProvisional(null)
    throw error
  }
}

export interface UseSheetValidationOptions {
  projectId: number
  definitions: ValidationInput | null
  definitionAuthority: symbol
  validationBasisHash: string
  displayRows: readonly AdaptedConditionGridRow[]
  displayGeneration: number
  persistedGeneration: number
  persistenceIdle: boolean
  dirtyCells: Iterable<DirtyStatusFact>
  comments?: Iterable<CommentStatusFact>
  getPersistenceSnapshot: () => PersistenceSnapshot
  waitForPersistence: () => Promise<boolean>
  refetchSheet: () => Promise<void>
}

export interface SheetValidation extends SheetValidationServerState {
  provisional: ProvisionalValidationState
  provisionalIssues: ProvisionalValidationState['issues']
  provisionalSummary: ValidationSummaryOut | null
  issues: EffectiveValidationState['issues']
  summary: EffectiveValidationState['summary']
  issueAuthority: EffectiveValidationState['authority']
  statuses: readonly CellStatus[]
  explicitlyValidate(): Promise<boolean>
  retry(): Promise<boolean>
}

export function useSheetValidation(options: UseSheetValidationOptions): SheetValidation {
  const controllerRef = useRef<SheetValidationController | null>(null)
  if (controllerRef.current === null) {
    controllerRef.current = createSheetValidationController()
  }
  const controller = controllerRef.current
  const mountAuthorityRef = useRef(Symbol('mounted-sheet-validation-authority'))
  const [serverState, setServerState] = useState(controller.getState())

  const provisional = useMemo(
    () => deriveProvisionalValidation(options.definitions, options.displayRows),
    [options.definitions, options.displayRows, options.displayGeneration],
  )
  const committedDefinitionAuthority = useMemo(
    () => Symbol('committed-validation-definition-authority'),
    [options.definitionAuthority, provisional.status],
  )
  const parameterNames = useMemo(
    () =>
      Object.fromEntries(
        (options.definitions?.parameters ?? []).map((parameter) => [
          parameter.code,
          parameter.display_name,
        ]),
      ),
    [options.definitions],
  )
  const effective = useMemo(
    () =>
      selectEffectiveValidation({
        provisional,
        authoritativeIssues: serverState.authoritativeIssues,
        authoritativeSummary: serverState.authoritativeSummary,
        authoritativeConfirmation: serverState.authoritativeConfirmation,
        currentBasisHash: options.validationBasisHash,
        currentDefinitionAuthority: committedDefinitionAuthority,
        currentPersistedGeneration: options.persistedGeneration,
        persistenceIdle: options.persistenceIdle,
      }),
    [
      provisional,
      serverState.authoritativeIssues,
      serverState.authoritativeSummary,
      serverState.authoritativeConfirmation,
      options.validationBasisHash,
      committedDefinitionAuthority,
      options.persistedGeneration,
      options.persistenceIdle,
    ],
  )
  const statuses = useMemo(
    () =>
      buildCellStatuses({
        issues: effective.issues,
        dirtyCells: options.dirtyCells,
        comments: options.comments,
        parameterNames,
      }),
    [effective.issues, options.dirtyCells, options.comments, parameterNames],
  )

  useEffect(() => controller.subscribe(setServerState), [controller])

  useIsomorphicLayoutEffect(() => {
    const context: SheetValidationContext = {
      projectId: options.projectId,
      mountAuthority: mountAuthorityRef.current,
      definitionAuthority: committedDefinitionAuthority,
      validationBasisHash: options.validationBasisHash,
      definitionsReady: provisional.status === 'ready',
      persistedGeneration: options.persistedGeneration,
      persistenceIdle: options.persistenceIdle,
      getPersistenceSnapshot: options.getPersistenceSnapshot,
      waitForPersistence: options.waitForPersistence,
      refetchSheet: options.refetchSheet,
    }
    controller.publish(context)
  }, [
    controller,
    options.projectId,
    committedDefinitionAuthority,
    options.validationBasisHash,
    options.persistedGeneration,
    options.persistenceIdle,
    options.getPersistenceSnapshot,
    options.waitForPersistence,
    options.refetchSheet,
    provisional.status,
  ])

  useEffect(
    () => () => {
      controller.dispose()
    },
    [controller],
  )

  const explicitlyValidate = useCallback(
    () => controller.explicitlyValidate(),
    [controller],
  )
  const retry = useCallback(() => controller.retry(), [controller])

  return {
    ...serverState,
    provisional,
    provisionalIssues: provisional.issues,
    provisionalSummary: provisional.summary,
    issues: effective.issues,
    summary: effective.summary,
    issueAuthority: effective.authority,
    statuses,
    explicitlyValidate,
    retry,
  }
}
