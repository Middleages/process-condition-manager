/**
 * 시트 편집 세션 훅 (T3): 잠금 생명주기 + 하트비트 + 자동저장을 한데 묶는다.
 *
 * 순수 결정 로직은 editStore(더티 리듀서)와 autosave(디바운스/백오프 엔진)로 빠져 있고,
 * 이 훅은 그것들을 부수효과(네트워크·타이머·언마운트)에 배선하는 얇은 층이다. 그래서
 * 이 훅 자체는 단위 테스트하지 않고, 배선하는 순수 유닛을 테스트한다.
 *
 * 잠금 상실 처리(핵심 판단): 하트비트/저장 중 409를 만나면 더티 버퍼는 **보존**하고
 * 편집만 중단(그리드 읽기 전용) + 재획득 UI를 띄운다. 재획득에 성공하면 보존된 더티를
 * 이어서 저장한다. 자동저장은 잠금이 없으면 시도하지 않는다(치명 오류로 간주해 재시도 중단).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { getLockConflictHolder, isLockConflict } from '@/api/client'
import { patchCells } from '@/api/cells'
import { acquireLock, heartbeatLock, releaseLock, releaseLockOnUnload } from '@/api/locks'

import {
  createAsyncQueue,
  createAutosaveEngine,
  type AutosaveEngine,
  type SaveState,
} from './autosave'
import { dirtyCellList, toCellUpdateIn, useEditStore, type DirtyCell } from './editStore'

/** 잠금 상태. held일 때만 편집 가능. */
export type LockStatus =
  | 'acquiring' // 획득 시도 중(초기/재획득)
  | 'held' // 이 세션이 보유 → 편집 가능
  | 'readonly' // 획득 실패(타인 편집 중 등) → 읽기 전용
  | 'lost' // 보유 중 상실 → 읽기 전용, 재획득 필요(더티 보존)

const DEFAULT_HEARTBEAT_MS = 45_000
const AUTOSAVE_DEBOUNCE_MS = 3_000
const AUTOSAVE_BACKOFF_MS = 500
const AUTOSAVE_MAX_RETRIES = 3

/** 잠금을 보유하지 않은 채 저장이 시도됐음 — 자동저장 엔진에서 치명(재시도 불가)으로 취급. */
class LockRequiredError extends Error {
  constructor() {
    super('편집 잠금을 보유하지 않아 저장할 수 없다.')
    this.name = 'LockRequiredError'
  }
}

export interface UseSheetEditingOptions {
  /** 저장 성공분을 서버 스냅샷(react-query 캐시)에 반영하는 콜백. markSaved 전에 호출된다. */
  onPersisted?: (cells: DirtyCell[]) => void
  /** 서버가 시트 잠금 요약으로 공급한 heartbeat/readonly 재획득 주기. */
  heartbeatMs?: number
  /** 최초 시트 조회가 알려 준 현재 잠금 보유자. 이후 충돌 응답으로 갱신한다. */
  initialEditingBy?: string | null
}

export interface SheetEditing {
  lockStatus: LockStatus
  saveStatus: SaveState
  dirtyCount: number
  /** 읽기 전용일 때 서버 충돌 응답이 알려 준 현재 편집자. */
  editingBy: string | null
  /** 붙여넣기 또는 구조 변경이 큐에서 대기/실행 중이라 셀 입력을 잠시 막아야 하는지. */
  writeBusy: boolean
  /** 그리드 읽기 전용 여부 = 잠금 미보유. */
  readOnly: boolean
  /** 셀 편집 확정(그리드 onCellEdit 연결). */
  setCell(conditionId: string, parameterCode: string, value: string | null): void
  /**
   * 붙여넣기 스테이징 적용 = 즉시 저장(origin=paste). 자동저장 디바운스를 우회해 단일 PATCH
   * 배치로 바로 확정 저장한다. 같은 더티 버퍼를 거쳐 수동 편집과 순서를 보장한다. 잠금 미보유
   * 시 즉시 실패, 저장 중 409면 잠금 상실 처리 후 그대로 reject(상위가 스테이징을 유지·안내).
   */
  applyPaste(cells: DirtyCell[]): Promise<void>
  /**
   * 구조 변경(조건 행 추가/복제/삭제·POR 이양) 즉시 실행 헬퍼(T7). 더티 셀 버퍼와 분리된
   * 별도 API 호출을 감싸 잠금 검사·순서 보장·잠금 상실 처리를 재사용한다:
   *  1. 잠금 미보유면 즉시 실패(`LockRequiredError`).
   *  2. **진행 중인 더티 셀을 먼저 확정 저장**(자동저장 flushNow 재사용) — 구조 변경 API가
   *     최신 셀 상태 위에서 동작하도록 순서를 보장한다.
   *  3. `fn(token)` 호출 → 결과 반환.
   *  4. 저장 중 409(잠금 상실)면 상실 처리 후 그대로 reject(상위가 UI로 안내).
   */
  runStructuralChange<T>(fn: (lockToken: string) => Promise<T>): Promise<T>
  /** 변경 취소(더티 폐기 + 자동저장 중단). */
  discard(): void
  /** 저장 실패 수동 재시도. */
  retrySave(): void
  /** 잠금 재획득(상실 상태에서). */
  reacquire(): void
}

export function useSheetEditing(
  projectId: number,
  options: UseSheetEditingOptions = {},
): SheetEditing {
  const [lockStatus, setLockStatus] = useState<LockStatus>('acquiring')
  const [saveStatus, setSaveStatus] = useState<SaveState>('idle')
  const [editingBy, setEditingBy] = useState<string | null>(options.initialEditingBy ?? null)
  const [writeBusy, setWriteBusy] = useState(false)
  const dirtyCount = useEditStore((state) => state.dirtyCells.size)
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS

  const lockTokenRef = useRef<string | null>(null)
  const lockStatusRef = useRef<LockStatus>('acquiring') // 비동기 콜백 내부 로직용 미러
  const projectIdRef = useRef(projectId)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const acquireInFlightRef = useRef(false)
  const sessionGenerationRef = useRef(0)
  const immediatePendingRef = useRef(0)
  const operationQueueRef = useRef(createAsyncQueue())
  const engineRef = useRef<AutosaveEngine | null>(null)
  const onPersistedRef = useRef(options.onPersisted)
  const saveOriginRef = useRef<'manual' | 'paste'>('manual')

  const updateLockStatus = useCallback((next: LockStatus) => {
    lockStatusRef.current = next
    setLockStatus(next)
  }, [])

  const isCurrentSession = useCallback(
    (generation: number) => sessionGenerationRef.current === generation,
    [],
  )

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }, [])

  const handleLockLost = useCallback((error?: unknown) => {
    updateLockStatus('lost')
    setEditingBy(error === undefined ? null : getLockConflictHolder(error))
    stopHeartbeat()
    lockTokenRef.current = null
    engineRef.current?.cancel() // 자동저장 중단, 더티는 보존
  }, [updateLockStatus, stopHeartbeat])

  const startHeartbeat = useCallback((generation: number) => {
    stopHeartbeat()
    heartbeatRef.current = setInterval(() => {
      if (!isCurrentSession(generation)) {
        return
      }
      const token = lockTokenRef.current
      if (token === null) return
      heartbeatLock(projectIdRef.current, token)
        .then((lock) => {
          if (!isCurrentSession(generation)) return
          lockTokenRef.current = lock.lock_token
        })
        .catch((error: unknown) => {
          if (!isCurrentSession(generation)) return
          // 409 = 잠금 상실. 그 외(네트워크 일시 오류)는 무시 — 다음 주기 재시도, TTL이 최종 보험.
          if (isLockConflict(error)) handleLockLost(error)
        })
    }, heartbeatMs)
  }, [stopHeartbeat, handleLockLost, heartbeatMs, isCurrentSession])

  // 자동저장 엔진은 한 번만 생성한다(안정 클로저 — 위 useCallback들은 deps가 안정적이다).
  if (engineRef.current === null) {
    engineRef.current = createAutosaveEngine({
      debounceMs: AUTOSAVE_DEBOUNCE_MS,
      backoffMs: AUTOSAVE_BACKOFF_MS,
      maxRetries: AUTOSAVE_MAX_RETRIES,
      hasPending: () => useEditStore.getState().dirtyCells.size > 0,
      onStateChange: setSaveStatus,
      isFatal: (error) => error instanceof LockRequiredError || isLockConflict(error),
      flush: async () => {
        const token = lockTokenRef.current
        if (token === null || lockStatusRef.current !== 'held') {
          throw new LockRequiredError()
        }
        const snapshot = dirtyCellList(useEditStore.getState().dirtyCells)
        if (snapshot.length === 0) return
        // origin은 이 snapshot 한 번에만 적용한다. paste 저장 중 도착한 후속 수동 편집은
        // flushNow의 다음 반복에서 manual로 기록되어 audit batch 의미가 섞이지 않는다.
        const origin = saveOriginRef.current
        saveOriginRef.current = 'manual'
        try {
          await patchCells(
            projectIdRef.current,
            snapshot.map(toCellUpdateIn),
            origin,
            token,
          )
        } catch (error) {
          // 저장 중 잠금 탈취(409) → 상실 처리 후 치명 오류로 던져 재시도를 멈춘다.
          if (isLockConflict(error)) handleLockLost(error)
          throw error
        }
        onPersistedRef.current?.(snapshot) // 서버 스냅샷 반영(markSaved 전)
        useEditStore.getState().markSaved(snapshot)
      },
    })
  }

  const setCell = useCallback(
    (conditionId: string, parameterCode: string, value: string | null) => {
      // 구조 변경/붙여넣기가 실행 중일 때 새 autosave가 별도 HTTP 요청으로 추월하지 않게 한다.
      if (lockStatusRef.current !== 'held' || immediatePendingRef.current > 0) return
      useEditStore.getState().setCell(conditionId, parameterCode, value)
      engineRef.current?.schedule()
    },
    [],
  )

  /** 붙여넣기와 구조 변경을 한 세션 큐에 넣고, 이탈 후 대기 작업은 실행하지 않는다. */
  const enqueueWrite = useCallback(
    <T,>(task: (generation: number) => Promise<T>): Promise<T> => {
      const generation = sessionGenerationRef.current
      immediatePendingRef.current += 1
      setWriteBusy(true)
      return operationQueueRef.current
        .run(async () => {
          if (!isCurrentSession(generation)) throw new LockRequiredError()
          return task(generation)
        })
        .finally(() => {
          immediatePendingRef.current = Math.max(0, immediatePendingRef.current - 1)
          if (isCurrentSession(generation) && immediatePendingRef.current === 0) {
            setWriteBusy(false)
          }
        })
    },
    [isCurrentSession],
  )

  // 붙여넣기 적용: 기존 수동 더티를 먼저 확정한 뒤 붙여넣기 값을 같은 더티 버퍼에 병합하고
  // origin=paste로 즉시 flush한다. 동일 셀의 이전 수동 값은 붙여넣기 값으로 대체되므로 나중에
  // 옛 자동저장이 붙여넣기를 되돌릴 수 없다. 실패하면 스테이징 재시도를 위해 임시 더티만 걷어낸다.
  const applyPaste = useCallback(
    (cells: DirtyCell[]): Promise<void> => enqueueWrite(async (generation) => {
      if (cells.length === 0) return
      if (lockTokenRef.current === null || lockStatusRef.current !== 'held') {
        throw new LockRequiredError()
      }

      // 붙여넣기보다 먼저 발생한 수동 편집은 먼저 저장한다. 진행 중 저장도 실제 완료까지 기다리고,
      // 실패하면 rejection이 전파되어 붙여넣기를 시작하지 않는다.
      await (engineRef.current?.flushNow() ?? Promise.resolve())
      if (
        !isCurrentSession(generation) ||
        lockTokenRef.current === null ||
        lockStatusRef.current !== 'held'
      ) {
        throw new LockRequiredError()
      }

      saveOriginRef.current = 'paste'
      useEditStore.getState().setCells(cells)
      try {
        await (engineRef.current?.flushNow() ?? Promise.resolve())
      } catch (error) {
        // 강제 flush 실패가 잡아 둔 백오프를 중단하고, 아직 같은 값인 붙여넣기 셀만 더티에서
        // 제거한다. 저장 중 사용자가 다시 편집한 셀은 markSaved의 snapshot 보호로 남는다.
        if (isCurrentSession(generation)) {
          engineRef.current?.cancel()
          useEditStore.getState().markSaved(cells)
        }
        throw error
      } finally {
        saveOriginRef.current = 'manual'
        // 실패 중 새 편집이 들어왔다면 일반 수동 자동저장으로 다시 시작한다.
        if (
          isCurrentSession(generation) &&
          lockStatusRef.current === 'held' &&
          useEditStore.getState().dirtyCells.size > 0
        ) {
          engineRef.current?.schedule()
        }
      }
    }),
    [enqueueWrite, isCurrentSession],
  )

  // 구조 변경(조건 행 추가/복제/삭제·POR 이양) 즉시 실행: 더티 셀 버퍼와 분리된 별도 API
  // 호출(T7 즉시 커밋). applyPaste와 같은 즉시-호출 패턴이되, 구조 변경 전에 진행 중인 셀
  // 편집을 먼저 확정 저장해(flushNow) 순서를 보장한다. flushNow는 진행 중 요청과 후속 더티를
  // 모두 기다리고 실패를 reject하므로, 저장이 확정된 뒤에만 구조 변경 API를 호출한다.
  const runStructuralChange = useCallback(
    <T,>(fn: (lockToken: string) => Promise<T>): Promise<T> => enqueueWrite(async (generation) => {
      if (lockTokenRef.current === null || lockStatusRef.current !== 'held') {
        throw new LockRequiredError()
      }
      // 진행 중인 더티 셀을 먼저 확정 저장(디바운스 우회). 없으면 즉시 resolve.
      await (engineRef.current?.flushNow() ?? Promise.resolve())
      const token = lockTokenRef.current
      if (!isCurrentSession(generation) || token === null || lockStatusRef.current !== 'held') {
        // flush 중 잠금 상실(409) → 구조 변경을 진행하지 않는다(handleLockLost는 이미 수행됨).
        throw new LockRequiredError()
      }
      try {
        return await fn(token)
      } catch (error) {
        // 구조 변경 중 잠금 탈취(409) → 상실 처리(읽기 전용 전환) 후 그대로 던져 상위가 안내한다.
        if (isLockConflict(error) && isCurrentSession(generation)) handleLockLost(error)
        throw error
      }
    }),
    [enqueueWrite, handleLockLost, isCurrentSession],
  )

  const discard = useCallback(() => {
    useEditStore.getState().clearAll()
    engineRef.current?.cancel()
    setSaveStatus('idle')
  }, [])

  const retrySave = useCallback(() => {
    engineRef.current?.retry()
  }, [])

  const reacquire = useCallback(() => {
    if (acquireInFlightRef.current) return
    const generation = sessionGenerationRef.current
    const sessionProjectId = projectIdRef.current
    const fallbackStatus: LockStatus =
      lockStatusRef.current === 'readonly' ? 'readonly' : 'lost'
    acquireInFlightRef.current = true
    updateLockStatus('acquiring')
    acquireLock(sessionProjectId)
      .then((lock) => {
        if (!isCurrentSession(generation)) {
          void releaseLock(sessionProjectId, lock.lock_token)
          return
        }
        lockTokenRef.current = lock.lock_token
        setEditingBy(null)
        updateLockStatus('held')
        startHeartbeat(generation)
        // 보존된 더티가 있으면 이어서 저장.
        if (useEditStore.getState().dirtyCells.size > 0) engineRef.current?.schedule()
      })
      .catch((error: unknown) => {
        if (!isCurrentSession(generation)) return
        setEditingBy(getLockConflictHolder(error))
        updateLockStatus(fallbackStatus)
      })
      .finally(() => {
        if (isCurrentSession(generation)) acquireInFlightRef.current = false
      })
  }, [updateLockStatus, startHeartbeat, isCurrentSession])

  // 마운트/프로젝트 전환: 더티 리셋 → 잠금 획득 → 하트비트 시작. 언마운트: flush 시도 → 해제.
  useEffect(() => {
    const engine = engineRef.current
    let cancelled = false
    const generation = sessionGenerationRef.current + 1
    sessionGenerationRef.current = generation
    projectIdRef.current = projectId
    onPersistedRef.current = options.onPersisted

    useEditStore.getState().clearAll() // 새 시트 → 더티 버퍼 리셋
    engine?.cancel()
    updateLockStatus('acquiring')
    setEditingBy(options.initialEditingBy ?? null)
    setWriteBusy(false)
    setSaveStatus('idle')

    acquireInFlightRef.current = true
    acquireLock(projectId)
      .then((lock) => {
        if (cancelled || !isCurrentSession(generation)) {
          void releaseLock(projectId, lock.lock_token) // 이미 이탈 → 즉시 해제
          return
        }
        lockTokenRef.current = lock.lock_token
        setEditingBy(null)
        updateLockStatus('held')
        startHeartbeat(generation)
      })
      .catch((error: unknown) => {
        if (cancelled || !isCurrentSession(generation)) return
        lockTokenRef.current = null
        setEditingBy(getLockConflictHolder(error))
        updateLockStatus('readonly') // 획득 실패(타인 편집 중 등) → 읽기 전용
      })
      .finally(() => {
        if (isCurrentSession(generation)) acquireInFlightRef.current = false
      })

    // 비보유자는 서버가 공급한 heartbeat 주기로 조용히 재획득을 시도한다. 성공하면
    // 새로고침 없이 편집 모드로 전환하고, 실패 중에는 readonly 표시를 유지한다.
    const readonlyRetry = setInterval(() => {
      if (
        cancelled ||
        acquireInFlightRef.current ||
        lockStatusRef.current !== 'readonly'
      ) {
        return
      }
      acquireInFlightRef.current = true
      acquireLock(projectId)
        .then((lock) => {
          if (cancelled || !isCurrentSession(generation)) {
            void releaseLock(projectId, lock.lock_token)
            return
          }
          lockTokenRef.current = lock.lock_token
          setEditingBy(null)
          updateLockStatus('held')
          startHeartbeat(generation)
        })
        .catch((error: unknown) => {
          if (isCurrentSession(generation)) setEditingBy(getLockConflictHolder(error))
        })
        .finally(() => {
          if (isCurrentSession(generation)) acquireInFlightRef.current = false
        })
    }, heartbeatMs)

    return () => {
      cancelled = true
      if (isCurrentSession(generation)) sessionGenerationRef.current += 1
      acquireInFlightRef.current = false
      clearInterval(readonlyRetry)
      stopHeartbeat()
      const token = lockTokenRef.current
      if (lockStatusRef.current === 'held' && token !== null) {
        // 남은 더티 best-effort flush 후 해제. 진행 중 저장 뒤에 새 더티가 남아 있을 수 있으므로
        // flushNow 전체가 끝날 때까지 토큰을 유지한다. release도 그 뒤로 미뤄 저장과 경합하지 않는다.
        // 큐에 이미 들어간 붙여넣기/구조 변경까지 먼저 기다린다. 이탈로 generation이
        // 무효화된 대기 작업은 실행 전에 중단되고, 이미 실행 중인 요청만 끝까지 마무리된다.
        const done = operationQueueRef.current
          .whenIdle()
          .then(() => (engine ? engine.flushNow() : Promise.resolve()))
        void done
          .then(() => {
            if (lockTokenRef.current === token) lockTokenRef.current = null
            return releaseLock(projectId, token)
          })
          // 저장 실패 시 잠금을 먼저 풀면 늦게 도착한 PATCH가 409가 된다. 해제하지 않고 TTL에
          // 맡겨 데이터 보존을 우선한다.
          .catch(() => undefined)
      } else {
        engine?.cancel()
        lockTokenRef.current = null
        if (token !== null) void releaseLock(projectId, token)
      }
    }
  }, [
    projectId,
    options.onPersisted,
    updateLockStatus,
    startHeartbeat,
    stopHeartbeat,
    heartbeatMs,
    isCurrentSession,
  ])

  // 탭 종료 대비: sendBeacon 전용 POST release 별칭으로 해제를 큐에 넣는다. 전송 자체가
  // 거부되거나 브라우저가 종료되면 TTL 만료가 최종 보험이다.
  useEffect(() => {
    const handler = (): void => {
      const token = lockTokenRef.current
      if (token === null || lockStatusRef.current !== 'held') return
      // 브라우저 종료 시 dirty/in-flight/queued 쓰기가 있으면 해제가 PATCH보다 먼저 도착할 수
      // 있다. 이때는 즉시 해제하지 않고 서버 TTL이 최종 정리를 맡는다.
      if (useEditStore.getState().dirtyCells.size > 0 || immediatePendingRef.current > 0) return
      releaseLockOnUnload(projectIdRef.current, token)
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  return {
    lockStatus,
    saveStatus,
    dirtyCount,
    editingBy,
    writeBusy,
    readOnly: lockStatus !== 'held',
    setCell,
    applyPaste,
    runStructuralChange,
    discard,
    retrySave,
    reacquire,
  }
}
