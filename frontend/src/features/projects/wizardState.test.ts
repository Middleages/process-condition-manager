import { describe, expect, it, vi } from 'vitest'

import {
  getProjectCreateRouteReconciliation,
  getCreateDisabledReason,
  getManualOverrideDefaultLabel,
  invalidateProjectCreationQueries,
  isWizardInteractionLocked,
  previewFingerprint,
  selectBackbone,
  selectProcess,
  shouldApplyRouteReconciliation,
  toManualOverrides,
  updateManualOverride,
  type CreateGuardState,
} from './wizardState'

describe('wizard dependent state', () => {
  it('clears backbone and overrides only when Process changes', () => {
    const current = { processKey: 'A::P', backboneId: 7, overrides: { L2: 'S2' } }

    expect(selectProcess(current, 'A::P')).toEqual(current)
    expect(selectProcess(current, 'B::P')).toEqual({
      processKey: 'B::P',
      backboneId: null,
      overrides: {},
    })
  })

  it('clears overrides only when backbone changes', () => {
    const current = { processKey: 'A::P', backboneId: 7, overrides: { L2: 'S2' } }

    expect(selectBackbone(current, 7)).toEqual(current)
    expect(selectBackbone(current, null)).toEqual({
      processKey: 'A::P',
      backboneId: null,
      overrides: {},
    })
  })

  it('sorts manual overrides before fingerprinting', () => {
    expect(toManualOverrides({ Z: '2', A: '1' })).toEqual([
      { target_layer_key: 'A', source_layer_key: '1' },
      { target_layer_key: 'Z', source_layer_key: '2' },
    ])
    expect(previewFingerprint('A::P', null, { Z: '2', A: '1' })).toBe(
      previewFingerprint('A::P', null, { A: '1', Z: '2' }),
    )
  })

  it('omits blank manual override sources', () => {
    expect(toManualOverrides({ EMPTY: '', TARGET: 'SOURCE' })).toEqual([
      { target_layer_key: 'TARGET', source_layer_key: 'SOURCE' },
    ])
  })

  it('returns an automatic match after a manual override is cleared', () => {
    const targetLayerKey = '4::ETCH'

    expect(
      getManualOverrideDefaultLabel({
        matchType: 'auto',
        sourceLayerKey: 'SOURCE::AUTO',
        baselineAutomaticSource: null,
      }),
    ).toBe('자동 매칭 유지 · SOURCE::AUTO')

    const overridden = updateManualOverride({}, targetLayerKey, 'SOURCE::MANUAL')
    expect(toManualOverrides(overridden)).toEqual([
      { target_layer_key: targetLayerKey, source_layer_key: 'SOURCE::MANUAL' },
    ])
    expect(
      getManualOverrideDefaultLabel({
        matchType: 'manual',
        sourceLayerKey: 'SOURCE::MANUAL',
        baselineAutomaticSource: 'SOURCE::AUTO',
      }),
    ).toBe('수동 매칭 해제 · 자동 규칙 재적용 · SOURCE::AUTO')

    const cleared = updateManualOverride(overridden, targetLayerKey, '')
    expect(cleared).toEqual({})
    expect(toManualOverrides(cleared)).toEqual([])
  })

  it('describes blank only when clearing cannot restore an automatic match', () => {
    expect(
      getManualOverrideDefaultLabel({
        matchType: 'manual',
        sourceLayerKey: 'SOURCE::MANUAL',
        baselineAutomaticSource: null,
      }),
    ).toBe('수동 매칭 해제 · 빈 값')
    expect(
      getManualOverrideDefaultLabel({
        matchType: 'unmatched',
        sourceLayerKey: null,
        baselineAutomaticSource: null,
      }),
    ).toBe('미매칭 · 빈 값')
  })
})

describe('project create guard', () => {
  const ready: CreateGuardState = {
    processKey: 'A::P',
    processIsPending: false,
    processIsError: false,
    processHasProject: false,
    backboneId: null,
    backboneIsPending: false,
    backboneIsError: false,
    previewIsPending: false,
    previewIsFetching: false,
    previewIsError: false,
    previewFingerprint: previewFingerprint('A::P', null, {}),
    currentFingerprint: previewFingerprint('A::P', null, {}),
    requiredFieldsComplete: true,
    isSubmitting: false,
  }

  it.each([
    ['a missing Process', { processKey: null }, 'process-missing'],
    ['a loading Process', { processIsPending: true }, 'process-loading'],
    ['a missing or 404 Process detail', { processIsError: true }, 'process-invalid'],
    ['a Process with an existing project', { processHasProject: true }, 'duplicate-process'],
    ['a loading selected backbone', { backboneId: 7, backboneIsPending: true }, 'backbone-loading'],
    ['a deleted selected backbone', { backboneId: 7, backboneIsError: true }, 'backbone-invalid'],
    ['a pending preview', { previewIsPending: true, previewFingerprint: null }, 'preview-loading'],
    ['a fetching preview', { previewIsFetching: true }, 'preview-loading'],
    ['a failed preview', { previewIsError: true, previewFingerprint: null }, 'preview-error'],
    [
      'a stale preview',
      { previewFingerprint: previewFingerprint('A::P', null, { L2: 'OLD' }) },
      'preview-stale',
    ],
    ['blank required fields', { requiredFieldsComplete: false }, 'required-fields'],
    ['a pending mutation', { isSubmitting: true }, 'submitting'],
  ] as const)('blocks creation for %s', (_label, patch, reason) => {
    expect(getCreateDisabledReason({ ...ready, ...patch })).toBe(reason)
  })

  it('allows an empty candidate path with a null backbone', () => {
    expect(getCreateDisabledReason(ready)).toBeNull()
  })
})

describe('project create route reconciliation', () => {
  it('normalizes one deleted backbone only once for repeated error renders', () => {
    const reconciliation = getProjectCreateRouteReconciliation({
      routeState: { step: 3, processKey: 'A::P', backboneId: 999 },
      processNotFound: false,
      processHasProject: false,
      backboneNotFound: true,
    })

    expect(reconciliation).toEqual({
      key: 'backbone:999:not-found',
      kind: 'backbone',
      routeState: { step: 2, processKey: 'A::P', backboneId: null },
    })
    expect(shouldApplyRouteReconciliation(null, reconciliation!.key)).toBe(true)
    expect(shouldApplyRouteReconciliation(reconciliation!.key, reconciliation!.key)).toBe(false)
  })

  it('prioritizes a missing Process over a simultaneous missing backbone', () => {
    expect(
      getProjectCreateRouteReconciliation({
        routeState: { step: 3, processKey: 'A::P', backboneId: 999 },
        processNotFound: true,
        processHasProject: false,
        backboneNotFound: true,
      }),
    ).toEqual({
      key: 'process:A::P:not-found',
      kind: 'process',
      routeState: { step: 1, processKey: 'A::P', backboneId: null },
    })
  })

  it.each([
    ['missing', true, false, 'process:A::P:not-found'],
    ['duplicate', false, true, 'process:A::P:duplicate'],
  ] as const)(
    'keeps a %s Process at step one when a cached backbone error also exists',
    (_label, processNotFound, processHasProject, key) => {
      expect(
        getProjectCreateRouteReconciliation({
          routeState: { step: 1, processKey: 'A::P', backboneId: 999 },
          processNotFound,
          processHasProject,
          backboneNotFound: true,
        }),
      ).toEqual({
        key,
        kind: 'process',
        routeState: { step: 1, processKey: 'A::P', backboneId: null },
      })
    },
  )

  it('clears an orphaned backbone instead of advancing a missing Process', () => {
    expect(
      getProjectCreateRouteReconciliation({
        routeState: { step: 1, processKey: null, backboneId: 999 },
        processNotFound: false,
        processHasProject: false,
        backboneNotFound: true,
      }),
    ).toEqual({
      key: 'process:missing',
      kind: 'process',
      routeState: { step: 1, processKey: null, backboneId: null },
    })
  })

  it('reapplies a retained Process error after revisiting a later step', () => {
    let appliedKey: string | null = null
    const invalidRoute = { step: 3, processKey: 'A::P', backboneId: null } as const
    const first = getProjectCreateRouteReconciliation({
      routeState: invalidRoute,
      processNotFound: true,
      processHasProject: false,
      backboneNotFound: false,
    })

    expect(first).not.toBeNull()
    expect(shouldApplyRouteReconciliation(appliedKey, first!.key)).toBe(true)
    appliedKey = first!.key

    const normalized = getProjectCreateRouteReconciliation({
      routeState: first!.routeState,
      processNotFound: true,
      processHasProject: false,
      backboneNotFound: false,
    })
    expect(normalized).toBeNull()
    if (normalized === null) appliedKey = null

    const revisited = getProjectCreateRouteReconciliation({
      routeState: invalidRoute,
      processNotFound: true,
      processHasProject: false,
      backboneNotFound: false,
    })
    expect(shouldApplyRouteReconciliation(appliedKey, revisited!.key)).toBe(true)
  })

  it('does not normalize transient entity failures', () => {
    expect(
      getProjectCreateRouteReconciliation({
        routeState: { step: 3, processKey: 'A::P', backboneId: 999 },
        processNotFound: false,
        processHasProject: false,
        backboneNotFound: false,
      }),
    ).toBeNull()
  })
})

describe('project creation mutation boundaries', () => {
  it('keeps interaction locked when a deferred mutation observer temporarily appears idle', () => {
    expect(
      isWizardInteractionLocked({
        submitLatched: true,
        mutationPending: false,
        completionPending: false,
      }),
    ).toBe(true)
  })

  it('invalidates every Process cache that could preserve a stale D-17 decision', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined)

    await invalidateProjectCreationQueries(
      { invalidateQueries },
      { key: 'L1::PROC_ALPHA', line_id: 'L1', process_id: 'PROC_ALPHA' },
    )

    expect(invalidateQueries.mock.calls.map(([options]) => options.queryKey)).toEqual([
      ['projects'],
      ['process', 'L1::PROC_ALPHA'],
      ['processes', 'picker'],
      ['process-catalog'],
      ['backbone-candidates', 'L1', 'PROC_ALPHA'],
    ])
  })
})
