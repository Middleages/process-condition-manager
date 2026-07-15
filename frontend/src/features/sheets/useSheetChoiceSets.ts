import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'

import { getApiErrorMessage } from '@/api/client'
import type {
  ChoiceOptionAggregate,
  ChoiceSetSummaryOut,
  SheetColumnOut,
} from '@/api/types'
import type { SheetChoiceResource } from '@/grid/types'
import { useIsomorphicLayoutEffect } from '@/shared/lib/useIsomorphicLayoutEffect'
import {
  claimLiveChoiceResourcePreparation,
  createLiveChoiceResource,
  getLiveChoiceResourceSnapshot,
  stageLiveChoiceResource,
} from '@/grid/choiceCell'
import {
  ChoiceSetVersionAdvanced,
  choiceOptionQueryOptions,
  sheetSummaryQueryOptions,
} from '@/features/choiceSets/choiceQueries'
import {
  loadChoiceSetOptionsForOpen,
  removeSupersededChoiceOptionQueries,
} from '@/features/choiceSets/useChoiceSetOptions'

import { assertSheetColumnBindings, SheetAdapterError } from './sheetAdapter'

export interface SheetChoiceResourcePlan {
  setCode: string
  version: number
}

/** 첫 aggregate query는 캐시된 summary와 무관하게 Sheet가 고정한 version에서 시작한다. */
export function bootstrapSheetChoiceTargets(
  plans: readonly SheetChoiceResourcePlan[],
): ReadonlyMap<string, number> {
  return new Map(plans.map((plan) => [plan.setCode, plan.version] as const))
}

/** 현재 target의 첫 aggregate 시도가 끝난 뒤에만 더 새로운 summary로 전진한다. */
export function advanceSheetChoiceTarget(
  plan: SheetChoiceResourcePlan,
  currentTarget: number,
  summaryVersion: number | null,
  currentAggregateSettled: boolean,
): number {
  const sheetFloor = Math.max(plan.version, currentTarget)
  return currentAggregateSettled
    ? sheetChoiceTargetVersion(sheetFloor, summaryVersion)
    : sheetFloor
}

export function sheetChoiceTargetVersion(
  columnVersion: number,
  summaryVersion: number | null,
): number {
  return Math.max(columnVersion, summaryVersion ?? columnVersion)
}

export function buildSheetChoiceResources(
  columns: readonly SheetColumnOut[],
): SheetChoiceResourcePlan[] {
  assertSheetColumnBindings(columns)
  const bySet = new Map<string, number>()
  for (const column of columns) {
    if (column.value_type !== 'choice') continue
    const setCode = column.choice_set_code!
    const version = column.choice_set_version!
    const existing = bySet.get(setCode)
    if (existing !== undefined && existing !== version) {
      throw new SheetAdapterError(
        'conflicting_choice_versions',
        `Choice set ${setCode} has conflicting Sheet versions`,
      )
    }
    bySet.set(setCode, version)
  }
  return [...bySet.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([setCode, version]) => ({ setCode, version }))
}

interface DeriveSheetChoiceResourceInput {
  setCode: string
  columnVersion: number
  summary: ChoiceSetSummaryOut | null
  targetAggregate: ChoiceOptionAggregate | null
  displayFallback: ChoiceOptionAggregate | null
  summaryFailed: boolean
  aggregateFailed: boolean
  loading: boolean
  error?: string | null
  prepareToOpen?: () => Promise<void>
  retry?: () => Promise<void>
}

export function deriveSheetChoiceResource({
  setCode,
  columnVersion,
  summary,
  targetAggregate,
  displayFallback,
  summaryFailed,
  aggregateFailed,
  loading,
  error = null,
  prepareToOpen = async () => undefined,
  retry = async () => undefined,
}: DeriveSheetChoiceResourceInput): SheetChoiceResource {
  const trustedSummary = summaryFailed ? null : summary
  const summaryVersion = trustedSummary?.version ?? null
  const targetVersion = sheetChoiceTargetVersion(columnVersion, summaryVersion)
  const aggregateMatchesTarget =
    targetAggregate?.set_code === setCode && targetAggregate.version === targetVersion
  const summaryMatchesTarget =
    trustedSummary?.code === setCode && trustedSummary.version === targetVersion
  const selectionReady =
    !aggregateFailed &&
    aggregateMatchesTarget &&
    summaryMatchesTarget &&
    trustedSummary.is_active
  const displayAggregate = aggregateMatchesTarget
    ? targetAggregate
    : targetAggregate?.set_code === setCode
      ? targetAggregate
      : displayFallback?.set_code === setCode
        ? displayFallback
        : null

  return {
    setCode,
    targetVersion,
    summaryVersion,
    setIsActive: trustedSummary?.is_active ?? null,
    displayAggregate,
    selectableAggregate: selectionReady ? targetAggregate : null,
    selectionReady,
    isStale: !summaryMatchesTarget || !aggregateMatchesTarget || summaryFailed || aggregateFailed,
    loading,
    error,
    prepareToOpen,
    retry,
  }
}

export async function loadSheetChoiceResourceForOpen({
  setCode,
  columnVersion,
  refetchSummary,
  fetchAggregate,
  onVersionAdvanced,
}: {
  setCode: string
  columnVersion: number
  refetchSummary: () => Promise<ChoiceSetSummaryOut>
  fetchAggregate: (version: number) => Promise<ChoiceOptionAggregate>
  onVersionAdvanced?: (error: ChoiceSetVersionAdvanced) => Promise<void> | void
}): Promise<{ summary: ChoiceSetSummaryOut; aggregate: ChoiceOptionAggregate }> {
  return loadChoiceSetOptionsForOpen({
    refetchSummary: async () => {
      const summary = await refetchSummary()
      if (summary.code !== setCode || summary.version < columnVersion) {
        throw new Error(`Choice set ${setCode} summary is stale`)
      }
      return summary
    },
    fetchAggregate: (summary) => fetchAggregate(summary.version),
    onVersionAdvanced,
  })
}

/**
 * Publishes the exact result of the awaited open authorization to the stable resource captured
 * by Glide. TanStack observers still own the cache; this bridge only closes the render gap until
 * the grid observes the new query key.
 */
export async function prepareLiveSheetChoiceResourceForOpen({
  resource,
  setCode,
  columnVersion,
  refetchSummary,
  fetchAggregate,
  onVersionAdvanced,
  onPreparedVersion,
}: {
  resource: SheetChoiceResource
  setCode: string
  columnVersion: number
  refetchSummary: () => Promise<ChoiceSetSummaryOut>
  fetchAggregate: (version: number) => Promise<ChoiceOptionAggregate>
  onVersionAdvanced?: (error: ChoiceSetVersionAdvanced) => Promise<void> | void
  onPreparedVersion?: (version: number) => void
}): Promise<void> {
  const publishPrepared = claimLiveChoiceResourcePreparation(resource)
  const { summary, aggregate } = await loadSheetChoiceResourceForOpen({
    setCode,
    columnVersion,
    refetchSummary,
    fetchAggregate,
    onVersionAdvanced,
  })
  onPreparedVersion?.(summary.version)

  const current = getLiveChoiceResourceSnapshot(resource)
  publishPrepared(
    deriveSheetChoiceResource({
      setCode,
      columnVersion: Math.max(columnVersion, summary.version),
      summary,
      targetAggregate: aggregate,
      displayFallback: current.displayAggregate,
      summaryFailed: false,
      aggregateFailed: false,
      loading: false,
      error: null,
      prepareToOpen: current.prepareToOpen,
      retry: current.retry,
    }),
  )
}

/**
 * Sheet 전체의 distinct ChoiceSet을 정확히 두 query 배열(summary/aggregate)로 관리한다.
 * 셀은 option 배열을 복제하지 않고 이 Map의 resource 참조를 공유한다.
 */
export function useSheetChoiceSets(
  columns: readonly SheetColumnOut[],
): ReadonlyMap<string, SheetChoiceResource> {
  const queryClient = useQueryClient()
  const plans = useMemo(() => buildSheetChoiceResources(columns), [columns])
  const includeInactive = true
  const [trackedTargets, setTrackedTargets] = useState<ReadonlyMap<string, number>>(() =>
    bootstrapSheetChoiceTargets(plans),
  )
  const [, setCommittedResourceRevision] = useState(0)
  const liveResourcesRef = useRef(new Map<string, SheetChoiceResource>())

  const summaryQueries = useQueries({
    queries: plans.map((plan) => sheetSummaryQueryOptions(plan.setCode)),
  })

  const targets = useMemo(
    () => plans.map((plan) => Math.max(plan.version, trackedTargets.get(plan.setCode) ?? 0)),
    [plans, trackedTargets],
  )

  const aggregateQueries = useQueries({
    queries: plans.map((plan, index) => ({
      ...choiceOptionQueryOptions(
        queryClient,
        plan.setCode,
        targets[index] ?? plan.version,
        includeInactive,
      ),
      enabled: true,
    })),
  })

  useEffect(() => {
    setTrackedTargets((current) => {
      const activeCodes = new Set(plans.map((plan) => plan.setCode))
      let next: Map<string, number> | null =
        current.size === activeCodes.size && [...current.keys()].every((code) => activeCodes.has(code))
          ? null
          : new Map([...current].filter(([code]) => activeCodes.has(code)))

      for (let index = 0; index < plans.length; index += 1) {
        const plan = plans[index]
        const summaryQuery = summaryQueries[index]
        const aggregateQuery = aggregateQueries[index]
        if (plan === undefined) continue
        const currentTarget = current.get(plan.setCode) ?? plan.version
        const summaryVersion = summaryQuery?.isError
          ? null
          : (summaryQuery?.data?.version ?? null)
        const target = advanceSheetChoiceTarget(
          plan,
          currentTarget,
          summaryVersion,
          aggregateQuery?.isFetched ?? false,
        )
        if (target !== currentTarget || !current.has(plan.setCode)) {
          next ??= new Map(current)
          next.set(plan.setCode, target)
        }
      }
      return next ?? current
    })
  }, [aggregateQueries, plans, summaryQueries])

  const displayFallbacksRef = useRef(new Map<string, ChoiceOptionAggregate>())

  // 더 새로운 summary가 알려지면 완성된 display fallback만 ref에 남기고 이전 query를 제거한다.
  useEffect(() => {
    void Promise.all(
      plans.map((plan, index) =>
        removeSupersededChoiceOptionQueries(
          queryClient,
          plan.setCode,
          targets[index] ?? plan.version,
          includeInactive,
        ),
      ),
    )
  }, [includeInactive, plans, queryClient, targets])

  const resources = new Map<string, SheetChoiceResource>()
  const resourceCommits: Array<() => boolean> = []
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index]
    const summaryQuery = summaryQueries[index]
    const aggregateQuery = aggregateQueries[index]
    if (plan === undefined || summaryQuery === undefined || aggregateQuery === undefined) continue

    const summary = summaryQuery.isError ? null : (summaryQuery.data ?? null)
    const aggregate = aggregateQuery.data ?? null
    if (aggregate !== null && aggregate.set_code === plan.setCode) {
      displayFallbacksRef.current.set(plan.setCode, aggregate)
    }

    const refetchFreshSummary = async (): Promise<ChoiceSetSummaryOut> => {
      const result = await summaryQuery.refetch({ throwOnError: true })
      if (result.data === undefined) {
        throw result.error ?? new Error(`Choice set ${plan.setCode} summary returned no data`)
      }
      return result.data
    }

    let liveResource = liveResourcesRef.current.get(plan.setCode)
    const prepareToOpen = async (): Promise<void> => {
      if (liveResource === undefined) return
      await prepareLiveSheetChoiceResourceForOpen({
        resource: liveResource,
        setCode: plan.setCode,
        columnVersion: targets[index] ?? plan.version,
        refetchSummary: refetchFreshSummary,
        fetchAggregate: async (version) => {
          await removeSupersededChoiceOptionQueries(
            queryClient,
            plan.setCode,
            version,
            includeInactive,
          )
          return queryClient.fetchQuery(
            choiceOptionQueryOptions(
              queryClient,
              plan.setCode,
              version,
              includeInactive,
            ),
          )
        },
        onVersionAdvanced: (transition) =>
          removeSupersededChoiceOptionQueries(
            queryClient,
            plan.setCode,
            transition.responseVersion,
            includeInactive,
          ),
        onPreparedVersion: (version) =>
          setTrackedTargets((current) => {
            const currentVersion = current.get(plan.setCode) ?? plan.version
            if (version <= currentVersion) return current
            const next = new Map(current)
            next.set(plan.setCode, version)
            return next
          }),
      })
    }

    const typedTransition = aggregateQuery.error instanceof ChoiceSetVersionAdvanced
    const error = summaryQuery.isError
      ? getApiErrorMessage(summaryQuery.error)
      : aggregateQuery.isError && !typedTransition
        ? getApiErrorMessage(aggregateQuery.error)
        : null
    const snapshot = deriveSheetChoiceResource({
      setCode: plan.setCode,
      columnVersion: targets[index] ?? plan.version,
      summary,
      targetAggregate: aggregate,
      displayFallback: displayFallbacksRef.current.get(plan.setCode) ?? null,
      summaryFailed: summaryQuery.isError,
      aggregateFailed: aggregateQuery.isError,
      loading: summaryQuery.isPending || aggregateQuery.isPending,
      error,
      prepareToOpen,
      retry: prepareToOpen,
    })
    if (liveResource === undefined) {
      liveResource = createLiveChoiceResource(snapshot)
    } else {
      resourceCommits.push(stageLiveChoiceResource(liveResource, snapshot))
    }
    resources.set(plan.setCode, liveResource)
  }

  useIsomorphicLayoutEffect(() => {
    // Only a committed render installs handles or promotes its exact captured snapshots.
    liveResourcesRef.current = new Map(resources)
    let changed = false
    for (const commit of resourceCommits) {
      if (commit()) changed = true
    }
    // Make parent-derived paste authorization and canvas payloads observe the committed snapshot
    // before paint; no render-time external store mutation can leak from abandoned work.
    if (changed) setCommittedResourceRevision((revision) => revision + 1)
  }, [resources])

  return resources
}
