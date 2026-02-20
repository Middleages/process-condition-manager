import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchDashboardOverview } from '@/api/dashboard'

export const dashboardKeys = {
  all: ['dashboard'] as const,
  overview: (lineId?: number) => [...dashboardKeys.all, 'overview', lineId] as const,
}

export function useDashboardOverview(lineId?: number) {
  return useQuery({
    queryKey: dashboardKeys.overview(lineId),
    queryFn: () => fetchDashboardOverview(lineId),
  })
}

export function useRefreshDashboard() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: dashboardKeys.all })
}
