import { useQuery } from '@tanstack/react-query'
import { fetchAuditLogs } from '@/api/adminAudit'
import type { AuditLogParams } from '@/api/adminAudit'

export function useAuditLogs(params: AuditLogParams) {
  return useQuery({
    queryKey: ['adminAuditLogs', params],
    queryFn: () => fetchAuditLogs(params),
  })
}
