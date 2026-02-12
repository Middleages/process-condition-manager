import client from './client'
import type { Product, ProductLayerInfo } from '@/types'

export async function fetchProducts(params?: {
  line_id?: number
  is_backbone?: boolean
  search?: string
}): Promise<Product[]> {
  const { data } = await client.get<Product[]>('/products', { params })
  return data
}

export async function fetchProductLayers(productId: number): Promise<ProductLayerInfo[]> {
  const { data } = await client.get<ProductLayerInfo[]>(`/products/${productId}/layers`)
  return data
}
