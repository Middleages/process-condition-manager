import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

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
export const EMPTY_CHOICE_OPTIONS: readonly ChoiceOptionOut[] = Object.freeze([])

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
}: {
  summary: ChoiceSetSummaryOut | null
  aggregate: ChoiceOptionAggregate | null
  displayFallback: readonly ChoiceOptionOut[]
  summaryFailed: boolean
  optionsFailed: boolean
}): DerivedChoiceSetOptionsState {
  const trustedSummary = summaryFailed ? null : summary
  const matchingAggregate =
    trustedSummary !== null &&
    aggregate !== null &&
    aggregate.set_code === trustedSummary.code &&
    aggregate.version === trustedSummary.version
  const selectionReady =
    matchingAggregate && !optionsFailed && trustedSummary.is_active
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
      if (!(error instanceof ChoiceSetVersionAdvanced)) throw error
      await onVersionAdvanced?.(error)
      if (transitions >= maximumVersionRestarts) throw error
      transitions += 1
    }
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
  const previousVersionRef = useRef<number | null>(null)
  const preparationRef = useRef<ChoiceSetPreparationState | null>(null)
  const [preparationState, setPreparationState] =
    useState<ChoiceSetPreparationState | null>(null)

  if (displayFallbackRef.current.setCode !== setCode) {
    displayFallbackRef.current = { setCode, options: EMPTY_CHOICE_OPTIONS }
    previousVersionRef.current = null
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
  const derived = deriveChoiceSetOptionsState({
    summary: queryableSummary,
    aggregate: aggregateQuery.data ?? null,
    displayFallback: displayFallbackRef.current.options,
    summaryFailed: summaryQuery.isError || preparing || preparationError !== null,
    optionsFailed,
  })

  useEffect(() => {
    const previousVersion = previousVersionRef.current
    const currentVersion = queryableSummary?.version ?? null
    previousVersionRef.current = currentVersion
    if (
      previousVersion === null ||
      currentVersion === null ||
      previousVersion === currentVersion
    ) {
      return
    }

    void (async () => {
      await removeSupersededChoiceOptionQueries(
        queryClient,
        setCode,
        currentVersion,
        includeInactive,
      )
      try {
        await queryClient.fetchQuery(
          choiceOptionQueryOptions(queryClient, setCode, currentVersion, includeInactive),
        )
      } catch {
        // The active query owns its ordinary retry/error state. Typed transitions prime the next
        // version and invalidate summary inside the shared factory; consuming this promise avoids
        // an unhandled rejection while keeping old rows display-only.
      }
    })()
  }, [includeInactive, queryClient, queryableSummary?.version, setCode])

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
    const result = await summaryQuery.refetch({ throwOnError: true })
    if (result.data === undefined) {
      throw result.error ?? new Error(`Choice set ${setCode} summary returned no data`)
    }
    return result.data
  }, [setCode, summaryQuery])

  const prepareToOpen = useCallback(async (): Promise<void> => {
    const generation = beginPreparation()
    let nextError: string | null = null
    try {
      await loadChoiceSetOptionsForOpen({
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
  const error =
    preparationError ??
    (summaryQuery.isError ? getApiErrorMessage(summaryQuery.error) : null) ??
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
