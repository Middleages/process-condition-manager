import client from './client'
import type {
  ExportDataSource,
  ExportDataSourceCreate,
  ExportDataSourceUpdate,
  ColumnInfo,
} from '@/types/export'

// ========== ExportDataSource CRUD ==========

export async function fetchDataSources(): Promise<ExportDataSource[]> {
  const { data } = await client.get<ExportDataSource[]>('/admin/data-sources')
  return data
}

export async function createDataSource(
  payload: ExportDataSourceCreate
): Promise<ExportDataSource> {
  const { data } = await client.post<ExportDataSource>('/admin/data-sources', payload)
  return data
}

export async function updateDataSource(
  id: number,
  payload: ExportDataSourceUpdate
): Promise<ExportDataSource> {
  const { data } = await client.put<ExportDataSource>(`/admin/data-sources/${id}`, payload)
  return data
}

export async function deleteDataSource(id: number): Promise<void> {
  await client.delete(`/admin/data-sources/${id}`)
}

export async function fetchDataSourceColumns(id: number): Promise<ColumnInfo[]> {
  const { data } = await client.get<ColumnInfo[]>(`/admin/data-sources/${id}/columns`)
  return data
}
