import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import type {
  ChoiceOptionAggregate,
  ChoiceOptionOut,
  ChoiceSetSummaryOut,
} from '../../api/types'
import { ChoiceSetVersionAdvanced, choiceSetKeys } from './choiceQueries'
import {
  beginChoiceSetPreparation,
  choiceSetOptionsPolicy,
  deriveChoiceSetOptionsState,
  loadChoiceSetOptionsForOpen,
  removeSupersededChoiceOptionQueries,
  settleChoiceSetPreparation,
} from './useChoiceSetOptions'

function summary(version: number, isActive = true): ChoiceSetSummaryOut {
  return {
    code: 'equipment_mode',
    display_name: 'Equipment mode',
    description: null,
    is_active: isActive,
    version,
    option_count: 1,
    active_option_count: 1,
    parameter_usage_count: 0,
    profile_usage_fields: [],
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  }
}

const activeOption: ChoiceOptionOut = {
  code: 'FOUNDRY',
  label: 'Foundry',
  sort_order: 10,
  is_active: true,
}

function aggregate(version: number): ChoiceOptionAggregate {
  return { set_code: 'equipment_mode', version, items: [activeOption] }
}

describe('choice-set option resource', () => {
  it('requires an open summary refresh and polls only focused sheet consumers', () => {
    expect(choiceSetOptionsPolicy(false)).toEqual({
      refetchSummaryOnOpen: true,
      summaryRefetchInterval: false,
    })
    expect(choiceSetOptionsPolicy(true)).toEqual({
      refetchSummaryOnOpen: true,
      summaryRefetchInterval: 60_000,
    })
  })

  it('is fail-closed when summary activity is unknown even with cached active options', () => {
    const cached = aggregate(7)
    const state = deriveChoiceSetOptionsState({
      summary: null,
      aggregate: cached,
      displayFallback: cached.items,
      summaryFailed: false,
      optionsFailed: false,
    })

    expect(state.setIsActive).toBeNull()
    expect(state.displayOptions).toBe(cached.items)
    expect(state.selectableOptions).toHaveLength(0)
    expect(state.selectionReady).toBe(false)
  })

  it('keeps old rows only for display across a background version transition', () => {
    const oldAggregate = aggregate(7)
    const state = deriveChoiceSetOptionsState({
      summary: summary(8),
      aggregate: oldAggregate,
      displayFallback: oldAggregate.items,
      summaryFailed: false,
      optionsFailed: false,
    })

    expect(state.version).toBe(8)
    expect(state.displayOptions).toBe(oldAggregate.items)
    expect(state.selectableOptions).toHaveLength(0)
    expect(state.selectionReady).toBe(false)
  })

  it('returns cached array references only for an exact active summary and aggregate', () => {
    const currentSummary = summary(7)
    const currentAggregate = aggregate(7)
    const state = deriveChoiceSetOptionsState({
      summary: currentSummary,
      aggregate: currentAggregate,
      displayFallback: [],
      summaryFailed: false,
      optionsFailed: false,
    })

    expect(state.displayOptions).toBe(currentAggregate.items)
    expect(state.selectableOptions).toBe(currentAggregate.items)
    expect(state.selectionReady).toBe(true)
  })

  it('makes an inactive set display-only even when individual options remain active', () => {
    const currentAggregate = aggregate(7)
    const state = deriveChoiceSetOptionsState({
      summary: summary(7, false),
      aggregate: currentAggregate,
      displayFallback: [],
      summaryFailed: false,
      optionsFailed: false,
    })

    expect(state.setIsActive).toBe(false)
    expect(state.displayOptions).toBe(currentAggregate.items)
    expect(state.selectableOptions).toHaveLength(0)
    expect(state.selectionReady).toBe(false)
  })

  it('rejects a mandatory open refresh instead of resolving from seeded cache', async () => {
    const client = new QueryClient()
    client.setQueryData(choiceSetKeys.summary('equipment_mode'), summary(7))
    client.setQueryData(choiceSetKeys.options('equipment_mode', 7, false), aggregate(7))
    const fetchAggregate = vi.fn(async () => aggregate(7))

    await expect(
      loadChoiceSetOptionsForOpen({
        refetchSummary: async () => {
          throw new Error('summary refresh failed')
        },
        fetchAggregate,
      }),
    ).rejects.toThrow('summary refresh failed')

    expect(fetchAggregate).not.toHaveBeenCalled()
    expect(client.getQueryData(choiceSetKeys.options('equipment_mode', 7, false))).toEqual(
      aggregate(7),
    )
    client.clear()
  })

  it('loads the exact fresh returned summary version rather than a cached closure version', async () => {
    const fetchAggregate = vi.fn(async (freshSummary: ChoiceSetSummaryOut) =>
      aggregate(freshSummary.version),
    )

    const result = await loadChoiceSetOptionsForOpen({
      refetchSummary: async () => summary(8),
      fetchAggregate,
    })

    expect(fetchAggregate).toHaveBeenCalledWith(summary(8))
    expect(result.summary.version).toBe(8)
    expect(result.aggregate.version).toBe(8)
  })

  it('treats a typed version advance as a bounded non-user-facing transition', async () => {
    const refetchSummary = vi
      .fn<() => Promise<ChoiceSetSummaryOut>>()
      .mockResolvedValueOnce(summary(7))
      .mockResolvedValueOnce(summary(8))
    const fetchAggregate = vi
      .fn<(freshSummary: ChoiceSetSummaryOut) => Promise<ChoiceOptionAggregate>>()
      .mockRejectedValueOnce(new ChoiceSetVersionAdvanced('equipment_mode', 7, 8))
      .mockResolvedValueOnce(aggregate(8))

    await expect(
      loadChoiceSetOptionsForOpen({ refetchSummary, fetchAggregate }),
    ).resolves.toEqual({ summary: summary(8), aggregate: aggregate(8) })
    expect(refetchSummary).toHaveBeenCalledTimes(2)
    expect(fetchAggregate).toHaveBeenCalledTimes(2)
  })

  it('removes old option versions while preserving the response-version cache', async () => {
    const client = new QueryClient()
    client.setQueryData(choiceSetKeys.options('equipment_mode', 7, false), aggregate(7))
    client.setQueryData(choiceSetKeys.options('equipment_mode', 8, false), aggregate(8))
    client.setQueryData(choiceSetKeys.options('other', 2, false), {
      set_code: 'other',
      version: 2,
      items: [],
    })

    await removeSupersededChoiceOptionQueries(client, 'equipment_mode', 8, false)

    expect(client.getQueryData(choiceSetKeys.options('equipment_mode', 7, false))).toBeUndefined()
    expect(client.getQueryData(choiceSetKeys.options('equipment_mode', 8, false))).toEqual(
      aggregate(8),
    )
    expect(client.getQueryData(choiceSetKeys.options('other', 2, false))).toBeDefined()
    client.clear()
  })

  it('cancels only superseded requests so the current-version aggregate cannot be aborted', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let oldSignal: AbortSignal | undefined
    let currentSignal: AbortSignal | undefined
    let resolveOld!: (value: ChoiceOptionAggregate) => void
    let resolveCurrent!: (value: ChoiceOptionAggregate) => void
    const oldRequest = client.fetchQuery({
      queryKey: choiceSetKeys.options('equipment_mode', 7, false),
      queryFn: ({ signal }) => {
        oldSignal = signal
        return new Promise<ChoiceOptionAggregate>((resolve) => {
          resolveOld = resolve
        })
      },
    })
    const currentRequest = client.fetchQuery({
      queryKey: choiceSetKeys.options('equipment_mode', 8, false),
      queryFn: ({ signal }) => {
        currentSignal = signal
        return new Promise<ChoiceOptionAggregate>((resolve) => {
          resolveCurrent = resolve
        })
      },
    })
    void oldRequest.catch(() => undefined)
    void currentRequest.catch(() => undefined)
    await vi.waitFor(() => {
      expect(oldSignal).toBeDefined()
      expect(currentSignal).toBeDefined()
    })

    await removeSupersededChoiceOptionQueries(client, 'equipment_mode', 8, false)

    expect(oldSignal?.aborted).toBe(true)
    expect(currentSignal?.aborted).toBe(false)
    resolveOld(aggregate(7))
    resolveCurrent(aggregate(8))
    await expect(oldRequest).rejects.toBeDefined()
    await expect(currentRequest).resolves.toEqual(aggregate(8))
    client.clear()
  })

  it('does not let stale cleanup cancel a newer response-version request', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let oldSignal: AbortSignal | undefined
    let futureSignal: AbortSignal | undefined
    let resolveOld!: (value: ChoiceOptionAggregate) => void
    let resolveFuture!: (value: ChoiceOptionAggregate) => void
    const oldRequest = client.fetchQuery({
      queryKey: choiceSetKeys.options('equipment_mode', 7, false),
      queryFn: ({ signal }) => {
        oldSignal = signal
        return new Promise<ChoiceOptionAggregate>((resolve) => {
          resolveOld = resolve
        })
      },
    })
    const futureRequest = client.fetchQuery({
      queryKey: choiceSetKeys.options('equipment_mode', 9, false),
      queryFn: ({ signal }) => {
        futureSignal = signal
        return new Promise<ChoiceOptionAggregate>((resolve) => {
          resolveFuture = resolve
        })
      },
    })
    void oldRequest.catch(() => undefined)
    void futureRequest.catch(() => undefined)
    await vi.waitFor(() => {
      expect(oldSignal).toBeDefined()
      expect(futureSignal).toBeDefined()
    })

    await removeSupersededChoiceOptionQueries(client, 'equipment_mode', 8, false)

    expect(oldSignal?.aborted).toBe(true)
    expect(futureSignal?.aborted).toBe(false)
    resolveOld(aggregate(7))
    resolveFuture(aggregate(9))
    await expect(oldRequest).rejects.toBeDefined()
    await expect(futureRequest).resolves.toEqual(aggregate(9))
    client.clear()
  })

  it('lets only the latest preparation generation publish pending, success, or error state', () => {
    const first = beginChoiceSetPreparation(null, 'equipment_mode')
    const second = beginChoiceSetPreparation(first, 'equipment_mode')

    expect(
      settleChoiceSetPreparation(second, 'equipment_mode', first.generation, 'stale failure'),
    ).toBe(second)
    expect(second.preparing).toBe(true)

    const secondSuccess = settleChoiceSetPreparation(
      second,
      'equipment_mode',
      second.generation,
      null,
    )
    expect(secondSuccess).toEqual({
      setCode: 'equipment_mode',
      generation: second.generation,
      preparing: false,
      error: null,
    })
    expect(
      settleChoiceSetPreparation(
        secondSuccess,
        'equipment_mode',
        first.generation,
        'late stale failure',
      ),
    ).toBe(secondSuccess)

    const nextSet = beginChoiceSetPreparation(secondSuccess, 'project_category')
    expect(nextSet).toEqual({
      setCode: 'project_category',
      generation: 1,
      preparing: true,
      error: null,
    })
  })
})
