import { describe, expect, it, vi } from 'vitest'

import type { ChoiceOptionAggregate } from '@/api/types'
import type { SheetChoiceResource } from './types'
import {
  describeChoiceValue,
  finishChoiceEditingWithFocus,
  makeChoiceCell,
} from './choiceCell'
import choiceCellSource from './choiceCell.tsx?raw'

const aggregate: ChoiceOptionAggregate = {
  set_code: 'equipment_mode',
  version: 7,
  items: [
    { code: 'AUTO', label: 'Automatic', sort_order: 0, is_active: true },
    { code: 'OLD', label: 'Old mode', sort_order: 1, is_active: false },
  ],
}

function resource(overrides: Partial<SheetChoiceResource> = {}): SheetChoiceResource {
  return {
    setCode: 'equipment_mode',
    targetVersion: 7,
    summaryVersion: 7,
    setIsActive: true,
    displayAggregate: aggregate,
    selectableAggregate: aggregate,
    selectionReady: true,
    isStale: false,
    loading: false,
    error: null,
    prepareToOpen: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('managed choice cell', () => {
  it('displays the label while copy/save data remains the stable code', () => {
    const shared = resource()
    const cell = makeChoiceCell('AUTO', shared, false)
    expect(cell.copyData).toBe('AUTO')
    expect(cell.data.displayText).toBe('Automatic')
    expect(cell.data.tooltip).toBe('AUTO · Automatic')
    expect(cell.data.resource).toBe(shared)
    expect(cell.data).not.toHaveProperty('options')
  })

  it('opens by the editable single-click/keyboard overlay contract', () => {
    const cell = makeChoiceCell('AUTO', resource(), false)
    expect(cell.activationBehaviorOverride).toBe('single-click')
    expect(cell.allowOverlay).toBe(true)
    expect(cell.readonly).toBe(false)
  })

  it('does not advertise activation for a readonly choice', () => {
    const cell = makeChoiceCell('AUTO', resource(), true)
    expect(cell.activationBehaviorOverride).toBeUndefined()
    expect(cell.readonly).toBe(true)
  })

  it('keeps inactive, raw unknown, and request-error values distinct', () => {
    expect(describeChoiceValue('OLD', resource())).toEqual(
      expect.objectContaining({ kind: 'inactive', displayText: 'Old mode', badge: '사용 중지됨' }),
    )
    expect(describeChoiceValue('RAW', resource())).toEqual(
      expect.objectContaining({ kind: 'raw', displayText: 'RAW' }),
    )
    const failed = resource({ error: '네트워크 오류', displayAggregate: null })
    expect(describeChoiceValue('RAW', failed)).toEqual(
      expect.objectContaining({ kind: 'error', displayText: 'RAW', retry: failed.retry }),
    )
    expect(describeChoiceValue('AUTO', resource({ setIsActive: false }))).toEqual(
      expect.objectContaining({ kind: 'inactive', badge: '사용 중지됨' }),
    )
  })

  it('uses SearchableChoice preparation/filter semantics and never a native select', () => {
    expect(choiceCellSource).toContain('<SearchableChoice')
    expect(choiceCellSource).toContain('useLiveChoiceResource(cell.data.resource)')
    expect(choiceCellSource).toContain('onOpen={resource.prepareToOpen}')
    expect(choiceCellSource).toContain('onRetry={resource.retry}')
    expect(choiceCellSource).toContain('onKeyDown={(event)')
    expect(choiceCellSource).toContain('event.stopPropagation()')
    expect(choiceCellSource).toContain('styleOverride: { minWidth: 320, minHeight: 320 }')
    expect(choiceCellSource).not.toMatch(/<select\b/)
  })

  it.each(['commit', 'cancel'] as const)(
    'restores canvas focus after the overlay input refocuses on %s',
    (kind) => {
      const calls: string[] = []
      const scheduled: Array<() => void> = []
      const finish = vi.fn(() => calls.push('glide-finished'))
      const restoreGridFocus = vi.fn(() => calls.push('grid-focused'))

      finishChoiceEditingWithFocus(
        finish,
        kind === 'commit' ? makeChoiceCell('AUTO', resource(), false) : undefined,
        restoreGridFocus,
        (callback) => scheduled.push(callback),
      )
      // SearchableChoice synchronously focuses its input after onChange/onCancel returns.
      calls.push('overlay-input-refocused')
      expect(calls).toEqual(['glide-finished', 'overlay-input-refocused'])

      scheduled[0]?.()
      expect(calls).toEqual([
        'glide-finished',
        'overlay-input-refocused',
        'grid-focused',
      ])
      expect(restoreGridFocus).toHaveBeenCalledOnce()
    },
  )

  it('passes one adapter-owned focus callback through every choice cell payload', () => {
    const restoreGridFocus = vi.fn()
    const cell = makeChoiceCell('AUTO', resource(), false, undefined, restoreGridFocus)
    expect(cell.data.restoreGridFocus).toBe(restoreGridFocus)
    expect(choiceCellSource).toContain('finishChoiceEditingWithFocus(')
  })
})
