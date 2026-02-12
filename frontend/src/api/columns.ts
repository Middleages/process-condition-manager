import client from './client'
import type { ColumnCategory } from '@/types'

export async function fetchColumns(params?: {
  category_code?: string
}): Promise<ColumnCategory[]> {
  const { data } = await client.get<ColumnCategory[]>('/columns', { params })
  return data
}
