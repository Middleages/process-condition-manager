import { apiClient } from './client'
import type { ConditionCreateIn, ConditionOut } from './types'

/**
 * 조건 행 관리 클라이언트 (T7): 추가/복제·삭제·POR 이양.
 *
 * 세 엔드포인트 모두 편집 API라 잠금 토큰을 `X-Lock-Token` 헤더로 싣는다(바디가 아니라
 * 헤더 — cells/T3와 같은 계약). 미보유·토큰 불일치면 서버가 409(`lock_conflict`)로
 * 응답한다 → 상위(useSheetEditing.runStructuralChange)가 잠금 상실로 해석한다.
 *
 * 구조 변경은 더티 셀 버퍼를 거치지 않는 즉시 호출이다(즉시 커밋 원칙). 성공 시 상위는
 * 시트 쿼리를 무효화해 다시 조회한다 — 행 수/POR 지정이 바뀌는 구조적 변화라 셀 값처럼
 * 캐시에 부분 반영하기보다 재조회가 안전·단순하다.
 */

/**
 * 조건 행 추가/복제. POST /api/projects/{project_id}/layers/{layer_key}/conditions.
 *
 * sourceConditionId가 null이면 빈 조건 행을 추가하고, 값이 있으면 그 조건 행을 복제한다
 * (원본은 같은 layer 소속이어야 하며 아니면 서버가 422로 거부). 응답은 새로 만들어진
 * 조건 행의 최소 표현.
 */
export async function addCondition(
  projectId: number,
  layerKey: string,
  sourceConditionId: number | null,
  lockToken: string,
): Promise<ConditionOut> {
  const body: ConditionCreateIn = { source_condition_id: sourceConditionId }
  const response = await apiClient.post<ConditionOut>(
    `/projects/${projectId}/layers/${layerKey}/conditions`,
    body,
    { headers: { 'X-Lock-Token': lockToken } },
  )
  return response.data
}

/**
 * 조건 행 삭제. DELETE /api/projects/{project_id}/conditions/{condition_id}.
 *
 * 하드 삭제(204, 본문 없음). layer의 마지막 조건 행이면 서버가 422로 거부하므로,
 * 호출자는 실패 시 에러 메시지를 사용자에게 보여준다.
 */
export async function deleteCondition(
  projectId: number,
  conditionId: number,
  lockToken: string,
): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/conditions/${conditionId}`, {
    headers: { 'X-Lock-Token': lockToken },
  })
}

/**
 * POR 이양. PUT /api/projects/{project_id}/conditions/{condition_id}/por.
 *
 * 대상 조건 행을 그 layer의 POR로 세운다(기존 POR은 서버가 트랜잭션 안에서 해제).
 * 대상 식별이 경로에 있으므로 본문은 없다. 이미 POR이면 서버가 변경 없이 그대로 반환한다.
 */
export async function setConditionPor(
  projectId: number,
  conditionId: number,
  lockToken: string,
): Promise<ConditionOut> {
  const response = await apiClient.put<ConditionOut>(
    `/projects/${projectId}/conditions/${conditionId}/por`,
    undefined,
    { headers: { 'X-Lock-Token': lockToken } },
  )
  return response.data
}
