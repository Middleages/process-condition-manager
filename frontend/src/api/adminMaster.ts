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
  category_id: number | null
  category_code: string | null
  data_type: string
  unit: string | null
  is_required: boolean
  use_yn: boolean
  sort_order: number
}

export interface ColumnMetadataUpdate {
  display_name?: string
  unit?: string | null
  is_required?: boolean
  use_yn?: boolean
}

export interface ColumnCreateRequest {
  column_name: string
  display_name: string
  category_id: number
  data_type: string
  unit?: string | null
  is_required?: boolean
  use_yn?: boolean
  select_options?: string[] | null
}

export interface CategoryResponse {
  id: number
  category_code: string
  category_name: string
  sort_order: number
  column_count: number
}

export interface CategoryCreateRequest {
  category_code: string
  category_name: string
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

export async function fetchAdminColumns(): Promise<ColumnMetadataResponse[]> {
  // 관리자용: use_yn 무관 전체 컬럼 조회 (비공개 컬럼 관리 화면용)
  const { data } = await client.get<ColumnMetadataResponse[]>('/admin/columns')
  return data
}

export async function createColumn(payload: ColumnCreateRequest): Promise<ColumnMetadataResponse> {
  const { data } = await client.post<ColumnMetadataResponse>('/admin/columns', payload)
  return data
}

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

export async function deleteColumn(id: number): Promise<void> {
  await client.delete(`/admin/columns/${id}`)
}

// ========== Categories ==========

export async function fetchCategories(): Promise<CategoryResponse[]> {
  const { data } = await client.get<CategoryResponse[]>('/admin/categories')
  return data
}

export async function createCategory(payload: CategoryCreateRequest): Promise<CategoryResponse> {
  const { data } = await client.post<CategoryResponse>('/admin/categories', payload)
  return data
}

export async function updateCategory(
  id: number,
  payload: CategoryUpdate
): Promise<CategoryResponse> {
  const { data } = await client.put<CategoryResponse>(`/admin/categories/${id}`, payload)
  return data
}

export async function deleteCategory(id: number): Promise<void> {
  await client.delete(`/admin/categories/${id}`)
}

export async function reorderCategories(orderedIds: number[]): Promise<CategoryResponse[]> {
  const { data } = await client.put<CategoryResponse[]>('/admin/categories/reorder', {
    ordered_ids: orderedIds,
  })
  return data
}

// ========== Equipments ==========

export interface EquipmentResponse {
  id: number
  line_id: number
  line_name: string
  equipment_name: string
  equipment_model: string | null
  prc: string | null
  ip: string | null
  ftp_id: string | null
  is_active: boolean
  sort_order: number
}

export interface EquipmentCreate {
  line_id: number
  equipment_name: string
  equipment_model?: string
  prc?: string
  ip?: string
  ftp_id?: string
  ftp_pw?: string
  is_active?: boolean
  sort_order?: number
}

export async function fetchAdminEquipments(lineId?: number): Promise<EquipmentResponse[]> {
  const { data } = await client.get<EquipmentResponse[]>('/admin/equipments', {
    params: lineId ? { line_id: lineId } : undefined,
  })
  return data
}

export async function createEquipment(payload: EquipmentCreate): Promise<EquipmentResponse> {
  const { data } = await client.post<EquipmentResponse>('/admin/equipments', payload)
  return data
}

export async function updateEquipment(
  id: number,
  payload: Partial<EquipmentCreate>
): Promise<EquipmentResponse> {
  const { data } = await client.put<EquipmentResponse>(`/admin/equipments/${id}`, payload)
  return data
}

export async function deleteEquipment(id: number): Promise<void> {
  await client.delete(`/admin/equipments/${id}`)
}
