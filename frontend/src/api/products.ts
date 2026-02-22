import client from './client'
import type { Product, ProductLayerInfo, LayerInfo, BackboneProduct, BackboneLayer } from '@/types'

export async function fetchProducts(params?: {
  line_id?: number
  search?: string
}): Promise<Product[]> {
  const { data } = await client.get<Product[]>('/products', { params })
  return data
}

// Fetch backbone products from the dedicated dynamic endpoint
export async function fetchBackboneProducts(lineId?: number): Promise<BackboneProduct[]> {
  const params = lineId ? { line_id: lineId } : undefined
  const { data } = await client.get<BackboneProduct[]>('/products/backbones', { params })
  return data
}

// Fetch layers from the Approved project of a backbone product
export async function fetchBackboneLayers(productId: number): Promise<BackboneLayer[]> {
  const { data } = await client.get<BackboneLayer[]>(`/products/${productId}/backbone-layers`)
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
