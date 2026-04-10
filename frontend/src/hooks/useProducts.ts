import { useQuery } from '@tanstack/react-query'
import { fetchProducts, fetchAllLayers } from '@/api/products'

export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (filters: { search?: string; line_id?: number }) =>
    [...productKeys.lists(), filters] as const,
}

export function useProducts(params?: { search?: string; line_id?: number }) {
  return useQuery({
    queryKey: productKeys.list(params ?? {}),
    queryFn: () => fetchProducts(params),
  })
}

export function useAllLayers() {
  return useQuery({
    queryKey: ['layers', 'all'] as const,
    queryFn: fetchAllLayers,
  })
}
