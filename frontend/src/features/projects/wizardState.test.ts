import { describe, expect, it } from 'vitest'

import {
  getCreateDisabledReason,
  previewFingerprint,
  selectBackbone,
  selectProcess,
  toManualOverrides,
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
