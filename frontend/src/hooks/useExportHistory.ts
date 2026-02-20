import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchExportHistory } from '@/api/export'

// 전산 출력 이력 쿼리 키
export const exportHistoryKeys = {
  history: (projectId: number, offset: number) =>
    ['exportHistory', projectId, offset] as const,
}

const PAGE_SIZE = 5

// 전산 출력 이력 훅 (offset 기반 페이지네이션)
export function useExportHistory(projectId: number) {
  const [offset, setOffset] = useState(0)

  const query = useQuery({
    queryKey: exportHistoryKeys.history(projectId, offset),
    queryFn: () => fetchExportHistory(projectId, offset, PAGE_SIZE),
    enabled: !!projectId,
  })

  const loadMore = () => {
    setOffset((prev) => prev + PAGE_SIZE)
  }

  const hasMore =
    query.data !== undefined &&
    offset + PAGE_SIZE < query.data.total

  return {
    ...query,
    offset,
    loadMore,
    hasMore,
    pageSize: PAGE_SIZE,
  }
}
