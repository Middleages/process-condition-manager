import client from './client'
import type { Product, ProductLayerInfo, LayerInfo } from '@/types'

export async function fetchProducts(params?: {
  line_id?: number
  search?: string
}): Promise<Product[]> {
  const { data } = await client.get<Product[]>('/products', { params })
  return data
}

export async function fetchProductLayers(productId: number): Promise<ProductLayerInfo[]> {
  const { data } = await client.get<ProductLayerInfo[]>(`/products/${productId}/layers`)
  return data
}

export async function fetchAllLayers(): Promise<LayerInfo[]> {
  const { data } = await client.get<LayerInfo[]>('/products/layers/all')
  return data
}
