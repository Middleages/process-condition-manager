import { apiClient } from './client'
import type { CellUpdateIn, CellUpdateOrigin, CellsPatchOut } from './types'

/**
 * 셀 배치 편집(자동저장). PATCH /api/projects/{project_id}/cells.
 *
 * 더티 버퍼의 변경분을 한 번의 요청으로 UPSERT 한다. 잠금 토큰은 `X-Lock-Token` 헤더로
 * 싣는다(바디가 아니라 헤더 — 계약). 토큰이 없거나 유효하지 않으면 서버가 409
 * (`lock_conflict`)로 응답한다 → 상위는 잠금 상실로 해석한다.
 *
 * `origin`은 선택. `undefined`면 바디에서 생략한다(수동/붙여넣기 구분이 필요할 때만 명시).
 */
export async function patchCells(
  projectId: number,
  cells: CellUpdateIn[],
  origin: CellUpdateOrigin | undefined,
  lockToken: string,
): Promise<CellsPatchOut> {
  const body = origin === undefined ? { cells } : { cells, origin }
  const response = await apiClient.patch<CellsPatchOut>(`/projects/${projectId}/cells`, body, {
    headers: { 'X-Lock-Token': lockToken },
  })
  return response.data
}
