import client from './client'
import type { ExportSystem, ExportPreview } from '@/types/export'

// 전산 출력 시스템 목록 조회
export async function fetchExportSystems(): Promise<ExportSystem[]> {
  const { data } = await client.get<ExportSystem[]>('/export/systems')
  return data
}

// 전산 출력 미리보기 조회
export async function fetchExportPreview(
  projectId: number,
  systemId: number
): Promise<ExportPreview> {
  const { data } = await client.get<ExportPreview>(
    `/projects/${projectId}/export/preview/${systemId}`
  )
  return data
}

// 전산 출력 Excel/ZIP 다운로드
export async function downloadExport(
  projectId: number,
  systemIds: number[]
): Promise<{ blob: Blob; filename: string }> {
  const response = await client.post(
    `/projects/${projectId}/export`,
    { system_ids: systemIds },
    { responseType: 'blob' }
  )

  // Content-Disposition 헤더에서 파일명 추출
  const disposition = response.headers['content-disposition'] || ''
  const filenameMatch = disposition.match(/filename="?(.+?)"?$/i)
  const filename = filenameMatch ? filenameMatch[1] : 'export.xlsx'

  return { blob: response.data, filename }
}
