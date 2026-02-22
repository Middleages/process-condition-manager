import { useQuery } from '@tanstack/react-query'
import { fetchProducts, fetchAllLayers, fetchBackboneProducts, fetchBackboneLayers } from '@/api/products'

export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (filters: { search?: string; line_id?: number }) =>
    [...productKeys.lists(), filters] as const,
  backbones: () => [...productKeys.all, 'backbones'] as const,
  backboneList: (lineId?: number) => [...productKeys.backbones(), { line_id: lineId }] as const,
  backboneLayers: (productId: number) => [...productKeys.all, 'backbone-layers', productId] as const,
}

export function useProducts(params?: { search?: string; line_id?: number }) {
  return useQuery({
    queryKey: productKeys.list(params ?? {}),
    queryFn: () => fetchProducts(params),
  })
}

// Uses the dedicated dynamic backbone endpoint (GET /api/products/backbones)
export function useBackboneProducts(lineId?: number) {
  return useQuery({
    queryKey: productKeys.backboneList(lineId),
    queryFn: () => fetchBackboneProducts(lineId),
  })
}

// Fetches layers from the Approved project of a backbone product
export function useBackboneLayers(productId: number | undefined) {
  return useQuery({
    queryKey: productKeys.backboneLayers(productId ?? 0),
    queryFn: () => fetchBackboneLayers(productId!),
    enabled: !!productId,
  })
}

export function useAllLayers() {
  return useQuery({
    queryKey: ['layers', 'all'] as const,
    queryFn: fetchAllLayers,
  })
}
