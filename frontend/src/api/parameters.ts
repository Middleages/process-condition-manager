import { apiClient } from './client'
import type {
  ImportResultOut,
  OptionIn,
  ParameterCreate,
  ParameterOut,
  ParameterUpdate,
} from './types'

export async function previewParameterImport(csvText: string): Promise<ImportResultOut> {
  const response = await apiClient.post<ImportResultOut>('/parameters/import/preview', {
    csv_text: csvText,
  })
  return response.data
}

export async function applyParameterImport(csvText: string): Promise<ImportResultOut> {
  const response = await apiClient.post<ImportResultOut>('/parameters/import/apply', {
    csv_text: csvText,
  })
  return response.data
}

export async function listParameters(includeInactive = false): Promise<ParameterOut[]> {
  const response = await apiClient.get<ParameterOut[]>('/parameters', {
    params: { include_inactive: includeInactive },
  })
  return response.data
}

export async function getParameter(
  parameterId: number,
  signal?: AbortSignal,
): Promise<ParameterOut> {
  const path = `/parameters/${parameterId}`
  const response = signal
    ? await apiClient.get<ParameterOut>(path, { signal })
    : await apiClient.get<ParameterOut>(path)
  return response.data
}

export async function createParameter(data: ParameterCreate): Promise<ParameterOut> {
  const response = await apiClient.post<ParameterOut>('/parameters', data)
  return response.data
}

export async function updateParameter(
  parameterId: number,
  data: ParameterUpdate,
): Promise<ParameterOut> {
  const response = await apiClient.patch<ParameterOut>(`/parameters/${parameterId}`, data)
  return response.data
}

export async function deactivateParameter(parameterId: number): Promise<ParameterOut> {
  const response = await apiClient.post<ParameterOut>(`/parameters/${parameterId}/deactivate`)
  return response.data
}

export async function replaceParameterOptions(
  parameterId: number,
  options: OptionIn[],
): Promise<ParameterOut> {
  const response = await apiClient.put<ParameterOut>(`/parameters/${parameterId}/options`, options)
  return response.data
}
