import { useCallback, useEffect, useRef } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'
import type { BlockerFunction, Location } from 'react-router-dom'

import { shouldBlockNavigation } from './routeState'

export interface UseUnsavedChangesOptions {
  when: boolean
  message: string
  allowPath?: string
}

export function useUnsavedChanges({ when, message, allowPath }: UseUnsavedChangesOptions) {
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      shouldBlockNavigation(
        when,
        locationUrl(currentLocation),
        locationUrl(nextLocation),
        allowPath,
      ),
    [allowPath, when],
  )
  const blocker = useBlocker(shouldBlock)
  const handledBlockRef = useRef<string | null>(null)

  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (!when) return

        event.preventDefault()
        event.returnValue = true
      },
      [when],
    ),
  )

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      handledBlockRef.current = null
      return
    }

    if (handledBlockRef.current === blocker.location.key) return
    handledBlockRef.current = blocker.location.key

    if (window.confirm(message)) {
      blocker.proceed()
    } else {
      blocker.reset()
    }
  }, [blocker, message])
}

function locationUrl(location: Location): string {
  return `${location.pathname}${location.search}${location.hash}`
}
