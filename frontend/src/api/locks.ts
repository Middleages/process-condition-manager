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

export async function releaseLock(projectId: number, lockToken: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/lock`, { data: { lock_token: lockToken } })
}
