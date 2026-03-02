import client from './client'
import type {
  ConfigChangeCreateRequest,
  ConfigChangeDetailResponse,
  ConfigChangeListResponse,
  ConfigChangeVoteRequest,
} from '@/types'

export async function fetchConfigChanges(
  status?: string | null,
  offset = 0,
  limit = 20,
): Promise<ConfigChangeListResponse> {
  const params: Record<string, unknown> = { offset, limit }
  if (status) params.status = status
  const { data } = await client.get<ConfigChangeListResponse>('/config-changes', { params })
  return data
}

export async function fetchConfigChangeDetail(
  id: number,
): Promise<ConfigChangeDetailResponse> {
  const { data } = await client.get<ConfigChangeDetailResponse>(`/config-changes/${id}`)
  return data
}

export async function createConfigChange(
  payload: ConfigChangeCreateRequest,
): Promise<ConfigChangeDetailResponse> {
  const { data } = await client.post<ConfigChangeDetailResponse>('/config-changes', payload)
  return data
}

export async function voteConfigChange(
  id: number,
  payload: ConfigChangeVoteRequest,
): Promise<ConfigChangeDetailResponse> {
  const { data } = await client.post<ConfigChangeDetailResponse>(
    `/config-changes/${id}/vote`,
    payload,
  )
  return data
}

export async function startConfigChange(
  id: number,
): Promise<ConfigChangeDetailResponse> {
  const { data } = await client.patch<ConfigChangeDetailResponse>(
    `/config-changes/${id}/start`,
  )
  return data
}

export async function completeConfigChange(
  id: number,
): Promise<ConfigChangeDetailResponse> {
  const { data } = await client.patch<ConfigChangeDetailResponse>(
    `/config-changes/${id}/complete`,
  )
  return data
}

export async function cancelConfigChange(
  id: number,
): Promise<ConfigChangeDetailResponse> {
  const { data } = await client.patch<ConfigChangeDetailResponse>(
    `/config-changes/${id}/cancel`,
  )
  return data
}
