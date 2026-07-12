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

import { apiClient, isLockConflict } from '@/api/client'
import { patchCells } from '@/api/cells'
import { acquireLock, heartbeatLock, releaseLock } from '@/api/locks'

import { createAutosaveEngine, type AutosaveEngine, type SaveState } from './autosave'
import { dirtyCellList, toCellUpdateIn, useEditStore, type DirtyCell } from './editStore'

/** 잠금 상태. held일 때만 편집 가능. */
export type LockStatus =
  | 'acquiring' // 획득 시도 중(초기/재획득)
  | 'held' // 이 세션이 보유 → 편집 가능
  | 'readonly' // 획득 실패(타인 편집 중 등) → 읽기 전용
  | 'lost' // 보유 중 상실 → 읽기 전용, 재획득 필요(더티 보존)

const HEARTBEAT_MS = 45_000
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
}

export interface SheetEditing {
  lockStatus: LockStatus
  saveStatus: SaveState
  dirtyCount: number
  /** 그리드 읽기 전용 여부 = 잠금 미보유. */
  readOnly: boolean
  /** 셀 편집 확정(그리드 onCellEdit 연결). */
  setCell(conditionId: string, parameterCode: string, value: string | null): void
  /**
   * 붙여넣기 스테이징 적용 = 즉시 저장(origin=paste). 자동저장 디바운스를 우회해 단일 PATCH
   * 배치로 바로 확정 저장한다. 더티 버퍼를 거치지 않는다(스테이징 → 서버 직행). 잠금 미보유
   * 시 즉시 실패, 저장 중 409면 잠금 상실 처리 후 그대로 reject(상위가 스테이징을 유지·안내).
   */
  applyPaste(cells: DirtyCell[]): Promise<void>
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
  const dirtyCount = useEditStore((state) => state.dirtyCells.size)

  const lockTokenRef = useRef<string | null>(null)
  const lockStatusRef = useRef<LockStatus>('acquiring') // 비동기 콜백 내부 로직용 미러
  const projectIdRef = useRef(projectId)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const engineRef = useRef<AutosaveEngine | null>(null)
  const onPersistedRef = useRef(options.onPersisted)

  projectIdRef.current = projectId
  onPersistedRef.current = options.onPersisted

  const updateLockStatus = useCallback((next: LockStatus) => {
    lockStatusRef.current = next
    setLockStatus(next)
  }, [])

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }, [])

  const handleLockLost = useCallback(() => {
    updateLockStatus('lost')
    stopHeartbeat()
    lockTokenRef.current = null
    engineRef.current?.cancel() // 자동저장 중단, 더티는 보존
  }, [updateLockStatus, stopHeartbeat])

  const startHeartbeat = useCallback(() => {
    stopHeartbeat()
    heartbeatRef.current = setInterval(() => {
      const token = lockTokenRef.current
      if (token === null) return
      heartbeatLock(projectIdRef.current, token)
        .then((lock) => {
          lockTokenRef.current = lock.lock_token
        })
        .catch((error: unknown) => {
          // 409 = 잠금 상실. 그 외(네트워크 일시 오류)는 무시 — 다음 주기 재시도, TTL이 최종 보험.
          if (isLockConflict(error)) handleLockLost()
        })
    }, HEARTBEAT_MS)
  }, [stopHeartbeat, handleLockLost])

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
        try {
          await patchCells(projectIdRef.current, snapshot.map(toCellUpdateIn), 'manual', token)
        } catch (error) {
          // 저장 중 잠금 탈취(409) → 상실 처리 후 치명 오류로 던져 재시도를 멈춘다.
          if (isLockConflict(error)) handleLockLost()
          throw error
        }
        onPersistedRef.current?.(snapshot) // 서버 스냅샷 반영(markSaved 전)
        useEditStore.getState().markSaved(snapshot)
      },
    })
  }

  const setCell = useCallback(
    (conditionId: string, parameterCode: string, value: string | null) => {
      if (lockStatusRef.current !== 'held') return
      useEditStore.getState().setCell(conditionId, parameterCode, value)
      engineRef.current?.schedule()
    },
    [],
  )

  // 붙여넣기 적용: 자동저장 엔진(디바운스/백오프)을 타지 않는 별도 즉시 저장 경로. 스테이징
  // 적용분은 더티 버퍼를 거치지 않고 곧장 서버로 확정 저장한다(origin=paste). 실패 시 스테이징을
  // 유지해야 하므로 여기서는 재시도하지 않고 그대로 던진다 — 사용자가 "적용"을 다시 누르면 된다.
  const applyPaste = useCallback(
    async (cells: DirtyCell[]): Promise<void> => {
      if (cells.length === 0) return
      const token = lockTokenRef.current
      if (token === null || lockStatusRef.current !== 'held') {
        throw new LockRequiredError()
      }
      try {
        await patchCells(projectIdRef.current, cells.map(toCellUpdateIn), 'paste', token)
      } catch (error) {
        // 저장 중 잠금 탈취(409) → 상실 처리(읽기 전용 전환) 후 그대로 던져 상위가 안내한다.
        if (isLockConflict(error)) handleLockLost()
        throw error
      }
      // 성공분을 서버 스냅샷(캐시)에 확정 반영 — 더티 버퍼는 관여하지 않는다.
      onPersistedRef.current?.(cells)
    },
    [handleLockLost],
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
    updateLockStatus('acquiring')
    acquireLock(projectIdRef.current)
      .then((lock) => {
        lockTokenRef.current = lock.lock_token
        updateLockStatus('held')
        startHeartbeat()
        // 보존된 더티가 있으면 이어서 저장.
        if (useEditStore.getState().dirtyCells.size > 0) engineRef.current?.schedule()
      })
      .catch(() => {
        updateLockStatus('lost')
      })
  }, [updateLockStatus, startHeartbeat])

  // 마운트/프로젝트 전환: 더티 리셋 → 잠금 획득 → 하트비트 시작. 언마운트: flush 시도 → 해제.
  useEffect(() => {
    const engine = engineRef.current
    let cancelled = false

    useEditStore.getState().clearAll() // 새 시트 → 더티 버퍼 리셋
    engine?.cancel()
    updateLockStatus('acquiring')
    setSaveStatus('idle')

    acquireLock(projectId)
      .then((lock) => {
        if (cancelled) {
          void releaseLock(projectId, lock.lock_token) // 이미 이탈 → 즉시 해제
          return
        }
        lockTokenRef.current = lock.lock_token
        updateLockStatus('held')
        startHeartbeat()
      })
      .catch(() => {
        if (cancelled) return
        lockTokenRef.current = null
        updateLockStatus('readonly') // 획득 실패(타인 편집 중 등) → 읽기 전용
      })

    return () => {
      cancelled = true
      stopHeartbeat()
      const token = lockTokenRef.current
      if (lockStatusRef.current === 'held' && token !== null) {
        // 남은 더티 best-effort flush 후 해제. flushNow()가 라이브 토큰을 동기적으로 읽은 뒤
        // null 처리해야 flush가 토큰을 잃지 않는다. release는 flush 완료 뒤로 미뤄 저장 중
        // 해제로 마지막 편집을 잃는 것을 막는다.
        const done = engine ? engine.flushNow() : Promise.resolve()
        lockTokenRef.current = null
        void done.finally(() => {
          void releaseLock(projectId, token)
        })
      } else {
        engine?.cancel()
        lockTokenRef.current = null
        if (token !== null) void releaseLock(projectId, token)
      }
    }
  }, [projectId, updateLockStatus, startHeartbeat, stopHeartbeat])

  // 탭 종료 대비: sendBeacon으로 해제 시도. sendBeacon은 POST 전용이라 정확한 해제(DELETE)는
  // 못 하지만, 안 되더라도 잠금 TTL 만료가 최종 보험이다(과도 구현 금지 — 훅 하나로 충분).
  useEffect(() => {
    const handler = (): void => {
      const token = lockTokenRef.current
      if (token === null || lockStatusRef.current !== 'held') return
      const base = apiClient.defaults.baseURL ?? '/api'
      const url = `${base}/projects/${projectIdRef.current}/lock`
      const blob = new Blob([JSON.stringify({ lock_token: token })], {
        type: 'application/json',
      })
      navigator.sendBeacon(url, blob)
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  return {
    lockStatus,
    saveStatus,
    dirtyCount,
    readOnly: lockStatus !== 'held',
    setCell,
    applyPaste,
    discard,
    retrySave,
    reacquire,
  }
}
