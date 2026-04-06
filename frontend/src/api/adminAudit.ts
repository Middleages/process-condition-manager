import client from './client'

export interface AuditLogEntry {
  id: number
  project_id: number | null
  project_name: string | null
  layer_name: string | null
  column_name: string
  old_value: string | null
  new_value: string | null
  change_type: 'manual' | 'backbone' | 'recipe'
  changed_by: number
  changed_by_userid: string | null
  changed_at: string
}

export interface AuditLogListResponse {
  items: AuditLogEntry[]
  total: number
}

export interface AuditLogParams {
  project_id?: number
  line_id?: number
  changed_by?: number
  change_type?: string
  date_from?: string
  date_to?: string
  offset?: number
  limit?: number
}

export async function fetchAuditLogs(params: AuditLogParams): Promise<AuditLogListResponse> {
  const { data } = await client.get<AuditLogListResponse>('/admin/audit-logs', { params })
  return data
}
