import type { QueryClient } from '@tanstack/react-query'

import { backboneDiffProjectQueryKey } from './backboneDiffQuery'

/**
 * Establishes a cache fence after Backbone mutations that can change diff state.
 */
export function invalidateProjectBackboneDiffAfterMutation(
  queryClient: QueryClient,
  projectId: number,
): Promise<void> {
  const projectQueryKey = backboneDiffProjectQueryKey(projectId)
  const branchQueryPrefix: readonly unknown[] = [...projectQueryKey, 'branch']
  const cellQueryPrefix: readonly unknown[] = [...projectQueryKey, 'cell']

  const cancellation = queryClient.cancelQueries({ queryKey: projectQueryKey })

  queryClient.removeQueries({ queryKey: branchQueryPrefix, exact: false })
  queryClient.removeQueries({ queryKey: cellQueryPrefix, exact: false })
  const invalidation = queryClient.invalidateQueries({
    queryKey: projectQueryKey,
    refetchType: 'active',
  })

  return Promise.all([cancellation, invalidation]).then(() => undefined)
}
