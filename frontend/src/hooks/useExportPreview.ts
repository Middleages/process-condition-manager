import { useQuery } from '@tanstack/react-query'
import { fetchExportPreview } from '@/api/export'

// 전산 출력 미리보기 쿼리 키
export const exportPreviewKeys = {
  preview: (projectId: number, systemId: number) =>
    ['export', 'preview', projectId, systemId] as const,
}

// 전산 출력 미리보기 훅 (systemId가 null이면 비활성화)
export function useExportPreview(projectId: number, systemId: number | null) {
  return useQuery({
    queryKey: exportPreviewKeys.preview(projectId, systemId ?? 0),
    queryFn: () => fetchExportPreview(projectId, systemId!),
    enabled: !!systemId && !!projectId,
  })
}
