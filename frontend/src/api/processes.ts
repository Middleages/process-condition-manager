import { apiClient } from './client'
import type { LayerOut, ProcessDetailOut, ProcessListOut, ProcessOut } from './types'

export interface SearchProcessesParams {
  query?: string
  cursor?: string
  limit?: number
  without_project?: boolean
}

export async function searchProcesses(
  params: SearchProcessesParams = {},
): Promise<ProcessListOut> {
  const response = await apiClient.get<ProcessListOut>('/processes', { params })
  return response.data
}

export async function listProcesses(): Promise<ProcessOut[]> {
  const response = await searchProcesses({ limit: 200 })
  return response.items
}

export async function getProcess(processKey: string): Promise<ProcessDetailOut> {
  const response = await apiClient.get<ProcessDetailOut>(`/processes/${encodeURIComponent(processKey)}`)
  return response.data
}

export async function getProcessLayers(processKey: string): Promise<LayerOut[]> {
  const response = await apiClient.get<LayerOut[]>(
    `/processes/${encodeURIComponent(processKey)}/layers`,
  )
  return response.data
}
