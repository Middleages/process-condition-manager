import { useCallback, useEffect, useRef } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'
import type { BlockerFunction, Location } from 'react-router-dom'

import { shouldBlockNavigation } from './routeState'

export interface UseUnsavedChangesOptions {
  when: boolean
  message: string
  allowPath?: string
  freezeWhen?: boolean
}

export type UnsavedNavigationAction = 'allow' | 'confirm' | 'reset'

export function getUnsavedNavigationAction({
  when,
  freezeWhen = false,
}: Pick<UseUnsavedChangesOptions, 'when' | 'freezeWhen'>): UnsavedNavigationAction {
  if (freezeWhen) return 'reset'
  return when ? 'confirm' : 'allow'
}

export function useUnsavedChanges({
  when,
  message,
  allowPath,
  freezeWhen = false,
}: UseUnsavedChangesOptions) {
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      shouldBlockNavigation(
        when || freezeWhen,
        locationUrl(currentLocation),
        locationUrl(nextLocation),
        allowPath,
      ),
    [allowPath, freezeWhen, when],
  )
  const blocker = useBlocker(shouldBlock)
  const handledBlockRef = useRef<string | null>(null)

  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (!when && !freezeWhen) return

        event.preventDefault()
        event.returnValue = true
      },
      [freezeWhen, when],
    ),
  )

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      handledBlockRef.current = null
      return
    }

    if (handledBlockRef.current === blocker.location.key) return
    handledBlockRef.current = blocker.location.key

    const action = getUnsavedNavigationAction({ when, freezeWhen })
    if (action === 'reset') {
      blocker.reset()
    } else if (action === 'confirm' && window.confirm(message)) {
      blocker.proceed()
    } else {
      blocker.reset()
    }
  }, [blocker, freezeWhen, message, when])
}

function locationUrl(location: Location): string {
  return `${location.pathname}${location.search}${location.hash}`
}
