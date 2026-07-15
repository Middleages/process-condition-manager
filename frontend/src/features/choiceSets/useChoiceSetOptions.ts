import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isCancelledError,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import { getApiErrorMessage } from '../../api/client'
import type {
  ChoiceOptionAggregate,
  ChoiceOptionOut,
  ChoiceSetSummaryOut,
} from '../../api/types'
import {
  ChoiceSetVersionAdvanced,
  choiceOptionQueryOptions,
  choiceSetKeys,
  sheetSummaryQueryOptions,
  summaryQueryOptions,
} from './choiceQueries'

const OPEN_VERSION_RESTARTS = 2
const CHOICE_SET_REFRESH_RETRY_ERROR =
  '선택지를 최신 상태로 확인하지 못했습니다. 다시 시도해 주세요.'
export const EMPTY_CHOICE_OPTIONS: readonly ChoiceOptionOut[] = Object.freeze([])

class ChoiceSetAuthorizationObsolete extends Error {}

export interface ChoiceSetOptionsResource {
  setCode: string
  version: number | null
  setIsActive: boolean | null
  displayOptions: readonly ChoiceOptionOut[]
  selectableOptions: readonly ChoiceOptionOut[]
  selectionReady: boolean
  loading: boolean
  refreshing: boolean
  error: string | null
  prepareToOpen: () => Promise<void>
  refetchSummary: () => Promise<void>
  retryOptions: () => Promise<void>
}

export interface UseChoiceSetOptionsSettings {
  includeInactive: boolean
  sheetFocused: boolean
}

export interface DerivedChoiceSetOptionsState {
  version: number | null
  setIsActive: boolean | null
  displayOptions: readonly ChoiceOptionOut[]
  selectableOptions: readonly ChoiceOptionOut[]
  selectionReady: boolean
}

export interface ChoiceSetPreparationState {
  setCode: string
  generation: number
  preparing: boolean
  error: string | null
}

export interface ChoiceSetAuthorizationEpoch {
  setCode: string
  version: number
  includeInactive: boolean
}

interface ChoiceSetAuthorizationFailure extends ChoiceSetAuthorizationEpoch {
  error: string
}

export function isChoiceSetAuthorizationSettled(
  epoch: ChoiceSetAuthorizationEpoch | null,
  setCode: string,
  version: number,
  includeInactive: boolean,
): boolean {
  return (
    epoch !== null &&
    epoch.setCode === setCode &&
    epoch.version === version &&
    epoch.includeInactive === includeInactive
  )
}

export function getPreparedChoiceSetAuthorizationEpoch({
  currentPreparation,
  currentTarget,
  setCode,
  generation,
  includeInactive,
  cachedSummary,
  loadedSummary,
  aggregate,
}: {
  currentPreparation: ChoiceSetPreparationState | null
  currentTarget: { setCode: string; includeInactive: boolean }
  setCode: string
  generation: number
  includeInactive: boolean
  cachedSummary: ChoiceSetSummaryOut | null
  loadedSummary: ChoiceSetSummaryOut
  aggregate: ChoiceOptionAggregate
}): ChoiceSetAuthorizationEpoch | null {
  if (
    currentPreparation === null ||
    !currentPreparation.preparing ||
    currentPreparation.setCode !== setCode ||
    currentPreparation.generation !== generation ||
    currentTarget.setCode !== setCode ||
    currentTarget.includeInactive !== includeInactive ||
    loadedSummary.code !== setCode ||
    cachedSummary?.code !== setCode ||
    cachedSummary.version !== loadedSummary.version ||
    aggregate.set_code !== setCode ||
    aggregate.version !== loadedSummary.version
  ) {
    return null
  }

  return { setCode, version: loadedSummary.version, includeInactive }
}

export function beginChoiceSetPreparation(
  current: ChoiceSetPreparationState | null,
  setCode: string,
): ChoiceSetPreparationState {
  return {
    setCode,
    generation: current?.setCode === setCode ? current.generation + 1 : 1,
    preparing: true,
    error: null,
  }
}

export function settleChoiceSetPreparation(
  current: ChoiceSetPreparationState | null,
  setCode: string,
  generation: number,
  error: string | null,
): ChoiceSetPreparationState | null {
  if (
    current === null ||
    current.setCode !== setCode ||
    current.generation !== generation
  ) {
    return current
  }
  return { ...current, preparing: false, error }
}

export function choiceSetOptionsPolicy(sheetFocused: boolean): {
  refetchSummaryOnOpen: true
  summaryRefetchInterval: false | 60_000
} {
  return {
    refetchSummaryOnOpen: true,
    summaryRefetchInterval: sheetFocused ? 60_000 : false,
  }
}

export function deriveChoiceSetOptionsState({
  summary,
  aggregate,
  displayFallback,
  summaryFailed,
  optionsFailed,
  authorizationSettled,
}: {
  summary: ChoiceSetSummaryOut | null
  aggregate: ChoiceOptionAggregate | null
  displayFallback: readonly ChoiceOptionOut[]
  summaryFailed: boolean
  optionsFailed: boolean
  authorizationSettled: boolean
}): DerivedChoiceSetOptionsState {
  const trustedSummary = summaryFailed ? null : summary
  const matchingAggregate =
    trustedSummary !== null &&
    aggregate !== null &&
    aggregate.set_code === trustedSummary.code &&
    aggregate.version === trustedSummary.version
  const selectionReady =
    matchingAggregate &&
    authorizationSettled &&
    !optionsFailed &&
    trustedSummary.is_active
  const displayOptions = aggregate?.items ?? displayFallback

  return {
    version: trustedSummary?.version ?? null,
    setIsActive: trustedSummary?.is_active ?? null,
    displayOptions,
    selectableOptions: selectionReady ? aggregate.items : EMPTY_CHOICE_OPTIONS,
    selectionReady,
  }
}

export async function loadChoiceSetOptionsForOpen({
  refetchSummary,
  fetchAggregate,
  onVersionAdvanced,
  maximumVersionRestarts = OPEN_VERSION_RESTARTS,
}: {
  refetchSummary: () => Promise<ChoiceSetSummaryOut>
  fetchAggregate: (freshSummary: ChoiceSetSummaryOut) => Promise<ChoiceOptionAggregate>
  onVersionAdvanced?: (error: ChoiceSetVersionAdvanced) => Promise<void> | void
  maximumVersionRestarts?: number
}): Promise<{ summary: ChoiceSetSummaryOut; aggregate: ChoiceOptionAggregate }> {
  let transitions = 0
  while (true) {
    const freshSummary = await refetchSummary()
    try {
      const aggregate = await fetchAggregate(freshSummary)
      if (
        aggregate.set_code !== freshSummary.code ||
        aggregate.version !== freshSummary.version
      ) {
        throw new ChoiceSetVersionAdvanced(
          freshSummary.code,
          freshSummary.version,
          aggregate.version,
        )
      }
      return { summary: freshSummary, aggregate }
    } catch (error) {
      const versionAdvanced = error instanceof ChoiceSetVersionAdvanced
      if (!versionAdvanced && !isCancelledError(error)) throw error
      if (versionAdvanced) await onVersionAdvanced?.(error)
      if (transitions >= maximumVersionRestarts) {
        throw new Error(CHOICE_SET_REFRESH_RETRY_ERROR)
      }
      transitions += 1
    }
  }
}

export async function loadChoiceSetOptionsForAuthorization({
  initialSummary,
  refetchSummary,
  beforeFetch,
  fetchAggregate,
  isCurrent,
  maximumVersionRestarts = OPEN_VERSION_RESTARTS,
}: {
  initialSummary: ChoiceSetSummaryOut
  refetchSummary: () => Promise<ChoiceSetSummaryOut>
  beforeFetch: (freshSummary: ChoiceSetSummaryOut) => Promise<void>
  fetchAggregate: (freshSummary: ChoiceSetSummaryOut) => Promise<ChoiceOptionAggregate>
  isCurrent: () => boolean
  maximumVersionRestarts?: number
}): Promise<{
  summary: ChoiceSetSummaryOut
  aggregate: ChoiceOptionAggregate
} | null> {
  let useInitialSummary = true
  const assertCurrent = (): void => {
    if (!isCurrent()) throw new ChoiceSetAuthorizationObsolete()
  }

  try {
    const result = await loadChoiceSetOptionsForOpen({
      refetchSummary: async () => {
        assertCurrent()
        if (useInitialSummary) {
          useInitialSummary = false
          return initialSummary
        }
        const freshSummary = await refetchSummary()
        assertCurrent()
        return freshSummary
      },
      fetchAggregate: async (freshSummary) => {
        await beforeFetch(freshSummary)
        assertCurrent()
        const aggregate = await fetchAggregate(freshSummary)
        assertCurrent()
        return aggregate
      },
      maximumVersionRestarts,
    })
    assertCurrent()
    return result
  } catch (error) {
    if (error instanceof ChoiceSetAuthorizationObsolete) return null
    throw error
  }
}

/**
 * Cancels in-flight pages before removing superseded versions. A response-version key already
 * primed by `choiceOptionQueryOptions` is retained and can become the next observer target.
 */
export async function removeSupersededChoiceOptionQueries(
  queryClient: QueryClient,
  setCode: string,
  currentVersion: number,
  _includeInactive: boolean,
): Promise<void> {
  const prefix = choiceSetKeys.optionsPrefix(setCode)
  const supersededQueries = {
    queryKey: prefix,
    predicate: (query: { queryKey: readonly unknown[] }) => {
      const version = query.queryKey[3]
      return typeof version === 'number' && version < currentVersion
    },
  }
  await queryClient.cancelQueries(supersededQueries)
  queryClient.removeQueries(supersededQueries)
}

export function useChoiceSetOptions(
  setCode: string,
  { includeInactive, sheetFocused }: UseChoiceSetOptionsSettings,
): ChoiceSetOptionsResource {
  const queryClient = useQueryClient()
  const summaryQuery = useQuery(
    sheetFocused ? sheetSummaryQueryOptions(setCode) : summaryQueryOptions(setCode),
  )
  const refetchSummaryQuery = summaryQuery.refetch
  const queryableSummary = summaryQuery.isError ? null : (summaryQuery.data ?? null)
  const targetVersion = queryableSummary?.version ?? 0
  const aggregateQuery = useQuery({
    ...choiceOptionQueryOptions(queryClient, setCode, targetVersion, includeInactive),
    enabled: queryableSummary !== null,
  })
  const displayFallbackRef = useRef<{
    setCode: string
    options: readonly ChoiceOptionOut[]
  }>({ setCode, options: EMPTY_CHOICE_OPTIONS })
  const authorizationGenerationRef = useRef(0)
  const authorizationTargetRef = useRef({ setCode, includeInactive })
  const preparationRef = useRef<ChoiceSetPreparationState | null>(null)
  const [preparationState, setPreparationState] =
    useState<ChoiceSetPreparationState | null>(null)
  const [authorizedEpoch, setAuthorizedEpoch] =
    useState<ChoiceSetAuthorizationEpoch | null>(null)
  const [authorizationFailure, setAuthorizationFailure] =
    useState<ChoiceSetAuthorizationFailure | null>(null)

  authorizationTargetRef.current = { setCode, includeInactive }

  if (displayFallbackRef.current.setCode !== setCode) {
    displayFallbackRef.current = { setCode, options: EMPTY_CHOICE_OPTIONS }
  }
  if (aggregateQuery.data !== undefined && aggregateQuery.data.set_code === setCode) {
    displayFallbackRef.current = { setCode, options: aggregateQuery.data.items }
  }

  const currentPreparation =
    preparationState?.setCode === setCode ? preparationState : null
  const preparing = currentPreparation?.preparing ?? false
  const preparationError = currentPreparation?.error ?? null

  const typedTransition = aggregateQuery.error instanceof ChoiceSetVersionAdvanced
  const optionsFailed = aggregateQuery.isError
  const authorizationSettled =
    queryableSummary !== null &&
    isChoiceSetAuthorizationSettled(
      authorizedEpoch,
      setCode,
      queryableSummary.version,
      includeInactive,
    )
  const derived = deriveChoiceSetOptionsState({
    summary: queryableSummary,
    aggregate: aggregateQuery.data ?? null,
    displayFallback: displayFallbackRef.current.options,
    summaryFailed: summaryQuery.isError || preparing || preparationError !== null,
    optionsFailed,
    authorizationSettled,
  })

  const beginPreparation = useCallback((): number => {
    const next = beginChoiceSetPreparation(preparationRef.current, setCode)
    preparationRef.current = next
    setPreparationState(next)
    return next.generation
  }, [setCode])

  const settlePreparation = useCallback(
    (generation: number, nextError: string | null): void => {
      preparationRef.current = settleChoiceSetPreparation(
        preparationRef.current,
        setCode,
        generation,
        nextError,
      )
      setPreparationState((current) =>
        settleChoiceSetPreparation(current, setCode, generation, nextError),
      )
    },
    [setCode],
  )

  const refetchFreshSummary = useCallback(async (): Promise<ChoiceSetSummaryOut> => {
    const result = await refetchSummaryQuery({ throwOnError: true })
    if (result.data === undefined) {
      throw result.error ?? new Error(`Choice set ${setCode} summary returned no data`)
    }
    return result.data
  }, [refetchSummaryQuery, setCode])

  useEffect(() => {
    const initialSummary = queryableSummary
    const generation = authorizationGenerationRef.current + 1
    authorizationGenerationRef.current = generation
    if (initialSummary === null) return

    let active = true
    const isCurrent = () =>
      active && authorizationGenerationRef.current === generation

    void (async () => {
      try {
        const result = await loadChoiceSetOptionsForAuthorization({
          initialSummary,
          refetchSummary: refetchFreshSummary,
          beforeFetch: (freshSummary) =>
            removeSupersededChoiceOptionQueries(
              queryClient,
              setCode,
              freshSummary.version,
              includeInactive,
            ),
          fetchAggregate: (freshSummary) =>
            queryClient.fetchQuery(
              choiceOptionQueryOptions(
                queryClient,
                setCode,
                freshSummary.version,
                includeInactive,
              ),
            ),
          isCurrent,
        })
        if (
          result === null ||
          !isCurrent() ||
          result.summary.version !== initialSummary.version
        ) {
          return
        }
        setAuthorizedEpoch({
          setCode,
          version: initialSummary.version,
          includeInactive,
        })
        setAuthorizationFailure(null)
      } catch (error) {
        if (!isCurrent()) return
        setAuthorizationFailure({
          setCode,
          version: initialSummary.version,
          includeInactive,
          error: getApiErrorMessage(error),
        })
      }
    })()

    return () => {
      active = false
    }
  }, [includeInactive, queryClient, queryableSummary, refetchFreshSummary, setCode])

  const prepareToOpen = useCallback(async (): Promise<void> => {
    const generation = beginPreparation()
    let nextError: string | null = null
    try {
      const result = await loadChoiceSetOptionsForOpen({
        refetchSummary: refetchFreshSummary,
        fetchAggregate: async (freshSummary) => {
          await removeSupersededChoiceOptionQueries(
            queryClient,
            setCode,
            freshSummary.version,
            includeInactive,
          )
          return queryClient.fetchQuery(
            choiceOptionQueryOptions(
              queryClient,
              setCode,
              freshSummary.version,
              includeInactive,
            ),
          )
        },
        onVersionAdvanced: (transition) =>
          removeSupersededChoiceOptionQueries(
            queryClient,
            setCode,
            transition.responseVersion,
            includeInactive,
          ),
      })
      const epoch = getPreparedChoiceSetAuthorizationEpoch({
        currentPreparation: preparationRef.current,
        currentTarget: authorizationTargetRef.current,
        setCode,
        generation,
        includeInactive,
        cachedSummary:
          queryClient.getQueryData<ChoiceSetSummaryOut>(
            choiceSetKeys.summary(setCode),
          ) ?? null,
        loadedSummary: result.summary,
        aggregate: result.aggregate,
      })
      if (epoch !== null) {
        authorizationGenerationRef.current += 1
        setAuthorizedEpoch(epoch)
        setAuthorizationFailure(null)
      }
    } catch (error) {
      nextError = getApiErrorMessage(error)
      throw error
    } finally {
      settlePreparation(generation, nextError)
    }
  }, [
    beginPreparation,
    includeInactive,
    queryClient,
    refetchFreshSummary,
    setCode,
    settlePreparation,
  ])

  const refetchSummary = useCallback(async (): Promise<void> => {
    const generation = beginPreparation()
    let nextError: string | null = null
    try {
      await refetchFreshSummary()
    } catch (error) {
      nextError = getApiErrorMessage(error)
      throw error
    } finally {
      settlePreparation(generation, nextError)
    }
  }, [beginPreparation, refetchFreshSummary, settlePreparation])

  const retryOptions = useCallback(async (): Promise<void> => {
    await prepareToOpen()
  }, [prepareToOpen])

  const ordinaryOptionsError =
    aggregateQuery.isError && !typedTransition ? getApiErrorMessage(aggregateQuery.error) : null
  const backgroundAuthorizationError =
    queryableSummary !== null &&
    authorizationFailure?.setCode === setCode &&
    authorizationFailure.version === queryableSummary.version &&
    authorizationFailure.includeInactive === includeInactive
      ? authorizationFailure.error
      : null
  const error =
    preparationError ??
    (summaryQuery.isError ? getApiErrorMessage(summaryQuery.error) : null) ??
    backgroundAuthorizationError ??
    ordinaryOptionsError

  return {
    setCode,
    version: derived.version,
    setIsActive: derived.setIsActive,
    displayOptions: derived.displayOptions,
    selectableOptions: derived.selectableOptions,
    selectionReady: derived.selectionReady,
    loading:
      summaryQuery.isPending ||
      (queryableSummary !== null && aggregateQuery.isPending),
    refreshing: preparing || summaryQuery.isFetching || aggregateQuery.isFetching,
    error,
    prepareToOpen,
    refetchSummary,
    retryOptions,
  }
}
