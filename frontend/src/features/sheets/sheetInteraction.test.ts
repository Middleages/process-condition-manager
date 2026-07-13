import { describe, expect, it } from 'vitest'

import { resolveSheetInteraction } from './sheetInteraction'

describe('resolveSheetInteraction', () => {
  it.each([
    [false, false, false, 'editable', true, false],
    [false, true, false, 'write-busy', false, false],
    [true, false, false, 'read-only', false, false],
    [true, true, false, 'read-only', false, false],
    [false, false, true, 'paste-review', false, true],
    [false, true, true, 'paste-review', false, false],
    [true, false, true, 'paste-review', false, false],
    [true, true, true, 'paste-review', false, false],
  ] as const)(
    'resolves readOnly=%s writeBusy=%s hasPaste=%s as %s',
    (readOnly, writeBusy, hasPaste, mode, canEditCells, canApplyPaste) => {
      const policy = resolveSheetInteraction({ readOnly, writeBusy, hasPaste })

      expect(policy.mode).toBe(mode)
      expect(policy.canEditCells).toBe(canEditCells)
      expect(policy.canApplyPaste).toBe(canApplyPaste)
      expect(policy.canCancelPaste).toBe(hasPaste)
      expect(policy.canSwitchCategory).toBe(!hasPaste)
      if (mode !== 'editable') {
        expect(policy.canStagePaste).toBe(false)
        expect(policy.canManageConditions).toBe(false)
        expect(policy.canTransferPor).toBe(false)
      }
    },
  )

  it('allows mutations only while the held session is idle', () => {
    expect(
      resolveSheetInteraction({ readOnly: false, writeBusy: false, hasPaste: false }),
    ).toEqual({
      mode: 'editable',
      canEditCells: true,
      canStagePaste: true,
      canSwitchCategory: true,
      canManageConditions: true,
      canTransferPor: true,
      canApplyPaste: false,
      canCancelPaste: false,
    })
  })

  it('makes paste review exclusive', () => {
    expect(
      resolveSheetInteraction({ readOnly: false, writeBusy: false, hasPaste: true }),
    ).toEqual({
      mode: 'paste-review',
      canEditCells: false,
      canStagePaste: false,
      canSwitchCategory: false,
      canManageConditions: false,
      canTransferPor: false,
      canApplyPaste: true,
      canCancelPaste: true,
    })
  })

  it('keeps cancel but blocks apply after lock loss during review', () => {
    const policy = resolveSheetInteraction({ readOnly: true, writeBusy: false, hasPaste: true })

    expect(policy.mode).toBe('paste-review')
    expect(policy.canApplyPaste).toBe(false)
    expect(policy.canCancelPaste).toBe(true)
  })

  it('keeps cancel but blocks apply while the reviewed paste is being written', () => {
    const policy = resolveSheetInteraction({ readOnly: false, writeBusy: true, hasPaste: true })

    expect(policy.mode).toBe('paste-review')
    expect(policy.canApplyPaste).toBe(false)
    expect(policy.canCancelPaste).toBe(true)
  })

  it.each([
    {
      input: { readOnly: true, writeBusy: false, hasPaste: false },
      mode: 'read-only' as const,
    },
    {
      input: { readOnly: false, writeBusy: true, hasPaste: false },
      mode: 'write-busy' as const,
    },
  ])('blocks every data mutation in $mode mode while preserving discovery', ({ input, mode }) => {
    const policy = resolveSheetInteraction(input)

    expect(policy).toMatchObject({
      mode,
      canEditCells: false,
      canStagePaste: false,
      canSwitchCategory: true,
      canManageConditions: false,
      canTransferPor: false,
      canApplyPaste: false,
      canCancelPaste: false,
    })
  })
})
