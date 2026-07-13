import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAutosaveEngine, type SaveState } from './autosave'

const DEBOUNCE = 3000
const BACKOFF = 500
const MAX_RETRIES = 3

interface Control {
  pending: boolean
}

/** 공통 엔진 하네스: flush/isFatal 주입, 상태 전이 기록, hasPending 제어. */
function harness(opts: { flush?: (control: Control) => Promise<void>; isFatal?: (error: unknown) => boolean } = {}) {
  const control: Control = { pending: true }
  const states: SaveState[] = []
  const flush = vi.fn(opts.flush ? () => opts.flush!(control) : async () => {})
  const engine = createAutosaveEngine({
    debounceMs: DEBOUNCE,
    backoffMs: BACKOFF,
    maxRetries: MAX_RETRIES,
    flush,
    hasPending: () => control.pending,
    onStateChange: (state) => states.push(state),
    isFatal: opts.isFatal,
  })
  return { engine, flush, states, control }
}

describe('createAutosaveEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces multiple schedule() calls into a single flush', async () => {
    const { engine, flush } = harness()
    engine.schedule()
    await vi.advanceTimersByTimeAsync(1000)
    engine.schedule() // 디바운스 리셋
    await vi.advanceTimersByTimeAsync(1000)
    engine.schedule()
    expect(flush).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('transitions saving -> saved on a successful flush', async () => {
    const { engine, flush, states } = harness({
      flush: async (control) => {
        control.pending = false // markSaved 시뮬레이션
      },
    })
    engine.schedule()
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(states).toEqual(['saving', 'saved'])
    expect(engine.getState()).toBe('saved')
  })

  it('flushNow saves immediately, bypassing the debounce', async () => {
    const { engine, flush } = harness({
      flush: async (control) => {
        control.pending = false
      },
    })
    engine.schedule() // 디바운스 타이머 설정
    await engine.flushNow() // 즉시 실행(디바운스 취소)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(engine.getState()).toBe('saved')
    await vi.advanceTimersByTimeAsync(DEBOUNCE) // 취소된 디바운스는 재발화 없음
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('flushNow waits for an in-flight save and immediately drains newer edits', async () => {
    let version = 1
    let savedVersion = 0
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const flush = vi.fn(async () => {
      const snapshot = version
      if (snapshot === 1) await firstGate
      savedVersion = snapshot
    })
    const engine = createAutosaveEngine({
      debounceMs: DEBOUNCE,
      backoffMs: BACKOFF,
      maxRetries: MAX_RETRIES,
      flush,
      hasPending: () => savedVersion < version,
    })

    engine.schedule()
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(flush).toHaveBeenCalledTimes(1)

    version = 2 // 첫 저장 snapshot 이후 도착한 편집
    let forceFinished = false
    const forced = engine.flushNow().then(() => {
      forceFinished = true
    })
    await Promise.resolve()
    expect(forceFinished).toBe(false)

    releaseFirst?.()
    await forced
    expect(flush).toHaveBeenCalledTimes(2)
    expect(savedVersion).toBe(2)
    expect(engine.getState()).toBe('saved')
  })

  it('flushNow rejects when persistence fails so a structural caller can abort', async () => {
    const { engine } = harness({
      flush: async () => {
        throw new Error('network down')
      },
    })

    await expect(engine.flushNow()).rejects.toThrow('network down')
  })

  it('retries with exponential backoff, then gives up as error', async () => {
    const { engine, flush, states } = harness({
      flush: async () => {
        throw new Error('boom') // 항상 실패, pending 유지
      },
    })
    await expect(engine.flushNow()).rejects.toThrow('boom') // 1차 시도
    expect(flush).toHaveBeenCalledTimes(1)
    expect(engine.getState()).toBe('saving')
    await vi.advanceTimersByTimeAsync(BACKOFF) // 재시도 1 (500)
    expect(flush).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(BACKOFF * 2) // 재시도 2 (1000)
    expect(flush).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(BACKOFF * 4) // 재시도 3 (2000)
    expect(flush).toHaveBeenCalledTimes(4) // 총 4회 = 1 + 최대 3회 재시도
    expect(engine.getState()).toBe('error')
    expect(states).toContain('error')
  })

  it('does not retry on a fatal error (lock lost)', async () => {
    class Fatal extends Error {}
    const { engine, flush, states } = harness({
      flush: async () => {
        throw new Fatal()
      },
      isFatal: (error) => error instanceof Fatal,
    })
    await expect(engine.flushNow()).rejects.toBeInstanceOf(Fatal)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(engine.getState()).toBe('idle') // 재시도 없이 중단
    await vi.advanceTimersByTimeAsync(10_000)
    expect(flush).toHaveBeenCalledTimes(1) // 추가 재시도 없음
    expect(states).toEqual(['saving', 'idle'])
  })

  it('retry() re-attempts after giving up, and can succeed', async () => {
    let mode: 'fail' | 'ok' = 'fail'
    const control: Control = { pending: true }
    const flush = vi.fn(async () => {
      if (mode === 'fail') throw new Error('boom')
      control.pending = false
    })
    const engine = createAutosaveEngine({
      debounceMs: DEBOUNCE,
      backoffMs: BACKOFF,
      maxRetries: MAX_RETRIES,
      flush,
      hasPending: () => control.pending,
    })

    await expect(engine.flushNow()).rejects.toThrow('boom')
    await vi.advanceTimersByTimeAsync(BACKOFF)
    await vi.advanceTimersByTimeAsync(BACKOFF * 2)
    await vi.advanceTimersByTimeAsync(BACKOFF * 4)
    expect(engine.getState()).toBe('error')
    expect(flush).toHaveBeenCalledTimes(4)

    mode = 'ok'
    engine.retry()
    await vi.advanceTimersByTimeAsync(0) // 즉시 재시도 마이크로태스크 소진
    expect(flush).toHaveBeenCalledTimes(5)
    expect(engine.getState()).toBe('saved')
  })

  it('cancel() clears pending timers and returns to idle', async () => {
    const { engine, flush } = harness()
    engine.schedule()
    engine.cancel()
    expect(engine.getState()).toBe('idle')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(flush).not.toHaveBeenCalled()
  })
})
