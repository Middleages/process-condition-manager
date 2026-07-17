import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { invalidateProjectBackboneDiffAfterMutation } from './backboneDiffCache'
import { backboneDiffBranchQueryKey, backboneDiffCellQueryKey, backboneDiffRootQueryKey } from './backboneDiffQuery'

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

describe('project backbone-diff mutation cache boundary', () => {
  it('fences in-flight branch/cell responses and refetches active root data', async () => {
    const projectId = 7
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    })

    const rootKey = backboneDiffRootQueryKey(projectId, { previewLimit: 20 })
    const branchKey = backboneDiffBranchQueryKey(projectId, 'L1::10::ETCH', {
      scope: 'scope-1',
    })
    const cellKey = backboneDiffCellQueryKey(projectId, 'L1::10::ETCH', 'R1', {
      scope: 'cell-scope-1',
    })

    const lateRoot = deferred<string>()
    const lateBranch = deferred<string>()
    const lateCell = deferred<string>()

    const rootQueryFn = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => lateRoot.promise)
      .mockResolvedValue('root-fresh')
    const branchQueryFn = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => lateBranch.promise)
      .mockResolvedValue('branch-fresh')
    const cellQueryFn = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => lateCell.promise)
      .mockResolvedValue('cell-fresh')

    queryClient.setQueryData(rootKey, 'root-before')
    queryClient.setQueryData(branchKey, ['branch-before'])
    queryClient.setQueryData(cellKey, ['cell-before'])

    const branchObserver = new QueryObserver(queryClient, {
      queryKey: branchKey,
      queryFn: branchQueryFn,
    })
    const cellObserver = new QueryObserver(queryClient, {
      queryKey: cellKey,
      queryFn: cellQueryFn,
    })
    const unsubscribeBranch = branchObserver.subscribe(() => undefined)
    const unsubscribeCell = cellObserver.subscribe(() => undefined)

    const rootRequest = queryClient
      .fetchQuery({ queryKey: rootKey, queryFn: rootQueryFn })
      .catch(() => undefined)
    const branchRequest = queryClient
      .fetchQuery({ queryKey: branchKey, queryFn: branchQueryFn })
      .catch(() => undefined)
    const cellRequest = queryClient
      .fetchQuery({ queryKey: cellKey, queryFn: cellQueryFn })
      .catch(() => undefined)

    await Promise.resolve()

    expect([
      rootQueryFn.mock.calls.length,
      branchQueryFn.mock.calls.length,
      cellQueryFn.mock.calls.length,
    ]).toEqual([1, 1, 1])

    const callOrder: string[] = []
    const cancelSpy = vi.spyOn(queryClient, 'cancelQueries').mockImplementation((filters) => {
      callOrder.push('cancel')
      return QueryClient.prototype.cancelQueries.call(queryClient, filters)
    })
    const removeSpy = vi.spyOn(queryClient, 'removeQueries').mockImplementation((filters) => {
      callOrder.push('remove')
      return QueryClient.prototype.removeQueries.call(queryClient, filters)
    })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockImplementation((filters) => {
      callOrder.push('invalidate')
      return QueryClient.prototype.invalidateQueries.call(queryClient, filters)
    })

    const mutationRefresh = invalidateProjectBackboneDiffAfterMutation(queryClient, projectId)

    expect(callOrder).toEqual(['cancel', 'remove', 'remove', 'invalidate'])
    expect(cancelSpy).toHaveBeenCalledWith({ queryKey: ['backboneDiff', projectId] })
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ['backboneDiff', projectId, 'branch'], exact: false })
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ['backboneDiff', projectId, 'cell'], exact: false })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['backboneDiff', projectId],
      refetchType: 'active',
    })

    expect(queryClient.getQueryData(rootKey)).toBe('root-before')
    expect(queryClient.getQueryData(branchKey)).toBeUndefined()
    expect(queryClient.getQueryData(cellKey)).toBeUndefined()
    expect(queryClient.getQueryState(rootKey)?.isInvalidated).toBe(true)

    await mutationRefresh

    expect(rootQueryFn.mock.calls.length).toBeGreaterThanOrEqual(1)

    lateRoot.resolve('root-late')
    lateBranch.resolve('branch-late')
    lateCell.resolve('cell-late')

    await Promise.all([rootRequest, branchRequest, cellRequest])
    await Promise.resolve()

    expect(queryClient.getQueryData(rootKey)).not.toBe('root-late')
    expect(queryClient.getQueryData(branchKey)).toBeUndefined()
    expect(queryClient.getQueryData(cellKey)).toBeUndefined()

    await expect(
      queryClient.fetchQuery({ queryKey: branchKey, queryFn: branchQueryFn }),
    ).resolves.toBe('branch-fresh')
    await expect(
      queryClient.fetchQuery({ queryKey: cellKey, queryFn: cellQueryFn }),
    ).resolves.toBe('cell-fresh')
    expect(branchQueryFn).toHaveBeenCalledTimes(2)
    expect(cellQueryFn).toHaveBeenCalledTimes(2)

    unsubscribeBranch()
    unsubscribeCell()
    queryClient.clear()
  })
})
