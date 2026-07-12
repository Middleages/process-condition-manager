import { apiClient } from './client'
import type { LockOut } from './types'

/**
 * 편집 잠금 클라이언트 (P2-D6). 소유는 사용자 + lock_token으로 식별한다.
 *
 * 지금은 배치성 편집 API(레이어 백본 교체 등) 호출 직전에 짧게 획득→해제하는
 * 용도로만 쓴다. 시트 편집 화면 진입 시 지속 보유 + 하트비트(T3/T4의 몫)는
 * 별도로 붙는다.
 */
export async function acquireLock(projectId: number): Promise<LockOut> {
  const response = await apiClient.post<LockOut>(`/projects/${projectId}/lock`)
  return response.data
}

/**
 * 잠금 하트비트 — 보유 중인 잠금의 TTL을 연장한다. 시트 편집 화면이 열려 있는 동안
 * 주기적으로(예: 45초) 호출한다(T3).
 *
 * 잠금을 잃었으면(예: TTL 만료 후 다른 세션이 탈취) 409로 응답한다 →
 * 상위(SheetView)는 이를 "잠금 상실"로 해석해 편집을 중단하고 재획득 UI를 띄운다.
 */
export async function heartbeatLock(projectId: number, lockToken: string): Promise<LockOut> {
  const response = await apiClient.post<LockOut>(`/projects/${projectId}/lock/heartbeat`, {
    lock_token: lockToken,
  })
  return response.data
}

export async function releaseLock(projectId: number, lockToken: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/lock`, { data: { lock_token: lockToken } })
}
