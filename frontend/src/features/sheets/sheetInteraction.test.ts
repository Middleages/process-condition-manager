import { describe, expect, it, vi } from 'vitest'

import { commitPasteCallbackRuntime, isCurrentPasteCallback } from '@/grid/model'

import { resolveSheetInteraction } from './sheetInteraction'

interface DeferredPasteRuntime {
  generation: symbol
  interaction: ReturnType<typeof resolveSheetInteraction>
  hasPaste: boolean
}

function retainDeferredPaste(
  snapshotGeneration: symbol,
  runtime: { current: DeferredPasteRuntime },
  setPaste: () => void,
): () => void {
  return () => {
    const current = runtime.current
    if (
      !isCurrentPasteCallback(
        snapshotGeneration,
        current.generation,
        current.interaction.canStagePaste,
      ) ||
      current.hasPaste
    ) {
      return
    }
    setPaste()
  }
}

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

describe('deferred paste callback guard', () => {
  const editable = resolveSheetInteraction({ readOnly: false, writeBusy: false, hasPaste: false })

  it('allows a resolved callback only in the same editable generation', () => {
    const generation = Symbol('same category')
    const runtime = { current: { generation, interaction: editable, hasPaste: false } }
    const setPaste = vi.fn()

    retainDeferredPaste(generation, runtime, setPaste)()

    expect(setPaste).toHaveBeenCalledOnce()
  })

  it('keeps the committed callback valid when a newer render snapshot is abandoned', () => {
    const generation = Symbol('committed category')
    const runtime = { current: { generation, interaction: editable, hasPaste: false } }
    const setPaste = vi.fn()
    const retained = retainDeferredPaste(generation, runtime, setPaste)

    // Concurrent render에서 만들어졌지만 commit되지 않은 문맥. production은 layout effect에서만
    // commitPasteCallbackRuntime을 호출하므로 이 snapshot은 현재 runtime을 바꾸지 않는다.
    const abandonedSnapshot = {
      generation: Symbol('abandoned category'),
      interaction: resolveSheetInteraction({ readOnly: true, writeBusy: false, hasPaste: false }),
      hasPaste: false,
    }
    expect(abandonedSnapshot.generation).not.toBe(runtime.current.generation)
    retained()

    expect(runtime.current.generation).toBe(generation)
    expect(setPaste).toHaveBeenCalledOnce()
  })

  it.each([
    ['lock loss', resolveSheetInteraction({ readOnly: true, writeBusy: false, hasPaste: false })],
    ['write busy', resolveSheetInteraction({ readOnly: false, writeBusy: true, hasPaste: false })],
  ])('rejects a callback retained across %s before staging', (_label, interaction) => {
    const generation = Symbol('original editable')
    const runtime = { current: { generation, interaction: editable, hasPaste: false } }
    const setPaste = vi.fn()
    const retained = retainDeferredPaste(generation, runtime, setPaste)

    commitPasteCallbackRuntime(runtime, {
      generation: Symbol('policy changed'),
      interaction,
      hasPaste: false,
    })
    retained()

    expect(setPaste).not.toHaveBeenCalled()
  })

  it('rejects a callback retained across a category/visible-column generation change', () => {
    const generation = Symbol('photo columns')
    const runtime = { current: { generation, interaction: editable, hasPaste: false } }
    const setPaste = vi.fn()
    const retained = retainDeferredPaste(generation, runtime, setPaste)

    commitPasteCallbackRuntime(runtime, {
      generation: Symbol('etch columns'),
      interaction: editable,
      hasPaste: false,
    })
    retained()

    expect(setPaste).not.toHaveBeenCalled()
  })

  it('does not revive an old callback after a blocked policy returns to editable', () => {
    const generation = Symbol('before busy')
    const runtime = { current: { generation, interaction: editable, hasPaste: false } }
    const setPaste = vi.fn()
    const retained = retainDeferredPaste(generation, runtime, setPaste)

    commitPasteCallbackRuntime(runtime, {
      generation: Symbol('after busy'),
      interaction: editable,
      hasPaste: false,
    })
    retained()

    expect(setPaste).not.toHaveBeenCalled()
  })
})
