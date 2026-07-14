import { describe, expect, it } from 'vitest'

import {
  filterChoiceOptions,
  getVisibleChoiceWindow,
  initialChoiceState,
  reduceChoiceState,
  settleChoiceOpenGeneration,
  shouldPrepareChoiceOnMount,
} from './searchableChoiceState'

const options = [
  { code: 'FOUNDRY', label: 'Foundry', sort_order: 10, is_active: true },
  { code: 'SPECIAL', label: 'Special customer', sort_order: 20, is_active: true },
  { code: 'OLD', label: 'Legacy', sort_order: 30, is_active: false },
]

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('searchable choice state', () => {
  it('searches code and label case-insensitively and excludes inactive writes by default', () => {
    expect(filterChoiceOptions(options, 'found').map((item) => item.code)).toEqual(['FOUNDRY'])
    expect(filterChoiceOptions(options, 'special customer').map((item) => item.code)).toEqual([
      'SPECIAL',
    ])
    expect(filterChoiceOptions(options, '').map((item) => item.code)).toEqual([
      'FOUNDRY',
      'SPECIAL',
    ])
    expect(
      filterChoiceOptions(options, '', { includeInactive: true }).map((item) => item.code),
    ).toEqual(['FOUNDRY', 'SPECIAL', 'OLD'])
  })

  it('filters all results before the rendered window is bounded', () => {
    const many = Array.from({ length: 500 }, (_, index) => ({
      code: `CODE_${String(index).padStart(3, '0')}`,
      label: `Shared label ${index}`,
      is_active: true,
    }))

    expect(filterChoiceOptions(many, 'shared label')).toHaveLength(500)
    expect(getVisibleChoiceWindow(500, 250, 60)).toHaveLength(60)
  })

  it('wraps arrows and supports Home, End, Escape', () => {
    let state = reduceChoiceState(initialChoiceState, { type: 'open', resultCount: 2 })
    state = reduceChoiceState(state, { type: 'move', delta: -1, resultCount: 2 })
    expect(state.activeIndex).toBe(1)
    expect(reduceChoiceState(state, { type: 'home' }).activeIndex).toBe(0)
    expect(reduceChoiceState(state, { type: 'end', resultCount: 2 }).activeIndex).toBe(1)
    expect(reduceChoiceState(state, { type: 'cancel' }).open).toBe(false)
  })

  it('keeps first, middle, and last active descendants in contiguous 60-row windows', () => {
    for (const activeIndex of [0, 250, 499]) {
      const indexes = getVisibleChoiceWindow(500, activeIndex, 60)
      expect(indexes.length).toBeLessThanOrEqual(60)
      expect(indexes).toContain(activeIndex)
      expect(indexes.every((value, index) => index === 0 || value === indexes[index - 1]! + 1)).toBe(
        true,
      )
    }
    expect(getVisibleChoiceWindow(500, 0, 60)).toEqual(
      Array.from({ length: 60 }, (_, index) => index),
    )
    expect(getVisibleChoiceWindow(500, 499, 60)).toEqual(
      Array.from({ length: 60 }, (_, index) => index + 440),
    )
  })

  it('moves active descendants through a large result set without unmounting them', () => {
    let state = reduceChoiceState(initialChoiceState, { type: 'open', resultCount: 500 })
    for (const action of [
      { type: 'end' as const, resultCount: 500 },
      { type: 'move' as const, delta: 1, resultCount: 500 },
      { type: 'home' as const },
      { type: 'move' as const, delta: -1, resultCount: 500 },
    ]) {
      state = reduceChoiceState(state, action)
      expect(getVisibleChoiceWindow(500, state.activeIndex, 60)).toContain(state.activeIndex)
    }
  })

  it('invalidates a pending open so Escape prevents a late resolve from reopening or enabling', async () => {
    const refresh = deferred<void>()
    let state = reduceChoiceState(initialChoiceState, {
      type: 'open',
      resultCount: 2,
      requiresPreparation: true,
    })
    const pending = settleChoiceOpenGeneration(
      state.generation,
      () => refresh.promise,
      (action) => {
        state = reduceChoiceState(state, action)
      },
    )

    state = reduceChoiceState(state, { type: 'cancel' })
    const cancelledGeneration = state.generation
    refresh.resolve()
    await pending

    expect(state.open).toBe(false)
    expect(state.generation).toBe(cancelledGeneration)
    expect(state.readyGeneration).toBeNull()
  })

  it('claims mount preparation only once under repeated development effects', () => {
    expect(shouldPrepareChoiceOnMount(false, true, true)).toBe(true)
    expect(shouldPrepareChoiceOnMount(true, true, true)).toBe(false)
    expect(shouldPrepareChoiceOnMount(false, false, true)).toBe(false)
    expect(shouldPrepareChoiceOnMount(false, true, false)).toBe(false)
  })

  it('catches preparation rejection into retry state and lets only the later generation recover', async () => {
    const failedRefresh = deferred<void>()
    let state = reduceChoiceState(initialChoiceState, {
      type: 'open',
      resultCount: 2,
      requiresPreparation: true,
    })
    const firstGeneration = state.generation
    const failed = settleChoiceOpenGeneration(
      firstGeneration,
      () => failedRefresh.promise,
      (action) => {
        state = reduceChoiceState(state, action)
      },
    )
    failedRefresh.reject(new Error('summary unavailable'))
    await expect(failed).resolves.toBeUndefined()

    expect(state.openError).toBe('summary unavailable')
    expect(state.preparing).toBe(false)
    expect(state.readyGeneration).toBeNull()

    const retryRefresh = deferred<void>()
    state = reduceChoiceState(state, {
      type: 'open',
      resultCount: 2,
      requiresPreparation: true,
    })
    const retryGeneration = state.generation
    expect(retryGeneration).toBeGreaterThan(firstGeneration)
    const retry = settleChoiceOpenGeneration(
      retryGeneration,
      () => retryRefresh.promise,
      (action) => {
        state = reduceChoiceState(state, action)
      },
    )
    retryRefresh.resolve()
    await retry

    expect(state.open).toBe(true)
    expect(state.readyGeneration).toBe(retryGeneration)
    expect(state.openError).toBeNull()
  })

  it('invalidates active commit state when readiness is lost and blocks commit until restored', () => {
    let state = reduceChoiceState(initialChoiceState, { type: 'open', resultCount: 2 })
    expect(state.readyGeneration).toBe(state.generation)

    state = reduceChoiceState(state, { type: 'readiness-lost' })
    expect(state.open).toBe(true)
    expect(state.activeIndex).toBe(-1)
    expect(state.readyGeneration).toBeNull()
    expect(reduceChoiceState(state, { type: 'commit', allowed: false })).toEqual(state)

    state = reduceChoiceState(state, { type: 'readiness-restored', resultCount: 2 })
    expect(state.readyGeneration).toBe(state.generation)
    expect(state.activeIndex).toBe(0)
    expect(reduceChoiceState(state, { type: 'commit', allowed: true }).open).toBe(false)
  })
})
