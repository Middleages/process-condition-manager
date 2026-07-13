/**
 * 자동저장 스케줄러 (프레임워크 무관 순수 엔진).
 *
 * 더티 발생 → 유휴 디바운스 → flush(실제 저장) → 실패 시 지수 백오프 재시도(최대 N회) →
 * 포기하면 error 상태. React/네트워크/스토어를 전혀 모른다. `flush`/`hasPending`를 주입받아
 * 타이밍과 상태 전이만 관리하므로 `vi.useFakeTimers()`로 결정적으로 단위 테스트한다.
 * React 훅(useSheetEditing)은 이 엔진을 배선하기만 한다.
 *
 * 상태:
 * - idle : 저장할 것이 없거나 디바운스 대기(더티 개수는 별도로 표시).
 * - saving : 저장 요청 진행 중 또는 재시도 백오프 대기.
 * - saved : 마지막 저장 성공, 남은 더티 없음.
 * - error : 재시도 소진 후 포기 — 배너 + 수동 재시도 필요(더티는 보존).
 */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface AutosaveEngineOptions {
  /** 유휴 디바운스(ms). 더티가 멈춘 뒤 이 시간이 지나면 저장. */
  debounceMs: number
  /** 재시도 기본 백오프(ms). 지수: backoffMs * 2^(attempt-1). */
  backoffMs: number
  /** 최대 재시도 횟수(최초 시도 제외). 총 시도 = 1 + maxRetries. */
  maxRetries: number
  /** 실제 저장. 호출자가 patchCells + markSaved까지 수행한다. 실패 시 reject. */
  flush: () => Promise<void>
  /** 저장할 더티가 남아있는지. 저장 후 재실행/‘saved’ 판정에 쓴다. */
  hasPending: () => boolean
  /** 상태 전이 알림(중복 없이 변경 시에만). */
  onStateChange?: (state: SaveState) => void
  /**
   * 치명적(재시도 불가) 오류 판별. true면 재시도 없이 즉시 중단하고 idle로 돌아간다.
   * 예: 잠금 상실(409) — 상위가 별도 UI로 처리하므로 저장 재시도는 무의미.
   */
  isFatal?: (error: unknown) => boolean
}

export interface AutosaveEngine {
  /** 더티 발생 시 호출 — 디바운스 재시작. */
  schedule(): void
  /** 즉시 저장(디바운스 우회). 언마운트 flush/수동 저장용. */
  flushNow(): Promise<void>
  /** 수동 재시도(error 상태에서 재시도 카운트 리셋 후 즉시 저장). */
  retry(): void
  /** 대기 타이머 정리 + idle. 변경 취소/잠금 상실 시 자동저장 중단(더티는 호출자가 관리). */
  cancel(): void
  /** 현재 상태(테스트/진단용). */
  getState(): SaveState
}

export function createAutosaveEngine(options: AutosaveEngineOptions): AutosaveEngine {
  const { debounceMs, backoffMs, maxRetries, flush, hasPending, onStateChange, isFatal } = options

  let timer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0 // 연속 실패 횟수
  // 진행 중인 저장 Promise 자체를 보관한다. 구조 변경/언마운트의 flushNow가 단순히
  // "저장 중" 플래그만 보고 지나가지 않고 실제 네트워크 완료까지 기다리기 위함이다.
  let inFlight: Promise<void> | null = null
  let state: SaveState = 'idle'

  function setState(next: SaveState): void {
    if (next === state) return
    state = next
    onStateChange?.(next)
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function scheduleIn(delayMs: number): void {
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      // 백그라운드 자동저장은 상태/재시도 타이머로 실패를 알린다. 호출자가 없는 Promise의
      // rejection만 소비하고, flushNow 호출에는 같은 실패를 그대로 전파한다.
      void run().catch(() => undefined)
    }, delayMs)
  }

  function schedule(): void {
    // 새 편집이 들어오면 앞선 종결 상태(saved/error)를 지운다. 저장 중(saving)은 유지(깜빡임 방지).
    if (state === 'error') {
      attempts = 0
      setState('idle')
    } else if (state === 'saved') {
      setState('idle')
    }
    scheduleIn(debounceMs)
  }

  function run(): Promise<void> {
    clearTimer()
    if (inFlight !== null) return inFlight
    if (!hasPending()) {
      if (state !== 'idle') setState('saved')
      return Promise.resolve()
    }

    setState('saving')
    const current = flush()
      .then(() => {
          attempts = 0
          if (hasPending()) {
            scheduleIn(debounceMs) // 저장 중 도착한 새 편집 → 다시 저장
          } else {
            setState('saved')
          }
      })
      .catch((error: unknown) => {
        if (isFatal?.(error) === true) {
          setState('idle') // 재시도 중단 — 상위가 잠금 상실 등 별도 처리
        } else {
          attempts += 1
          if (attempts <= maxRetries) {
            setState('saving') // 재시도 대기(스피너 유지)
            scheduleIn(backoffMs * 2 ** (attempts - 1))
          } else {
            setState('error') // 포기 — 배너 + 수동 재시도
          }
        }
        throw error
      })
      .finally(() => {
        if (inFlight === current) inFlight = null
      })
    inFlight = current
    return current
  }

  return {
    schedule,
    async flushNow(): Promise<void> {
      clearTimer()
      // 진행 중 요청을 기다린 뒤, 그 snapshot 이후 도착한 더티도 디바운스 없이 모두 비운다.
      // 어느 요청이든 실패하면 rejection을 호출자에게 전파해 구조 변경/잠금 해제를 중단시킨다.
      while (true) {
        if (inFlight !== null) await inFlight
        clearTimer() // 성공 처리에서 남은 더티용으로 잡은 debounce를 강제 flush가 대체한다.
        if (!hasPending()) {
          if (state !== 'idle') setState('saved')
          return
        }
        await run()
      }
    },
    retry(): void {
      attempts = 0
      clearTimer()
      void run().catch(() => undefined)
    },
    cancel(): void {
      clearTimer()
      attempts = 0
      setState('idle')
    },
    getState: () => state,
  }
}
