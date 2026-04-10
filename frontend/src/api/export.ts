import client from './client'
import type { ExportSystem, ExportPreview, ExportHistoryList, ExportValidationResponse } from '@/types/export'

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
    `/process-conditions/${projectId}/export/preview/${systemId}`
  )
  return data
}

// 전산 출력 이력 조회
export async function fetchExportHistory(
  projectId: number,
  offset: number = 0,
  limit: number = 5
): Promise<ExportHistoryList> {
  const { data } = await client.get<ExportHistoryList>(
    `/process-conditions/${projectId}/export/history`,
    { params: { offset, limit } }
  )
  return data
}

// 전산 출력 Excel/ZIP 다운로드
export async function downloadExport(
  projectId: number,
  systemIds: number[]
): Promise<{ blob: Blob; filename: string }> {
  const response = await client.post(
    `/process-conditions/${projectId}/export`,
    { system_ids: systemIds },
    { responseType: 'blob' }
  )

  // Content-Disposition 헤더에서 파일명 추출
  const disposition = response.headers['content-disposition'] || ''
  const filenameMatch = disposition.match(/filename="?(.+?)"?$/i)
  const filename = filenameMatch ? filenameMatch[1] : 'export.xlsx'

  return { blob: response.data, filename }
}

// Simple Excel export (full condition table, all statuses)
export async function downloadSimpleExport(projectId: number): Promise<void> {
  const response = await client.get(`/process-conditions/${projectId}/export/simple`, {
    responseType: 'blob',
  })

  // Create download link from blob
  const url = window.URL.createObjectURL(new Blob([response.data]))
  const link = document.createElement('a')
  link.href = url

  // Extract filename from Content-Disposition header or use default
  const contentDisposition = response.headers['content-disposition'] || ''
  const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/i)
  const filename = filenameMatch
    ? filenameMatch[1]
    : `conditions_${new Date().toISOString().slice(0, 10)}.xlsx`

  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

// 전산 출력 검증
export async function validateExport(
  projectId: number,
  systemIds: number[]
): Promise<ExportValidationResponse> {
  const { data } = await client.post<ExportValidationResponse>(
    `/process-conditions/${projectId}/export/validate`,
    { system_ids: systemIds }
  )
  return data
}
