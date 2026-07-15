import { describe, expect, it, vi } from 'vitest'
import hookSource from './useSheetChoiceSets.ts?raw'

import type {
  ChoiceOptionAggregate,
  ChoiceSetSummaryOut,
  SheetColumnOut,
} from '@/api/types'

import {
  advanceSheetChoiceTarget,
  bootstrapSheetChoiceTargets,
  buildSheetChoiceResources,
  deriveSheetChoiceResource,
  loadSheetChoiceResourceForOpen,
  prepareLiveSheetChoiceResourceForOpen,
  sheetChoiceTargetVersion,
} from './useSheetChoiceSets'
import { ChoiceSetVersionAdvanced } from '@/features/choiceSets/choiceQueries'
import {
  createLiveChoiceResource,
  getLiveChoiceResourceSnapshot,
  publishLiveChoiceResource,
  stageLiveChoiceResource,
  subscribeLiveChoiceResource,
} from '@/grid/choiceCell'

function column(
  parameterCode: string,
  setCode: string,
  version: number,
): SheetColumnOut {
  return {
    parameter_code: parameterCode,
    display_name: parameterCode,
    value_type: 'choice',
    category_code: null,
    unit: null,
    description: null,
    choice_set_code: setCode,
    choice_set_version: version,
    sort_order: 0,
  }
}

function summary(code: string, version: number, isActive = true): ChoiceSetSummaryOut {
  return {
    code,
    version,
    is_active: isActive,
    display_name: code,
    description: null,
    option_count: 1,
    active_option_count: 1,
    parameter_usage_count: 1,
    profile_usage_fields: [],
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  }
}

function aggregate(code: string, version: number): ChoiceOptionAggregate {
  return {
    set_code: code,
    version,
    items: [{ code: 'AUTO', label: 'Automatic', sort_order: 0, is_active: true }],
  }
}

describe('buildSheetChoiceResources', () => {
  it('deduplicates exact set/version pairs and sorts them for stable query order', () => {
    expect(
      buildSheetChoiceResources([
        column('mode_a', 'equipment_mode', 7),
        column('mode_b', 'equipment_mode', 7),
        column('direction', 'active_direction', 2),
      ]),
    ).toEqual([
      { setCode: 'active_direction', version: 2 },
      { setCode: 'equipment_mode', version: 7 },
    ])
  })

  it('uses locale-independent code-point ordering for query hook stability', () => {
    expect(
      buildSheetChoiceResources([
        column('lower', 'a_set', 1),
        column('upper', 'Z_set', 1),
      ]).map((plan) => plan.setCode),
    ).toEqual(['Z_set', 'a_set'])
  })

  it('uses a later Sheet version as the replacement resource key', () => {
    expect(buildSheetChoiceResources([column('mode', 'equipment_mode', 8)])).toEqual([
      { setCode: 'equipment_mode', version: 8 },
    ])
  })

  it('fails closed instead of choosing between conflicting versions', () => {
    expect(() =>
      buildSheetChoiceResources([
        column('mode_a', 'equipment_mode', 7),
        column('mode_b', 'equipment_mode', 8),
      ]),
    ).toThrowError(expect.objectContaining({ code: 'conflicting_choice_versions' }))
  })
})

describe('sheet choice query plan', () => {
  it('boots every aggregate from the Sheet version before a newer summary may advance it', () => {
    const plans = [
      { setCode: 'active_direction', version: 2 },
      { setCode: 'equipment_mode', version: 7 },
    ]
    const bootstrap = bootstrapSheetChoiceTargets(plans)

    expect([...bootstrap]).toEqual([
      ['active_direction', 2],
      ['equipment_mode', 7],
    ])
    expect(advanceSheetChoiceTarget(plans[1]!, 7, 8, false)).toBe(7)
    expect(advanceSheetChoiceTarget(plans[1]!, 7, 8, true)).toBe(8)
    expect(advanceSheetChoiceTarget(plans[1]!, 8, null, true)).toBe(8)
    expect(hookSource).toContain('columnVersion: targets[index] ?? plan.version')
  })

  it('never lets an older cached summary downgrade the Sheet bootstrap version', () => {
    expect(sheetChoiceTargetVersion(7, 6)).toBe(7)
    expect(sheetChoiceTargetVersion(7, null)).toBe(7)
    expect(sheetChoiceTargetVersion(7, 8)).toBe(8)
  })

  it('uses shared TanStack query arrays rather than one hook or option copy per cell', () => {
    expect(hookSource.match(/\buseQueries\s*\(/g)?.length).toBe(2)
    expect(hookSource).toContain('choiceOptionQueryOptions')
    expect(hookSource).toContain('includeInactive = true')
    expect(hookSource).not.toContain('useChoiceSetOptions(')
  })

  it('moves the observed target before pruning superseded queries during editor open', () => {
    const prepareStart = hookSource.indexOf('const prepareToOpen = async')
    const transitionEnd = hookSource.indexOf('const typedTransition', prepareStart)
    const prepareSource = hookSource.slice(prepareStart, transitionEnd)

    expect(prepareStart).toBeGreaterThanOrEqual(0)
    expect(transitionEnd).toBeGreaterThan(prepareStart)
    expect(prepareSource).not.toContain('removeSupersededChoiceOptionQueries(')
    expect(prepareSource).toContain('onPreparedVersion:')
  })
})

describe('deriveSheetChoiceResource', () => {
  it('keeps a target aggregate display-only while the cached summary is stale', () => {
    const resource = deriveSheetChoiceResource({
      setCode: 'equipment_mode',
      columnVersion: 7,
      summary: summary('equipment_mode', 6),
      targetAggregate: aggregate('equipment_mode', 7),
      displayFallback: aggregate('equipment_mode', 6),
      summaryFailed: false,
      aggregateFailed: false,
      loading: false,
    })

    expect(resource.targetVersion).toBe(7)
    expect(resource.displayAggregate?.version).toBe(7)
    expect(resource.selectableAggregate).toBeNull()
    expect(resource.selectionReady).toBe(false)
    expect(resource.isStale).toBe(true)
  })

  it('authorizes only an exact active summary/target/aggregate match', () => {
    const active = deriveSheetChoiceResource({
      setCode: 'equipment_mode',
      columnVersion: 7,
      summary: summary('equipment_mode', 7),
      targetAggregate: aggregate('equipment_mode', 7),
      displayFallback: null,
      summaryFailed: false,
      aggregateFailed: false,
      loading: false,
    })
    const inactive = deriveSheetChoiceResource({
      setCode: 'equipment_mode',
      columnVersion: 7,
      summary: summary('equipment_mode', 7, false),
      targetAggregate: aggregate('equipment_mode', 7),
      displayFallback: null,
      summaryFailed: false,
      aggregateFailed: false,
      loading: false,
    })

    expect(active.selectableAggregate).toBe(active.displayAggregate)
    expect(active.selectionReady).toBe(true)
    expect(inactive.selectableAggregate).toBeNull()
    expect(inactive.selectionReady).toBe(false)
  })
})

describe('loadSheetChoiceResourceForOpen', () => {
  it('awaits the fresh summary and exact target aggregate', async () => {
    const calls: string[] = []
    const refetchSummary = vi.fn(async () => {
      calls.push('summary')
      return summary('equipment_mode', 8)
    })
    const fetchAggregate = vi.fn(async (version: number) => {
      calls.push(`aggregate:${version}`)
      return aggregate('equipment_mode', version)
    })

    await expect(
      loadSheetChoiceResourceForOpen({
        setCode: 'equipment_mode',
        columnVersion: 7,
        refetchSummary,
        fetchAggregate,
      }),
    ).resolves.toEqual({
      summary: expect.objectContaining({ version: 8 }),
      aggregate: expect.objectContaining({ version: 8 }),
    })
    expect(calls).toEqual(['summary', 'aggregate:8'])
  })

  it('restarts through a typed version transition without exposing the old aggregate', async () => {
    const refetchSummary = vi
      .fn<() => Promise<ChoiceSetSummaryOut>>()
      .mockResolvedValueOnce(summary('equipment_mode', 7))
      .mockResolvedValueOnce(summary('equipment_mode', 8))
    const fetchAggregate = vi
      .fn<(version: number) => Promise<ChoiceOptionAggregate>>()
      .mockRejectedValueOnce(new ChoiceSetVersionAdvanced('equipment_mode', 7, 8))
      .mockResolvedValueOnce(aggregate('equipment_mode', 8))
    const onVersionAdvanced = vi.fn()

    await expect(
      loadSheetChoiceResourceForOpen({
        setCode: 'equipment_mode',
        columnVersion: 7,
        refetchSummary,
        fetchAggregate,
        onVersionAdvanced,
      }),
    ).resolves.toEqual({
      summary: expect.objectContaining({ version: 8 }),
      aggregate: expect.objectContaining({ version: 8 }),
    })
    expect(onVersionAdvanced).toHaveBeenCalledOnce()
    expect(fetchAggregate).toHaveBeenNthCalledWith(1, 7)
    expect(fetchAggregate).toHaveBeenNthCalledWith(2, 8)
  })

  it('updates an already-captured cold overlay resource when open advances the version', async () => {
    const cold = deriveSheetChoiceResource({
      setCode: 'equipment_mode',
      columnVersion: 7,
      summary: null,
      targetAggregate: null,
      displayFallback: null,
      summaryFailed: false,
      aggregateFailed: false,
      loading: true,
    })
    const live = createLiveChoiceResource(cold)
    const capturedByOverlay = live
    const notified = vi.fn()
    const unsubscribe = subscribeLiveChoiceResource(capturedByOverlay, notified)
    const onPreparedVersion = vi.fn()

    await prepareLiveSheetChoiceResourceForOpen({
      resource: live,
      setCode: 'equipment_mode',
      columnVersion: 7,
      refetchSummary: async () => summary('equipment_mode', 8),
      fetchAggregate: async (version) => aggregate('equipment_mode', version),
      onPreparedVersion,
    })

    expect(capturedByOverlay).toBe(live)
    expect(getLiveChoiceResourceSnapshot(capturedByOverlay)).toEqual(
      expect.objectContaining({
        targetVersion: 8,
        summaryVersion: 8,
        selectionReady: true,
        selectableAggregate: expect.objectContaining({ version: 8 }),
      }),
    )
    expect(capturedByOverlay.displayAggregate?.items).toEqual(
      aggregate('equipment_mode', 8).items,
    )
    expect(capturedByOverlay.selectionReady).toBe(true)
    expect(notified).toHaveBeenCalledOnce()
    expect(onPreparedVersion).toHaveBeenCalledWith(8)
    unsubscribe()
  })

  it('does not expose a staged render snapshot until its exact commit callback runs', () => {
    const live = createLiveChoiceResource(
      deriveSheetChoiceResource({
        setCode: 'equipment_mode',
        columnVersion: 7,
        summary: summary('equipment_mode', 7),
        targetAggregate: aggregate('equipment_mode', 7),
        displayFallback: null,
        summaryFailed: false,
        aggregateFailed: false,
        loading: false,
      }),
    )
    const versionEight = deriveSheetChoiceResource({
      setCode: 'equipment_mode',
      columnVersion: 8,
      summary: summary('equipment_mode', 8),
      targetAggregate: aggregate('equipment_mode', 8),
      displayFallback: null,
      summaryFailed: false,
      aggregateFailed: false,
      loading: false,
    })

    const commitVersionEight = stageLiveChoiceResource(live, versionEight)

    // An abandoned render never calls its commit callback.
    expect(getLiveChoiceResourceSnapshot(live).targetVersion).toBe(7)
    expect(live.targetVersion).toBe(7)

    expect(commitVersionEight()).toBe(true)
    expect(getLiveChoiceResourceSnapshot(live).targetVersion).toBe(8)
    expect(hookSource).toContain('resourceCommits.push(stageLiveChoiceResource(')
    expect(hookSource).toContain('useIsomorphicLayoutEffect')
  })

  it('ignores a delayed v7 editor-open result after v8 has already been published', async () => {
    const live = createLiveChoiceResource(
      deriveSheetChoiceResource({
        setCode: 'equipment_mode',
        columnVersion: 7,
        summary: summary('equipment_mode', 7),
        targetAggregate: aggregate('equipment_mode', 7),
        displayFallback: null,
        summaryFailed: false,
        aggregateFailed: false,
        loading: false,
      }),
    )
    let releaseV7!: () => void
    const delayedV7 = new Promise<ChoiceSetSummaryOut>((resolve) => {
      releaseV7 = () => resolve(summary('equipment_mode', 7))
    })
    const lateOpen = prepareLiveSheetChoiceResourceForOpen({
      resource: live,
      setCode: 'equipment_mode',
      columnVersion: 7,
      refetchSummary: () => delayedV7,
      fetchAggregate: async (version) => aggregate('equipment_mode', version),
    })
    const versionEight = deriveSheetChoiceResource({
      setCode: 'equipment_mode',
      columnVersion: 8,
      summary: summary('equipment_mode', 8),
      targetAggregate: aggregate('equipment_mode', 8),
      displayFallback: null,
      summaryFailed: false,
      aggregateFailed: false,
      loading: false,
    })
    publishLiveChoiceResource(live, versionEight)

    releaseV7()
    await lateOpen

    expect(live.targetVersion).toBe(8)
    expect(live.summaryVersion).toBe(8)
    expect(live.selectableAggregate?.version).toBe(8)
  })

  it('does not let an older same-version open undo a newer mandatory-refresh failure', async () => {
    const versionEight = deriveSheetChoiceResource({
      setCode: 'equipment_mode',
      columnVersion: 8,
      summary: summary('equipment_mode', 8),
      targetAggregate: aggregate('equipment_mode', 8),
      displayFallback: null,
      summaryFailed: false,
      aggregateFailed: false,
      loading: false,
    })
    const live = createLiveChoiceResource(versionEight)
    let releaseOlderAggregate!: () => void
    let olderAggregateRequested!: () => void
    const olderAggregateStarted = new Promise<void>((resolve) => {
      olderAggregateRequested = resolve
    })
    const olderAggregate = new Promise<ChoiceOptionAggregate>((resolve) => {
      releaseOlderAggregate = () => resolve(aggregate('equipment_mode', 8))
    })
    const olderOpen = prepareLiveSheetChoiceResourceForOpen({
      resource: live,
      setCode: 'equipment_mode',
      columnVersion: 8,
      refetchSummary: async () => summary('equipment_mode', 8),
      fetchAggregate: async () => {
        olderAggregateRequested()
        return olderAggregate
      },
    })
    await olderAggregateStarted

    await expect(
      prepareLiveSheetChoiceResourceForOpen({
        resource: live,
        setCode: 'equipment_mode',
        columnVersion: 8,
        refetchSummary: async () => {
          throw new Error('network failed')
        },
        fetchAggregate: async (version) => aggregate('equipment_mode', version),
      }),
    ).rejects.toThrow('network failed')

    publishLiveChoiceResource(
      live,
      deriveSheetChoiceResource({
        setCode: 'equipment_mode',
        columnVersion: 8,
        summary: null,
        targetAggregate: aggregate('equipment_mode', 8),
        displayFallback: aggregate('equipment_mode', 8),
        summaryFailed: true,
        aggregateFailed: false,
        loading: false,
        error: 'network failed',
      }),
    )
    releaseOlderAggregate()
    await olderOpen

    expect(live.summaryVersion).toBeNull()
    expect(live.selectionReady).toBe(false)
    expect(live.error).toBe('network failed')
  })

  it('does not replace a healthy v8 publication with an older summary at the same target', () => {
    const versionEight = deriveSheetChoiceResource({
      setCode: 'equipment_mode',
      columnVersion: 8,
      summary: summary('equipment_mode', 8),
      targetAggregate: aggregate('equipment_mode', 8),
      displayFallback: null,
      summaryFailed: false,
      aggregateFailed: false,
      loading: false,
    })
    const live = createLiveChoiceResource(versionEight)
    const notified = vi.fn()
    subscribeLiveChoiceResource(live, notified)
    const staleSummary = deriveSheetChoiceResource({
      setCode: 'equipment_mode',
      columnVersion: 8,
      summary: summary('equipment_mode', 7),
      targetAggregate: aggregate('equipment_mode', 8),
      displayFallback: null,
      summaryFailed: false,
      aggregateFailed: false,
      loading: false,
    })

    expect(publishLiveChoiceResource(live, staleSummary)).toBe(false)
    expect(live.summaryVersion).toBe(8)
    expect(live.selectionReady).toBe(true)
    expect(notified).not.toHaveBeenCalled()
  })
})
