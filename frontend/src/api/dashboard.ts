import client from './client'
import type { DashboardOverview } from '@/types'

export const fetchDashboardOverview = () =>
  client.get<DashboardOverview>('/dashboard/overview').then((r) => r.data)
