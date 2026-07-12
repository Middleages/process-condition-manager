import { apiClient } from './client'
import type { SheetOut } from './types'

/**
 * 프로젝트 시트(조건표) 조회. GET /api/projects/{project_id}/sheet.
 *
 * 컬럼 정의(레지스트리 유래) + 본문 행(조건 행 × 파라미터 매트릭스) + 잠금 요약을
 * 한 응답으로 받는다. 프론트는 받은 컬럼 정의만으로 그리드를 구성한다 (P1 원칙:
 * 코드가 파라미터를 모른다).
 */
export async function getSheet(projectId: number): Promise<SheetOut> {
  const response = await apiClient.get<SheetOut>(`/projects/${projectId}/sheet`)
  return response.data
}
