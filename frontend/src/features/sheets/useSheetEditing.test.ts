import { describe, expect, it, vi } from 'vitest'

import type { CellsPatchOut } from '@/api/types'

import type { DirtyCell } from './editStore'
import { reconcileSuccessfulPatch } from './persistenceReconciliation'
import { persistDirtySnapshot } from './useSheetEditing'

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
