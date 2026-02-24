import client from './client'

// ========== Types ==========

export interface LineResponse {
  id: number
  line_code: string
  line_name: string
  created_at: string
  product_count: number
}

export interface LineCreate {
  line_code: string
  line_name: string
}

export interface ProductResponse {
  id: number
  product_name: string
  description: string | null
  line_id: number | null
  line_name: string | null
  part_id: string | null
  created_at: string
}

export interface ProductCreate {
  product_name: string
  description?: string | null
  line_id?: number | null
  part_id?: string | null
}

export interface LayerResponse {
  id: number
  layer_name: string
  step_seq: string
  layer_number: number
  sort_order: number
  created_at: string
}

export interface LayerCreate {
  layer_name: string
  step_seq: string
  layer_number: number
  sort_order: number
}

export interface ColumnMetadataResponse {
  id: number
  column_name: string
  display_name: string
  category_code: string | null
  data_type: string
  unit: string | null
  is_required: boolean
  sort_order: number
}

export interface ColumnMetadataUpdate {
  display_name?: string
  unit?: string | null
  is_required?: boolean
}

export interface CategoryResponse {
  id: number
  category_code: string
  category_name: string
  sort_order: number
  column_count: number
}

export interface CategoryUpdate {
  category_name?: string
  sort_order?: number
}

// ========== Lines ==========

export async function fetchAdminLines(): Promise<LineResponse[]> {
  const { data } = await client.get<LineResponse[]>('/admin/lines')
  return data
}

export async function createLine(payload: LineCreate): Promise<LineResponse> {
  const { data } = await client.post<LineResponse>('/admin/lines', payload)
  return data
}

export async function updateLine(id: number, payload: Partial<LineCreate>): Promise<LineResponse> {
  const { data } = await client.put<LineResponse>(`/admin/lines/${id}`, payload)
  return data
}

export async function deleteLine(id: number): Promise<void> {
  await client.delete(`/admin/lines/${id}`)
}

// ========== Products ==========

export async function fetchAdminProducts(lineId?: number): Promise<ProductResponse[]> {
  const { data } = await client.get<ProductResponse[]>('/admin/products', {
    params: lineId ? { line_id: lineId } : undefined,
  })
  return data
}

export async function createProduct(payload: ProductCreate): Promise<ProductResponse> {
  const { data } = await client.post<ProductResponse>('/admin/products', payload)
  return data
}

export async function updateProduct(
  id: number,
  payload: Partial<ProductCreate>
): Promise<ProductResponse> {
  const { data } = await client.put<ProductResponse>(`/admin/products/${id}`, payload)
  return data
}

export async function deleteProduct(id: number): Promise<void> {
  await client.delete(`/admin/products/${id}`)
}

// ========== Layers ==========

export async function fetchAdminLayers(): Promise<LayerResponse[]> {
  const { data } = await client.get<LayerResponse[]>('/admin/layers')
  return data
}

export async function createLayer(payload: LayerCreate): Promise<LayerResponse> {
  const { data } = await client.post<LayerResponse>('/admin/layers', payload)
  return data
}

export async function updateLayer(
  id: number,
  payload: Partial<LayerCreate>
): Promise<LayerResponse> {
  const { data } = await client.put<LayerResponse>(`/admin/layers/${id}`, payload)
  return data
}

export async function deleteLayer(id: number): Promise<void> {
  await client.delete(`/admin/layers/${id}`)
}

export async function reorderLayers(orderedIds: number[]): Promise<LayerResponse[]> {
  const { data } = await client.put<LayerResponse[]>('/admin/layers/reorder', {
    ordered_ids: orderedIds,
  })
  return data
}

// ========== Columns ==========

export async function updateColumnMetadata(
  id: number,
  payload: ColumnMetadataUpdate
): Promise<ColumnMetadataResponse> {
  const { data } = await client.put<ColumnMetadataResponse>(
    `/admin/columns/${id}/metadata`,
    payload
  )
  return data
}

// ========== Categories ==========

export async function fetchCategories(): Promise<CategoryResponse[]> {
  const { data } = await client.get<CategoryResponse[]>('/admin/categories')
  return data
}

export async function updateCategory(
  id: number,
  payload: CategoryUpdate
): Promise<CategoryResponse> {
  const { data } = await client.put<CategoryResponse>(`/admin/categories/${id}`, payload)
  return data
}

export async function reorderCategories(orderedIds: number[]): Promise<CategoryResponse[]> {
  const { data } = await client.put<CategoryResponse[]>('/admin/categories/reorder', {
    ordered_ids: orderedIds,
  })
  return data
}
