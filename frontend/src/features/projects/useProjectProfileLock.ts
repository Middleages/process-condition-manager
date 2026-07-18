import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { invalidateProjectHistoryAfterMutation } from '@/api/historyCache'
import { acquireLock, heartbeatLock, releaseLock, releaseLockOnUnload } from '@/api/locks'
import { getProjectProfile, patchProjectProfile } from '@/api/projects'
import type { ProjectOut, ProjectProfilePatchIn } from '@/api/types'

import type { ProfileFormState } from './profileForm'
import {
  createProjectProfileUnloadEventHandlers,
  createProjectProfileLockController,
  createUnloadReleaseOnce,
  type ProjectProfileLockController,
  type ProjectProfileLockState,
} from './profileLockState'

export interface ProjectProfileLockSession {
  state: ProjectProfileLockState
  updateDraft(draft: ProfileFormState): void
  save(payload: ProjectProfilePatchIn): Promise<void>
  close(): Promise<void>
  retryLoad(): Promise<void>
  reacquire(): Promise<void>
}

const CLOSED_STATE: ProjectProfileLockState = {
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

/** Wires the pure fenced controller to Profile APIs, React Query, and browser unload events. */
export function useProjectProfileLock(projectId: number): ProjectProfileLockSession {
  const queryClient = useQueryClient()
  const controllerRef = useRef<ProjectProfileLockController | null>(null)
  const [state, setState] = useState<ProjectProfileLockState>(CLOSED_STATE)

  useEffect(() => {
    let active = true
    const unloadOnce = createUnloadReleaseOnce((token) => {
      releaseLockOnUnload(projectId, token)
    })
    const controller = createProjectProfileLockController(
      projectId,
      {
        acquire: acquireLock,
        heartbeat: heartbeatLock,
        getProfile: getProjectProfile,
        patchProfile: patchProjectProfile,
        release: releaseLock,
        invalidate: async (id, profile) => {
          queryClient.setQueryData(['project-profile', id], profile)
          queryClient.setQueryData<ProjectOut>(['project', id], (current) =>
            current ? { ...current, profile } : current,
          )
          await Promise.all([
            invalidateProjectHistoryAfterMutation(queryClient, id),
            queryClient.invalidateQueries({ queryKey: ['project', id], exact: true }),
            queryClient.invalidateQueries({
              queryKey: ['project-profile', id],
              exact: true,
            }),
            queryClient.invalidateQueries({ queryKey: ['projects'] }),
          ])
        },
      },
      unloadOnce,
    )
    controllerRef.current = controller
    setState(controller.getState())
    const unsubscribe = controller.subscribe(() => {
      if (active) setState(controller.getState())
    })
    const releaseForUnload = (): void => controller.releaseOnUnload()
    const unloadHandlers = createProjectProfileUnloadEventHandlers(releaseForUnload)
    window.addEventListener('pagehide', unloadHandlers.pagehide)
    window.addEventListener('beforeunload', unloadHandlers.beforeunload)

    // StrictMode mounts effects twice in development. Deferring the first acquire lets its cleanup
    // cancel the discarded effect before any lock request is sent.
    queueMicrotask(() => {
      if (active) void controller.open()
    })

    return () => {
      active = false
      window.removeEventListener('pagehide', unloadHandlers.pagehide)
      window.removeEventListener('beforeunload', unloadHandlers.beforeunload)
      unsubscribe()
      if (controllerRef.current === controller) controllerRef.current = null
      controller.dispose()
    }
  }, [projectId, queryClient])

  const updateDraft = useCallback((draft: ProfileFormState) => {
    controllerRef.current?.updateDraft(draft)
  }, [])
  const save = useCallback((payload: ProjectProfilePatchIn) => {
    return controllerRef.current?.save(payload) ?? Promise.resolve()
  }, [])
  const close = useCallback(() => {
    return controllerRef.current?.close() ?? Promise.resolve()
  }, [])
  const retryLoad = useCallback(() => {
    return controllerRef.current?.retryLoad() ?? Promise.resolve()
  }, [])
  const reacquire = useCallback(() => {
    return controllerRef.current?.reacquire() ?? Promise.resolve()
  }, [])

  return { state, updateDraft, save, close, retryLoad, reacquire }
}
