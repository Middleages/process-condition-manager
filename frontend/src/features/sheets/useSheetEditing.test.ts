import { describe, expect, it, vi } from 'vitest'
import source from './useSheetEditing.ts?raw'

import type { CellsPatchOut } from '@/api/types'

import { createAsyncQueue } from './autosave'
import type { DirtyCell } from './editStore'
import { reconcileSuccessfulPatch } from './persistenceReconciliation'
import {
  discardRetainedPasteSnapshot,
  persistDirtySnapshot,
  resolvePasteSnapshotAction,
  shouldResumeAutosaveAfterReacquire,
  waitForPersistenceBarrier,
  type RetainedPasteSnapshot,
  type SheetEditingPersistenceSnapshot,
} from './useSheetEditing'

const snapshot: DirtyCell[] = [
  { conditionId: '1', parameterCode: 'decimal', value: '001.5000', revision: 11 },
]

describe('persistDirtySnapshot', () => {
  it('sends the exact request snapshot and reconciles the canonical response separately', async () => {
    const response: CellsPatchOut = {
      cells: [{ condition_id: 1, parameter_code: 'decimal', value: '1.5' }],
      batch_id: 'batch-1',
    }
    const send = vi.fn(async () => response)
    const commitCanonical = vi.fn()
    const markSnapshotSaved = vi.fn()
    const onPersisted = vi.fn(
      (canonicalResponse: CellsPatchOut, request: readonly DirtyCell[]) =>
        reconcileSuccessfulPatch(canonicalResponse, request, commitCanonical, markSnapshotSaved),
    )

    await expect(
      persistDirtySnapshot({
        projectId: 7,
        requestSnapshot: snapshot,
        origin: 'paste',
        lockToken: 'token',
        send,
        onPersisted,
      }),
    ).resolves.toBe(response)

    expect(send).toHaveBeenCalledWith(
      7,
      [{ condition_id: 1, parameter_code: 'decimal', value: '001.5000' }],
      'paste',
      'token',
    )
    expect(commitCanonical).toHaveBeenCalledWith([
      { conditionId: '1', parameterCode: 'decimal', value: '1.5' },
    ])
    expect(markSnapshotSaved).toHaveBeenCalledWith(snapshot)
    expect(onPersisted).toHaveBeenCalledWith(response, snapshot)
  })

  it('leaves dirty generations untouched when the network request fails', async () => {
    const onPersisted = vi.fn()

    await expect(
      persistDirtySnapshot({
        projectId: 7,
        requestSnapshot: snapshot,
        origin: 'paste',
        lockToken: 'token',
        send: vi.fn(async () => {
          throw new Error('offline')
        }),
        onPersisted,
      }),
    ).rejects.toThrow('offline')

    expect(onPersisted).not.toHaveBeenCalled()
  })

  it('does not finish persistence before async canonical-cache reconciliation completes', async () => {
    const response: CellsPatchOut = { cells: [], batch_id: 'batch-cache-fence' }
    let releaseCacheFence!: () => void
    const cacheFence = new Promise<void>((resolve) => {
      releaseCacheFence = resolve
    })
    const onPersisted = vi.fn(() => cacheFence)
    let settled = false

    const persistence = persistDirtySnapshot({
      projectId: 7,
      requestSnapshot: snapshot,
      origin: 'manual',
      lockToken: 'token',
      send: vi.fn(async () => response),
      onPersisted,
    }).finally(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(onPersisted).toHaveBeenCalledWith(response, snapshot)
    expect(settled).toBe(false)

    releaseCacheFence()
    await expect(persistence).resolves.toBe(response)
  })
})

describe('retained paste identity', () => {
  it('does not auto-flush a retained paste after lock reacquisition', () => {
    const retained: RetainedPasteSnapshot = {
      identity: Symbol('paste-a'),
      snapshot,
    }

    expect(shouldResumeAutosaveAfterReacquire(1, retained)).toBe(false)
    expect(shouldResumeAutosaveAfterReacquire(1, null)).toBe(true)
    expect(shouldResumeAutosaveAfterReacquire(0, null)).toBe(false)
  })

  it('retries only the same review and replaces failed A before preparing B', () => {
    const pasteA = Symbol('paste-a')
    const pasteB = Symbol('paste-b')
    const retained: RetainedPasteSnapshot = { identity: pasteA, snapshot }

    expect(resolvePasteSnapshotAction(retained, pasteA)).toBe('retry')
    expect(resolvePasteSnapshotAction(retained, pasteB)).toBe('replace')
    expect(resolvePasteSnapshotAction(null, pasteB)).toBe('prepare')
  })

  it('explicit cancel discards only the exact retained revisions', () => {
    const retained: RetainedPasteSnapshot = {
      identity: Symbol('paste-a'),
      snapshot,
    }
    const markSaved = vi.fn()

    discardRetainedPasteSnapshot(retained, markSaved)

    expect(markSaved).toHaveBeenCalledOnce()
    expect(markSaved).toHaveBeenCalledWith(snapshot)
  })
})

describe('explicit validation persistence barrier', () => {
  it('waits immediate-write queue work before flushing autosave and reporting idle', async () => {
    const queue = createAsyncQueue()
    let releaseWrite!: () => void
    const write = queue.run(
      () =>
        new Promise<void>((resolve) => {
          releaseWrite = resolve
        }),
    )
    const snapshot: SheetEditingPersistenceSnapshot = {
      dirtyCount: 1,
      writeBusy: true,
      saveStatus: 'saving',
      persistedGeneration: 0,
    }
    const flushNow = vi.fn(async () => {
      snapshot.dirtyCount = 0
      snapshot.writeBusy = false
      snapshot.saveStatus = 'saved'
      snapshot.persistedGeneration = 1
    })

    const barrier = waitForPersistenceBarrier({
      queue,
      flushNow,
      getSnapshot: () => snapshot,
      isCurrent: () => true,
    })
    await Promise.resolve()
    expect(flushNow).not.toHaveBeenCalled()

    releaseWrite()
    await write
    await expect(barrier).resolves.toBe(true)
    expect(flushNow).toHaveBeenCalledOnce()
  })

  it('does not silently retry an already failed autosave while validation is waiting', async () => {
    const flushNow = vi.fn(async () => undefined)

    await expect(
      waitForPersistenceBarrier({
        queue: createAsyncQueue(),
        flushNow,
        getSnapshot: () => ({
          dirtyCount: 1,
          writeBusy: false,
          saveStatus: 'error',
          persistedGeneration: 0,
        }),
        isCurrent: () => true,
      }),
    ).resolves.toBe(false)

    expect(flushNow).not.toHaveBeenCalled()
  })

  it('publishes durable generation success for both cell batches and structural/POR writes', () => {
    expect(source.match(/publishDurableSuccess\(/g)?.length).toBeGreaterThanOrEqual(2)
    expect(source).toMatch(/await persistDirtySnapshot\([\s\S]*?publishDurableSuccess/)
    expect(source).toMatch(/const result = await fn\(token\)[\s\S]*?publishDurableSuccess\(generation\)/)
    expect(source).toContain('operationQueueRef.current')
    expect(source).toContain('waitForPersistenceBarrier')
  })
})
