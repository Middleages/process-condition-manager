import client from './client'
import type {
  ExportSystemAdmin,
  ExportSystemCreate,
  ExportMapping,
  ExportMappingCreate,
} from '@/types/export'

// ========== ExportSystem CRUD ==========

export async function fetchAdminExportSystems(): Promise<ExportSystemAdmin[]> {
  const { data } = await client.get<ExportSystemAdmin[]>('/admin/export-systems')
  return data
}

export async function createExportSystem(
  payload: ExportSystemCreate
): Promise<ExportSystemAdmin> {
  const { data } = await client.post<ExportSystemAdmin>('/admin/export-systems', payload)
  return data
}

export async function updateExportSystem(
  id: number,
  payload: Partial<ExportSystemCreate>
): Promise<ExportSystemAdmin> {
  const { data } = await client.put<ExportSystemAdmin>(
    `/admin/export-systems/${id}`,
    payload
  )
  return data
}

export async function deleteExportSystem(id: number): Promise<void> {
  await client.delete(`/admin/export-systems/${id}`)
}

// ========== ExportColumnMapping CRUD ==========

export async function fetchExportMappings(systemId: number): Promise<ExportMapping[]> {
  const { data } = await client.get<ExportMapping[]>(
    `/admin/export-systems/${systemId}/mappings`
  )
  return data
}

export async function createExportMapping(
  systemId: number,
  payload: ExportMappingCreate
): Promise<ExportMapping> {
  const { data } = await client.post<ExportMapping>(
    `/admin/export-systems/${systemId}/mappings`,
    payload
  )
  return data
}

export async function updateExportMapping(
  systemId: number,
  mappingId: number,
  payload: Partial<ExportMappingCreate>
): Promise<ExportMapping> {
  const { data } = await client.put<ExportMapping>(
    `/admin/export-systems/${systemId}/mappings/${mappingId}`,
    payload
  )
  return data
}

export async function deleteExportMapping(
  systemId: number,
  mappingId: number
): Promise<void> {
  await client.delete(`/admin/export-systems/${systemId}/mappings/${mappingId}`)
}

export async function reorderExportMappings(
  systemId: number,
  orderedIds: number[]
): Promise<ExportMapping[]> {
  const { data } = await client.put<ExportMapping[]>(
    `/admin/export-systems/${systemId}/mappings/reorder`,
    { ordered_ids: orderedIds }
  )
  return data
}
