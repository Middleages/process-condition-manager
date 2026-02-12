import { useQuery } from '@tanstack/react-query'
import { fetchProducts } from '@/api/products'

export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (filters: { is_backbone?: boolean; search?: string }) =>
    [...productKeys.lists(), filters] as const,
}

export function useProducts(params?: { is_backbone?: boolean; search?: string }) {
  return useQuery({
    queryKey: productKeys.list(params ?? {}),
    queryFn: () => fetchProducts(params),
  })
}

export function useBackboneProducts() {
  return useProducts({ is_backbone: true })
}
