import { queryOptions, type QueryClient } from '@tanstack/react-query'

import { fetchAllChoiceOptions, getChoiceSet } from '../../api/choiceSets'

const choiceSetListPrefix = ['choice-sets', 'list'] as const

export const choiceSetKeys = {
  all: ['choice-sets'] as const,
  list: (includeInactive: boolean) => ['choice-sets', 'list', includeInactive] as const,
  summary: (code: string) => ['choice-sets', 'summary', code] as const,
  optionsPrefix: (code: string) => ['choice-sets', 'options', code] as const,
  options: (code: string, version: number, includeInactive: boolean) =>
    ['choice-sets', 'options', code, version, includeInactive] as const,
}

export class ChoiceSetVersionAdvanced extends Error {
  readonly setCode: string
  readonly requestedVersion: number
  readonly responseVersion: number

  constructor(setCode: string, requestedVersion: number, responseVersion: number) {
    super(
      `Choice set ${setCode} advanced from version ${requestedVersion} to ${responseVersion}`,
    )
    this.name = 'ChoiceSetVersionAdvanced'
    this.setCode = setCode
    this.requestedVersion = requestedVersion
    this.responseVersion = responseVersion
  }
}

export function summaryQueryOptions(code: string) {
  return queryOptions({
    queryKey: choiceSetKeys.summary(code),
    queryFn: () => getChoiceSet(code),
    refetchOnWindowFocus: 'always',
  })
}

export function sheetSummaryQueryOptions(code: string) {
  return queryOptions({
    ...summaryQueryOptions(code),
    refetchInterval: 60_000,
  })
}

export function choiceOptionQueryOptions(
  queryClient: QueryClient,
  code: string,
  summaryVersion: number,
  includeInactive: boolean,
) {
  return queryOptions({
    queryKey: choiceSetKeys.options(code, summaryVersion, includeInactive),
    // `(set, version, includeInactive)` is immutable. Summary refresh creates a new version key.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const aggregate = await fetchAllChoiceOptions(
        code,
        summaryVersion,
        includeInactive,
        signal,
      )
      if (signal.aborted) signal.throwIfAborted()
      if (aggregate.version === summaryVersion) return aggregate

      queryClient.setQueryData(
        choiceSetKeys.options(code, aggregate.version, includeInactive),
        aggregate,
      )
      await queryClient.invalidateQueries({
        queryKey: choiceSetKeys.summary(code),
        exact: true,
      })
      throw new ChoiceSetVersionAdvanced(code, summaryVersion, aggregate.version)
    },
    retry: (failureCount, error) =>
      !(error instanceof ChoiceSetVersionAdvanced) &&
      shouldRetryUsingClientPolicy(queryClient, failureCount, error),
  })
}

export async function invalidateChoiceSetMutation(
  queryClient: QueryClient,
  code: string,
): Promise<void> {
  const optionsPrefix = choiceSetKeys.optionsPrefix(code)
  await queryClient.cancelQueries({ queryKey: optionsPrefix })
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: choiceSetListPrefix }),
    queryClient.invalidateQueries({ queryKey: choiceSetKeys.summary(code), exact: true }),
  ])
  queryClient.removeQueries({ queryKey: optionsPrefix })
}

function shouldRetryUsingClientPolicy(
  queryClient: QueryClient,
  failureCount: number,
  error: Error,
): boolean {
  const retry = queryClient.getDefaultOptions().queries?.retry
  if (typeof retry === 'function') return retry(failureCount, error)
  if (retry === true) return true
  if (retry === false) return false
  return failureCount < (retry ?? 3)
}
