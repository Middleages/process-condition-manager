import type { QueryClient } from '@tanstack/react-query'

import { historyProjectDetailQueryKey, historyProjectQueryKey } from './historyQuery'

/**
 * Establishes a cache fence after a mutation that can change history detail jump targets.
 * Every operation starts synchronously, in order, before either async operation is awaited.
 */
export function invalidateProjectHistoryAfterMutation(
  queryClient: QueryClient,
  projectId: number,
): Promise<void> {
  const projectQueryKey = historyProjectQueryKey(projectId)
  const cancellation = queryClient.cancelQueries({ queryKey: projectQueryKey })
  queryClient.removeQueries({ queryKey: historyProjectDetailQueryKey(projectId) })
  const invalidation = queryClient.invalidateQueries({
    queryKey: projectQueryKey,
    refetchType: 'active',
  })

  return Promise.all([cancellation, invalidation]).then(() => undefined)
}
