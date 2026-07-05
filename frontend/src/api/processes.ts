import { apiClient } from './client'
import type { LayerOut, ProcessOut } from './types'

export async function listProcesses(): Promise<ProcessOut[]> {
  const response = await apiClient.get<ProcessOut[]>('/processes')
  return response.data
}

export async function getProcessLayers(processKey: string): Promise<LayerOut[]> {
  const response = await apiClient.get<LayerOut[]>(`/processes/${processKey}/layers`)
  return response.data
}
