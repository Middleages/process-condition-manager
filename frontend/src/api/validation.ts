import { apiClient } from './client'
import type { ProjectValidationOut } from './types'

/** Validate the server's committed project state. The read-only endpoint accepts no body or lock. */
export async function validateProject(
  projectId: number,
  signal?: AbortSignal,
): Promise<ProjectValidationOut> {
  const path = `/projects/${projectId}/validate`
  const response = signal
    ? await apiClient.post<ProjectValidationOut>(path, undefined, { signal })
    : await apiClient.post<ProjectValidationOut>(path)
  return response.data
}
