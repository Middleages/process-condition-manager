import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { invalidateProjectHistoryAfterMutation } from './historyCache'
import {
  historyCellHistoryQueryKey,
  historyDetailQueryKey,
  historyProjectDetailQueryKey,
  historyProjectQueryKey,
  historyTimelineQueryKey,
} from './historyQuery'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('project history mutation cache boundary', () => {
  it('fences every in-flight history request, removes only detail pages, and refetches fresh data', async () => {
    const projectId = 7
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    })
    const timelineKey = historyTimelineQueryKey(projectId, {})
    const cellKey = historyCellHistoryQueryKey(projectId, 11, 'ETCH_P001')
    const detailKey = historyDetailQueryKey(projectId, 'batch', 'batch-1')
    const detailPageKey = [...detailKey, 'detail-page', 'cursor-1']
    const timelineLate = deferred<string>()
    const cellLate = deferred<string>()
    const detailLate = deferred<string>()
    const detailPageLate = deferred<string>()
    const timelineQueryFn = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => timelineLate.promise)
      .mockResolvedValue('timeline-fresh')
    const cellQueryFn = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => cellLate.promise)
      .mockResolvedValue('cell-fresh')
    const detailQueryFn = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => detailLate.promise)
      .mockResolvedValue('detail-fresh')
    const detailPageQueryFn = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => detailPageLate.promise)
      .mockResolvedValue('detail-page-fresh')

    const staleUpdatedAt = Date.now() - 30_001
    queryClient.setQueryData(timelineKey, 'timeline-before', { updatedAt: staleUpdatedAt })
    queryClient.setQueryData(cellKey, 'cell-before', { updatedAt: staleUpdatedAt })
    const timelineObserver = new QueryObserver(queryClient, {
      queryKey: timelineKey,
      queryFn: timelineQueryFn,
    })
    const cellObserver = new QueryObserver(queryClient, {
      queryKey: cellKey,
      queryFn: cellQueryFn,
    })
    const unsubscribeTimeline = timelineObserver.subscribe(() => undefined)
    const unsubscribeCell = cellObserver.subscribe(() => undefined)
    const detailRequest = queryClient
      .fetchQuery({ queryKey: detailKey, queryFn: detailQueryFn })
      .catch(() => undefined)
    const detailPageRequest = queryClient
      .fetchQuery({ queryKey: detailPageKey, queryFn: detailPageQueryFn })
      .catch(() => undefined)
    await Promise.resolve()
    expect([
      timelineQueryFn.mock.calls.length,
      cellQueryFn.mock.calls.length,
      detailQueryFn.mock.calls.length,
      detailPageQueryFn.mock.calls.length,
    ]).toEqual([1, 1, 1, 1])

    const callOrder: string[] = []
    const cancelQueries = queryClient.cancelQueries.bind(queryClient)
    const removeQueries = queryClient.removeQueries.bind(queryClient)
    const invalidateQueries = queryClient.invalidateQueries.bind(queryClient)
    const cancelSpy = vi
      .spyOn(queryClient, 'cancelQueries')
      .mockImplementation((filters, options) => {
        callOrder.push('cancel')
        return cancelQueries(filters, options)
      })
    const removeSpy = vi.spyOn(queryClient, 'removeQueries').mockImplementation((filters) => {
      callOrder.push('remove')
      return removeQueries(filters)
    })
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation((filters, options) => {
        callOrder.push('invalidate')
        return invalidateQueries(filters, options)
      })

    const mutationRefresh = invalidateProjectHistoryAfterMutation(queryClient, projectId)

    expect(callOrder).toEqual(['cancel', 'remove', 'invalidate'])
    expect(cancelSpy).toHaveBeenCalledWith({ queryKey: historyProjectQueryKey(projectId) })
    expect(removeSpy).toHaveBeenCalledWith({
      queryKey: historyProjectDetailQueryKey(projectId),
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: historyProjectQueryKey(projectId),
      refetchType: 'active',
    })
    expect(queryClient.getQueryData(detailKey)).toBeUndefined()
    expect(queryClient.getQueryData(detailPageKey)).toBeUndefined()
    expect(queryClient.getQueryData(timelineKey)).toBe('timeline-before')
    expect(queryClient.getQueryData(cellKey)).toBe('cell-before')
    expect(queryClient.getQueryState(timelineKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(cellKey)?.isInvalidated).toBe(true)

    await mutationRefresh
    expect(timelineQueryFn).toHaveBeenCalledTimes(2)
    expect(cellQueryFn).toHaveBeenCalledTimes(2)
    expect(queryClient.getQueryData(timelineKey)).toBe('timeline-fresh')
    expect(queryClient.getQueryData(cellKey)).toBe('cell-fresh')

    timelineLate.resolve('timeline-late')
    cellLate.resolve('cell-late')
    detailLate.resolve('detail-late')
    detailPageLate.resolve('detail-page-late')
    await Promise.all([detailRequest, detailPageRequest])
    await Promise.resolve()

    expect(queryClient.getQueryData(timelineKey)).toBe('timeline-fresh')
    expect(queryClient.getQueryData(cellKey)).toBe('cell-fresh')
    expect(queryClient.getQueryData(detailKey)).toBeUndefined()
    expect(queryClient.getQueryData(detailPageKey)).toBeUndefined()

    await expect(
      queryClient.fetchQuery({ queryKey: detailKey, queryFn: detailQueryFn }),
    ).resolves.toBe('detail-fresh')
    await expect(
      queryClient.fetchQuery({ queryKey: detailPageKey, queryFn: detailPageQueryFn }),
    ).resolves.toBe('detail-page-fresh')
    expect(detailQueryFn).toHaveBeenCalledTimes(2)
    expect(detailPageQueryFn).toHaveBeenCalledTimes(2)

    unsubscribeTimeline()
    unsubscribeCell()
    queryClient.clear()
  })
})
