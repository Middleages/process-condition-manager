import client from './client'
import type { DashboardOverview } from '@/types'

export const fetchDashboardOverview = (lineId?: number) =>
  client
    .get<DashboardOverview>('/dashboard/overview', {
      params: lineId != null ? { line_id: lineId } : undefined,
    })
    .then((r) => r.data)
