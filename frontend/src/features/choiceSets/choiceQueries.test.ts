import { focusManager, QueryClient, QueryObserver } from '@tanstack/react-query'
import type { AxiosRequestConfig, AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return {
    ...actual,
    apiClient: {
      get: vi.fn(),
    },
  }
})

import { apiClient } from '../../api/client'
import type {
  ChoiceOptionAggregate,
  ChoiceOptionOut,
  ChoiceOptionPageOut,
  ChoiceSetSummaryOut,
} from '../../api/types'
import { queryClient as productionQueryClient } from '../../app/queryClient'
import {
  ChoiceSetVersionAdvanced,
  choiceOptionQueryOptions,
  choiceSetKeys,
  invalidateChoiceSetMutation,
  sheetSummaryQueryOptions,
  summaryQueryOptions,
} from './choiceQueries'

function response<T>(data: T): AxiosResponse<T> {
  return { data } as AxiosResponse<T>
}

function option(code: string): ChoiceOptionOut {
  return { code, label: `Label ${code}`, sort_order: 0, is_active: true }
}

function page(
  version: number,
  items: ChoiceOptionOut[],
  nextCursor: string | null,
): ChoiceOptionPageOut {
  return { set_code: 'equipment_mode', version, items, next_cursor: nextCursor }
}

function summary(version: number, code = 'equipment_mode'): ChoiceSetSummaryOut {
  return {
    code,
    display_name: 'Equipment mode',
    description: null,
    is_active: true,
    version,
    option_count: 1,
    active_option_count: 1,
    parameter_usage_count: 0,
    profile_usage_fields: [],
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  }
}

function aggregate(version: number, codes: string[]): ChoiceOptionAggregate {
  return { set_code: 'equipment_mode', version, items: codes.map(option) }
}

function createProductionQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: productionQueryClient.getDefaultOptions() })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const get = vi.mocked(apiClient.get)
const clients: QueryClient[] = []

describe('choice-set query policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    for (const client of clients.splice(0)) client.clear()
    focusManager.setFocused(undefined)
    vi.useRealTimers()
  })

  it('separates option aggregates by set version and activity policy', () => {
    expect(choiceSetKeys.options('equipment_mode', 7, true)).toEqual([
      'choice-sets',
      'options',
      'equipment_mode',
      7,
      true,
    ])
    expect(choiceSetKeys.options('equipment_mode', 8, true)).not.toEqual(
      choiceSetKeys.options('equipment_mode', 7, true),
    )
  })

  it('always refreshes summaries on focus and polls sheet summaries every minute', () => {
    expect(summaryQueryOptions('equipment_mode').refetchOnWindowFocus).toBe('always')
    expect(sheetSummaryQueryOptions('equipment_mode').refetchInterval).toBe(60_000)
  })

  it('treats exact versioned aggregates as immutable across 31s, focus, and editor open reuse', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'))
    const client = createProductionQueryClient()
    clients.push(client)
    get.mockImplementation((_url: string, config?: AxiosRequestConfig) => {
      const version = Number((config?.params as { version?: number } | undefined)?.version)
      return Promise.resolve(response(page(version, [option(`V${version}`)], null)))
    })
    const versionSeven = choiceOptionQueryOptions(client, 'equipment_mode', 7, true)

    expect(versionSeven.staleTime).toBe(Number.POSITIVE_INFINITY)
    expect(versionSeven.refetchOnWindowFocus).toBe(false)
    await client.fetchQuery(versionSeven)
    vi.advanceTimersByTime(31_000)
    await client.fetchQuery(versionSeven)

    const observer = new QueryObserver(client, versionSeven)
    client.mount()
    const unsubscribe = observer.subscribe(() => undefined)
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await Promise.resolve()
    await Promise.resolve()

    // Opening another shared-set cell uses the same exact cache key.
    await client.fetchQuery(versionSeven)
    expect(get).toHaveBeenCalledTimes(1)

    await client.fetchQuery(choiceOptionQueryOptions(client, 'equipment_mode', 8, true))
    expect(get).toHaveBeenCalledTimes(2)

    unsubscribe()
    client.unmount()
    focusManager.setFocused(undefined)
    vi.useRealTimers()
  })

  it('invalidates list and changed summary while removing only that sets option aggregates', async () => {
    const client = createProductionQueryClient()
    clients.push(client)
    client.setQueryData(choiceSetKeys.list(false), [summary(3)])
    client.setQueryData(choiceSetKeys.list(true), [summary(3)])
    client.setQueryData(choiceSetKeys.summary('equipment_mode'), summary(3))
    client.setQueryData(choiceSetKeys.summary('customer_type'), summary(9, 'customer_type'))
    client.setQueryData(choiceSetKeys.options('equipment_mode', 3, true), aggregate(3, ['A']))
    client.setQueryData(choiceSetKeys.options('customer_type', 9, true), {
      set_code: 'customer_type',
      version: 9,
      items: [option('B')],
    })

    await invalidateChoiceSetMutation(client, 'equipment_mode')

    expect(client.getQueryState(choiceSetKeys.list(false))?.isInvalidated).toBe(true)
    expect(client.getQueryState(choiceSetKeys.list(true))?.isInvalidated).toBe(true)
    expect(client.getQueryState(choiceSetKeys.summary('equipment_mode'))?.isInvalidated).toBe(true)
    expect(client.getQueryState(choiceSetKeys.summary('customer_type'))?.isInvalidated).toBe(false)
    expect(client.getQueryData(choiceSetKeys.options('equipment_mode', 3, true))).toBeUndefined()
    expect(client.getQueryData(choiceSetKeys.options('customer_type', 9, true))).toEqual({
      set_code: 'customer_type',
      version: 9,
      items: [option('B')],
    })
  })

  it('primes only the response-version key and refetches summary before surfacing a transition', async () => {
    const client = createProductionQueryClient()
    clients.push(client)
    const events: string[] = []
    let optionRequests = 0
    let summaryRequests = 0
    get.mockImplementation((url: string) => {
      if (url === '/choice-sets/equipment_mode/options') {
        optionRequests += 1
        return Promise.resolve(response(page(4, [option(optionRequests === 1 ? 'STALE' : 'B')], null)))
      }
      if (url === '/choice-sets/equipment_mode') {
        summaryRequests += 1
        events.push('summary-refetched')
        return Promise.resolve(response(summary(4)))
      }
      throw new Error(`unexpected GET ${url}`)
    })

    client.setQueryData(choiceSetKeys.summary('equipment_mode'), summary(3))
    const observer = new QueryObserver(client, summaryQueryOptions('equipment_mode'))
    const unsubscribe = observer.subscribe(() => undefined)

    const request = client.fetchQuery(
      choiceOptionQueryOptions(client, 'equipment_mode', 3, true),
    )
    await expect(request).rejects.toBeInstanceOf(ChoiceSetVersionAdvanced)
    events.push('transition-surfaced')

    expect(optionRequests).toBe(2)
    expect(summaryRequests).toBe(1)
    expect(events).toEqual(['summary-refetched', 'transition-surfaced'])
    expect(client.getQueryData(choiceSetKeys.options('equipment_mode', 3, true))).toBeUndefined()
    expect(client.getQueryData(choiceSetKeys.options('equipment_mode', 4, true))).toEqual(
      aggregate(4, ['B']),
    )
    expect(client.getQueryData(choiceSetKeys.summary('equipment_mode'))).toEqual(summary(4))
    expect(client.getQueryState(choiceSetKeys.options('equipment_mode', 3, true))?.status).toBe(
      'error',
    )

    unsubscribe()
  })

  it('delegates ordinary failures to the production bounded retry policy', async () => {
    const client = createProductionQueryClient()
    clients.push(client)
    get.mockRejectedValueOnce(new Error('temporary outage')).mockResolvedValueOnce(
      response(page(3, [option('A')], null)),
    )

    await expect(
      client.fetchQuery(choiceOptionQueryOptions(client, 'equipment_mode', 3, true)),
    ).resolves.toEqual(aggregate(3, ['A']))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('cancels a deferred page before mutation removal so late completion cannot repopulate cache', async () => {
    const client = createProductionQueryClient()
    clients.push(client)
    const secondPage = deferred<AxiosResponse<ChoiceOptionPageOut>>()
    const seenSignals: NonNullable<AxiosRequestConfig['signal']>[] = []
    let optionRequests = 0
    get.mockImplementation((url: string, config?: AxiosRequestConfig) => {
      if (url !== '/choice-sets/equipment_mode/options') {
        throw new Error(`unexpected GET ${url}`)
      }
      optionRequests += 1
      if (config?.signal) seenSignals.push(config.signal)
      if (optionRequests === 1) {
        return Promise.resolve(response(page(3, [option('A')], 'next')))
      }
      return secondPage.promise
    })

    const request = client.fetchQuery(
      choiceOptionQueryOptions(client, 'equipment_mode', 3, true),
    )
    void request.catch(() => undefined)
    await vi.waitFor(() => expect(optionRequests).toBe(2))

    await invalidateChoiceSetMutation(client, 'equipment_mode')

    expect(seenSignals).toHaveLength(2)
    expect(seenSignals[0]).toBe(seenSignals[1])
    expect(seenSignals[1]?.aborted).toBe(true)
    secondPage.resolve(response(page(3, [option('B')], null)))
    await expect(request).rejects.toBeDefined()
    await Promise.resolve()

    expect(client.getQueryData(choiceSetKeys.options('equipment_mode', 3, true))).toBeUndefined()
    expect(client.getQueryData(choiceSetKeys.options('equipment_mode', 4, true))).toBeUndefined()
  })
})
