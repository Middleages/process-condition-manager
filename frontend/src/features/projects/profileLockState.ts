import {
  getApiErrorMessage,
  getLockConflictHolder,
  isLockConflict,
} from '@/api/client'
import type {
  LockOut,
  ProjectProfileOut,
  ProjectProfilePatchIn,
} from '@/api/types'

import { hydrateProfileForm, type ProfileFormState } from './profileForm'

export type ProjectProfileLockPhase =
  | 'closed'
  | 'acquiring'
  | 'conflict'
  | 'loading-profile'
  | 'load-error'
  | 'editable'
  | 'saving'
  | 'cancelling'
  | 'releasing'
  | 'lock-lost'

export interface ProjectProfileLockState {
  phase: ProjectProfileLockPhase
  generation: number
  token: string | null
  holder: string | null
  profile: ProjectProfileOut | null
  originalDraft: ProfileFormState | null
  draft: ProfileFormState | null
  recoveryDraft: ProfileFormState | null
  error: string | null
}

export interface ProjectProfileLockDependencies {
  acquire: (projectId: number) => Promise<LockOut>
  heartbeat: (projectId: number, lockToken: string) => Promise<LockOut>
  getProfile: (projectId: number) => Promise<ProjectProfileOut>
  patchProfile: (
    projectId: number,
    payload: ProjectProfilePatchIn,
    lockToken: string,
  ) => Promise<ProjectProfileOut>
  invalidate: (projectId: number, profile: ProjectProfileOut) => Promise<void>
  release: (projectId: number, lockToken: string) => Promise<void>
  heartbeatMs?: number
}

export interface ProjectProfileLockController {
  getState(): ProjectProfileLockState
  subscribe(listener: () => void): () => void
  open(): Promise<void>
  retryLoad(): Promise<void>
  updateDraft(draft: ProfileFormState): void
  save(payload: ProjectProfilePatchIn): Promise<void>
  close(): Promise<void>
  reacquire(): Promise<void>
  releaseOnUnload(): void
  dispose(): void
}

const DEFAULT_HEARTBEAT_MS = 45_000

type OpenOperation = { generation: number; promise: Promise<void> }
type TokenSession = { generation: number; token: string }
type PendingPatch = TokenSession & { promise: Promise<void> }

export function createProjectProfileLockController(
  projectId: number,
  dependencies: ProjectProfileLockDependencies,
  unloadRelease?: (generation: number, token: string) => void,
): ProjectProfileLockController {
  let state: ProjectProfileLockState = {
    phase: 'closed',
    generation: 0,
    token: null,
    holder: null,
    profile: null,
    originalDraft: null,
    draft: null,
    recoveryDraft: null,
    error: null,
  }
  let generationCounter = 0
  let tokenSession: TokenSession | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let openOperation: OpenOperation | null = null
  let reacquireOperation: OpenOperation | null = null
  let pendingPatch: PendingPatch | null = null
  let disposed = false
  const listeners = new Set<() => void>()
  const releasedSessions = new Set<string>()
  const heartbeatMs = dependencies.heartbeatMs ?? DEFAULT_HEARTBEAT_MS

  const emit = (next: ProjectProfileLockState): void => {
    state = next
    for (const listener of listeners) listener()
  }

  const update = (changes: Partial<ProjectProfileLockState>): void => {
    emit({ ...state, ...changes })
  }

  const nextGeneration = (): number => {
    generationCounter += 1
    return generationCounter
  }

  const isGenerationCurrent = (generation: number): boolean =>
    !disposed && state.generation === generation

  const owns = (generation: number, token: string): boolean =>
    isGenerationCurrent(generation) && state.token === token

  const isPhase = (phase: ProjectProfileLockPhase): boolean => state.phase === phase

  const stopHeartbeat = (): void => {
    if (heartbeatTimer === null) return
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  const releaseTokenOnce = async (
    sessionGeneration: number,
    token: string,
  ): Promise<void> => {
    const key = `${sessionGeneration}\u0000${token}`
    if (releasedSessions.has(key)) return
    releasedSessions.add(key)
    try {
      await dependencies.release(projectId, token)
    } catch {
      // Release is best-effort. The server TTL remains the final cleanup boundary.
    }
  }

  const loseLock = (generation: number, token: string, error: unknown): void => {
    if (!owns(generation, token)) return
    stopHeartbeat()
    const invalidatedGeneration = nextGeneration()
    emit({
      ...state,
      phase: 'lock-lost',
      generation: invalidatedGeneration,
      holder: getLockConflictHolder(error),
      recoveryDraft: state.draft ? { ...state.draft } : state.recoveryDraft,
      error: '편집 잠금을 잃었습니다. 현재 초안은 복구용으로 유지됩니다.',
    })
  }

  const startHeartbeat = (generation: number, token: string): void => {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      if (!owns(generation, token)) {
        stopHeartbeat()
        return
      }
      void dependencies
        .heartbeat(projectId, token)
        .then(() => {
          // A successful heartbeat has no state authority beyond proving the captured owner is live.
          // The backend currently keeps the fencing token stable.
          if (!owns(generation, token)) return
        })
        .catch((error: unknown) => {
          if (!owns(generation, token)) return
          // A save that already reached intentional release has an authoritative PATCH response.
          // An older in-flight heartbeat must not turn that completed write into a false lock loss.
          if (state.phase === 'releasing') return
          if (isLockConflict(error)) loseLock(generation, token, error)
          // Transient transport failures are retried by the next interval; TTL is the final fence.
        })
    }, heartbeatMs)
  }

  const loadProfile = async (generation: number, token: string): Promise<void> => {
    if (!owns(generation, token)) return
    update({ phase: 'loading-profile', error: null })
    try {
      const profile = await dependencies.getProfile(projectId)
      if (!owns(generation, token)) return
      const draft = hydrateProfileForm(profile)
      emit({
        ...state,
        phase: 'editable',
        profile,
        originalDraft: draft,
        draft,
        holder: null,
        error: null,
      })
    } catch (error) {
      if (!owns(generation, token)) return
      update({ phase: 'load-error', error: getApiErrorMessage(error) })
    }
  }

  const acquireAndLoad = async (
    generation: number,
    recoveryDraft: ProfileFormState | null,
  ): Promise<void> => {
    try {
      const acquired = await dependencies.acquire(projectId)
      const token = acquired.lock_token
      if (!isGenerationCurrent(generation) || state.phase !== 'acquiring') {
        await releaseTokenOnce(generation, token)
        return
      }

      tokenSession = { generation, token }
      emit({
        ...state,
        phase: 'loading-profile',
        token,
        holder: null,
        profile: null,
        originalDraft: null,
        draft: null,
        recoveryDraft,
        error: null,
      })
      // Start renewal before the fresh GET so a slow/erroring read cannot consume the lock TTL.
      startHeartbeat(generation, token)
      await loadProfile(generation, token)
    } catch (error) {
      if (!isGenerationCurrent(generation) || state.phase !== 'acquiring') return
      emit({
        ...state,
        phase: 'conflict',
        token: null,
        holder: getLockConflictHolder(error),
        profile: null,
        originalDraft: null,
        draft: null,
        error: getApiErrorMessage(error),
      })
    }
  }

  const beginOpen = (recoveryDraft: ProfileFormState | null): Promise<void> => {
    const generation = nextGeneration()
    emit({
      phase: 'acquiring',
      generation,
      token: null,
      holder: null,
      profile: null,
      originalDraft: null,
      draft: null,
      recoveryDraft,
      error: null,
    })
    const promise = acquireAndLoad(generation, recoveryDraft).finally(() => {
      if (openOperation?.generation === generation) openOperation = null
    })
    openOperation = { generation, promise }
    return promise
  }

  const open = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (
      openOperation !== null &&
      openOperation.generation === state.generation &&
      (state.phase === 'acquiring' || state.phase === 'loading-profile')
    ) {
      return openOperation.promise
    }
    if (
      state.phase !== 'closed' &&
      state.phase !== 'conflict'
    ) {
      return Promise.resolve()
    }
    return beginOpen(state.recoveryDraft)
  }

  const retryLoad = async (): Promise<void> => {
    if (state.phase !== 'load-error' || state.token === null) return
    const generation = state.generation
    const token = state.token
    await loadProfile(generation, token)
  }

  const updateDraft = (draft: ProfileFormState): void => {
    if (state.phase !== 'editable') return
    update({ draft: { ...draft }, error: null })
  }

  const runSave = async (
    generation: number,
    token: string,
    payload: ProjectProfilePatchIn,
  ): Promise<void> => {
    let saved: ProjectProfileOut
    try {
      saved = await dependencies.patchProfile(projectId, payload, token)
    } catch (error) {
      if (!owns(generation, token) || state.phase !== 'saving') return
      if (isLockConflict(error)) {
        loseLock(generation, token, error)
      } else {
        update({ phase: 'editable', error: getApiErrorMessage(error) })
      }
      return
    }

    if (!owns(generation, token) || state.phase !== 'saving') return
    const authoritativeDraft = hydrateProfileForm(saved)
    emit({
      ...state,
      profile: saved,
      originalDraft: authoritativeDraft,
      draft: authoritativeDraft,
      error: null,
    })

    try {
      await dependencies.invalidate(projectId, saved)
    } catch (error) {
      if (owns(generation, token) && state.phase === 'saving') {
        update({ error: getApiErrorMessage(error) })
      }
    }
    if (!owns(generation, token) || state.phase !== 'saving') return

    stopHeartbeat()
    update({ phase: 'releasing' })
    const sessionGeneration = tokenSession?.token === token
      ? tokenSession.generation
      : generation
    await releaseTokenOnce(sessionGeneration, token)
    if (!owns(generation, token) || !isPhase('releasing')) return
    tokenSession = null
    emit({ ...state, phase: 'closed', token: null, holder: null, error: null })
  }

  const save = (payload: ProjectProfilePatchIn): Promise<void> => {
    const write = pendingPatch
    if (
      state.phase !== 'editable' ||
      state.token === null ||
      state.draft === null ||
      (write !== null &&
        write.generation === state.generation &&
        write.token === state.token)
    ) {
      return Promise.resolve()
    }
    const generation = state.generation
    const token = state.token
    update({ phase: 'saving', error: null })
    const baseOperation = runSave(generation, token, payload)
    const sessionWrite: PendingPatch = { generation, token, promise: baseOperation }
    const operation = baseOperation.finally(() => {
      if (pendingPatch === sessionWrite) pendingPatch = null
    })
    sessionWrite.promise = operation
    pendingPatch = sessionWrite
    return operation
  }

  const close = async (): Promise<void> => {
    if (state.phase === 'closed' || state.phase === 'saving' || state.phase === 'releasing') {
      return
    }

    const session = tokenSession
    const token = state.token
    stopHeartbeat()
    const closedGeneration = nextGeneration()

    if (token === null || session === null) {
      emit({
        ...state,
        phase: 'closed',
        generation: closedGeneration,
        token: null,
        holder: null,
        profile: null,
        originalDraft: null,
        draft: null,
        error: null,
      })
      return
    }

    if (state.phase === 'editable' || state.phase === 'lock-lost') {
      update({ phase: 'cancelling' })
    }
    emit({ ...state, phase: 'releasing', generation: closedGeneration })
    await releaseTokenOnce(session.generation, token)
    if (
      disposed ||
      !isPhase('releasing') ||
      state.generation !== closedGeneration ||
      state.token !== token
    ) {
      return
    }
    if (tokenSession?.generation === session.generation && tokenSession.token === token) {
      tokenSession = null
    }
    emit({
      ...state,
      phase: 'closed',
      token: null,
      holder: null,
      profile: null,
      originalDraft: null,
      draft: null,
      error: null,
    })
  }

  const reacquire = (): Promise<void> => {
    if (
      reacquireOperation !== null &&
      reacquireOperation.generation === state.generation
    ) {
      return reacquireOperation.promise
    }
    if (state.phase !== 'lock-lost' && state.phase !== 'conflict') return Promise.resolve()

    const recoveryDraft = state.recoveryDraft ?? state.draft
    const oldSession = tokenSession
    stopHeartbeat()
    const generation = nextGeneration()
    emit({
      ...state,
      phase: 'acquiring',
      generation,
      token: null,
      holder: null,
      profile: null,
      originalDraft: null,
      draft: null,
      recoveryDraft,
      error: null,
    })

    const operation = (async () => {
      if (oldSession !== null) {
        await releaseTokenOnce(oldSession.generation, oldSession.token)
        if (tokenSession?.generation === oldSession.generation) tokenSession = null
      }
      if (!isGenerationCurrent(generation) || state.phase !== 'acquiring') return
      await acquireAndLoad(generation, recoveryDraft)
    })().finally(() => {
      if (reacquireOperation?.generation === generation) reacquireOperation = null
    })
    reacquireOperation = { generation, promise: operation }
    return operation
  }

  const releaseOnUnload = (): void => {
    const session = tokenSession
    if (
      session === null ||
      state.token !== session.token ||
      state.phase === 'closed' ||
      state.phase === 'conflict' ||
      state.phase === 'lock-lost'
    ) {
      return
    }
    unloadRelease?.(session.generation, session.token)
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    stopHeartbeat()
    const session = tokenSession
    tokenSession = null
    generationCounter += 1
    state = { ...state, phase: 'closed', generation: generationCounter, token: null }
    listeners.clear()
    if (session === null) return
    const write = pendingPatch
    if (
      write === null ||
      write.generation !== session.generation ||
      write.token !== session.token
    ) {
      void releaseTokenOnce(session.generation, session.token)
    } else {
      void write.promise.finally(() => releaseTokenOnce(session.generation, session.token))
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    open,
    retryLoad,
    updateDraft,
    save,
    close,
    reacquire,
    releaseOnUnload,
    dispose,
  }
}

/** Returns a handler that releases once per newly armed lock generation. */
export function createUnloadReleaseOnce(
  release: (token: string) => void,
): (generation: number, token: string) => void {
  let releasedGeneration: number | null = null
  return (generation, token) => {
    if (releasedGeneration === generation) return
    releasedGeneration = generation
    release(token)
  }
}

export function createProjectProfileUnloadEventHandlers(
  release: () => void,
  defer: (callback: () => void) => void = queueMicrotask,
): {
  pagehide: () => void
  beforeunload: (event: Pick<Event, 'defaultPrevented'>) => void
} {
  return {
    pagehide: release,
    beforeunload: (event) => {
      defer(() => {
        // Other beforeunload listeners (notably the dirty guard) run after this hook's listener.
        // Wait until propagation finishes so a cancelled navigation keeps its live lock.
        if (!event.defaultPrevented) release()
      })
    },
  }
}

export function isProjectProfileCloseDisabled(state: ProjectProfileLockState): boolean {
  return state.phase === 'saving' || state.phase === 'releasing'
}
