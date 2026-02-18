import { useQuery } from '@tanstack/react-query'
import { fetchExportSystems } from '@/api/export'

// 전산 출력 시스템 쿼리 키
export const exportKeys = {
  all: ['export'] as const,
  systems: () => [...exportKeys.all, 'systems'] as const,
}

// 전산 출력 시스템 목록 훅
export function useExportSystems() {
  return useQuery({
    queryKey: exportKeys.systems(),
    queryFn: fetchExportSystems,
  })
}
