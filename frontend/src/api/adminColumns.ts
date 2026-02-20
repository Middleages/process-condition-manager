import client from './client'
import type { ColumnSelectOptions } from '@/types/adminUser'

export async function fetchSelectColumns(): Promise<ColumnSelectOptions[]> {
  const { data } = await client.get<ColumnSelectOptions[]>('/admin/columns/select-options')
  return data
}

export async function updateSelectOptions(
  columnId: number,
  selectOptions: string[]
): Promise<ColumnSelectOptions> {
  const { data } = await client.put<ColumnSelectOptions>(
    `/admin/columns/${columnId}/select-options`,
    { select_options: selectOptions }
  )
  return data
}
