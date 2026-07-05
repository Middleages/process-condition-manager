import { apiClient } from './client'
import type { CategoryCreate, CategoryOut, CategoryUpdate } from './types'

export async function listCategories(includeInactive = false): Promise<CategoryOut[]> {
  const response = await apiClient.get<CategoryOut[]>('/parameters/categories', {
    params: { include_inactive: includeInactive },
  })
  return response.data
}

export async function createCategory(data: CategoryCreate): Promise<CategoryOut> {
  const response = await apiClient.post<CategoryOut>('/parameters/categories', data)
  return response.data
}

export async function updateCategory(
  categoryId: number,
  data: CategoryUpdate,
): Promise<CategoryOut> {
  const response = await apiClient.patch<CategoryOut>(`/parameters/categories/${categoryId}`, data)
  return response.data
}
