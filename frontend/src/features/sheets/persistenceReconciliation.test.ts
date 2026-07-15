import { describe, expect, it, vi } from 'vitest'

import { QueryClient } from '@tanstack/react-query'

import type { CellsPatchOut, SheetOut } from '@/api/types'

import type { DirtyCell, PersistedCell } from './editStore'
import {
  commitCanonicalSheetCells,
  reconcileSuccessfulPatch,
} from './persistenceReconciliation'

const response: CellsPatchOut = {
  cells: [{ condition_id: 1, parameter_code: 'decimal', value: '1.5' }],
  batch_id: 'canonical-batch',
}

describe('reconcileSuccessfulPatch', () => {
  it('commits canonical response values before clearing the matching request generation', async () => {
    const request: DirtyCell[] = [
      { conditionId: '1', parameterCode: 'decimal', value: '001.5000', revision: 1 },
    ]
    const calls: string[] = []
    const commitCanonical = vi.fn((cells: readonly PersistedCell[]) => {
      calls.push('canonical')
      expect(cells).toEqual([{ conditionId: '1', parameterCode: 'decimal', value: '1.5' }])
    })
    const markSnapshotSaved = vi.fn((snapshot: readonly DirtyCell[]) => {
      calls.push('snapshot')
      expect(snapshot).toBe(request)
    })

    await reconcileSuccessfulPatch(response, request, commitCanonical, markSnapshotSaved)

    expect(calls).toEqual(['canonical', 'snapshot'])
    expect(commitCanonical).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ value: '1.5' })]),
    )
    expect(markSnapshotSaved).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ value: '001.5000', revision: 1 })]),
    )
  })

  it('does not erase a newer ABA revision while still accepting the old canonical base', async () => {
    const request: DirtyCell[] = [
      { conditionId: '1', parameterCode: 'decimal', value: 'A', revision: 1 },
    ]
    const current = new Map<string, DirtyCell>([
      ['1 decimal', { conditionId: '1', parameterCode: 'decimal', value: 'A', revision: 3 }],
    ])
    const committed: PersistedCell[][] = []

    await reconcileSuccessfulPatch(
      { ...response, cells: [{ condition_id: 1, parameter_code: 'decimal', value: 'A' }] },
      request,
      (cells) => {
        committed.push([...cells])
      },
      (snapshot) => {
        for (const cell of snapshot) {
          const active = current.get(`${cell.conditionId} ${cell.parameterCode}`)
          if (active?.revision === cell.revision) current.delete(`${cell.conditionId} ${cell.parameterCode}`)
        }
      },
    )

    expect(committed[0][0].value).toBe('A')
    expect(current.get('1 decimal')?.revision).toBe(3)
  })

  it('does not expose a request-value cache path', async () => {
    const commitCanonical = vi.fn()
    const markSnapshotSaved = vi.fn()
    await reconcileSuccessfulPatch(response, [], commitCanonical, markSnapshotSaved)
    expect(commitCanonical).toHaveBeenCalledWith(
      response.cells.map((cell) => ({
        conditionId: String(cell.condition_id),
        parameterCode: cell.parameter_code,
        value: cell.value,
      })),
    )
  })

  it('cancels an older in-flight Sheet GET before publishing the canonical PATCH response', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const queryKey = ['sheet', 7] as const
    const base: SheetOut = {
      columns: [],
      rows: [
        {
          condition_id: 1,
          layer_key: 'L1',
          layer_label: 'L1',
          condition_label: 'POR',
          is_por: true,
          cells: { decimal: '1' },
        },
      ],
      lock: {
        locked_by: null,
        locked_at: null,
        expires_at: null,
        is_mine: true,
        heartbeat_seconds: 45,
      },
    }
    queryClient.setQueryData(queryKey, base)
    let resolveStale!: (sheet: SheetOut) => void
    const staleResponse = new Promise<SheetOut>((resolve) => {
      resolveStale = resolve
    })
    const staleFetch = queryClient.fetchQuery({
      queryKey,
      queryFn: () => staleResponse,
      staleTime: 0,
    })

    await commitCanonicalSheetCells(queryClient, 7, [
      { conditionId: '1', parameterCode: 'decimal', value: '1.5' },
    ])
    resolveStale(base)
    await Promise.allSettled([staleFetch])

    expect(queryClient.getQueryData<SheetOut>(queryKey)?.rows[0]?.cells.decimal).toBe('1.5')
  })
})
