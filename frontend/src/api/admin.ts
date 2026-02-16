import client from './client'
import type {
  XmlMapping,
  XmlMappingCreateRequest,
  XmlMappingUpdateRequest,
  ColumnCategory,
  ColumnValidationsResponse,
  ValidationRuleCreate,
  BulkUploadResponse,
} from '@/types'

// ========== XML Mappings ==========
export async function fetchAdminMappings(params?: {
  is_active?: boolean
  search?: string
}): Promise<XmlMapping[]> {
  const { data } = await client.get<XmlMapping[]>('/admin/recipe-mappings', { params })
  return data
}

export async function createMapping(
  request: XmlMappingCreateRequest
): Promise<XmlMapping> {
  const { data } = await client.post<XmlMapping>('/admin/recipe-mappings', request)
  return data
}

export async function updateMapping(
  id: number,
  request: XmlMappingUpdateRequest
): Promise<XmlMapping> {
  const { data } = await client.put<XmlMapping>(`/admin/recipe-mappings/${id}`, request)
  return data
}

export async function deleteMapping(id: number): Promise<void> {
  await client.delete(`/admin/recipe-mappings/${id}`)
}

// ========== Validation Rules ==========
export async function fetchAdminColumns(params?: {
  category_code?: string
}): Promise<ColumnCategory[]> {
  const { data } = await client.get<ColumnCategory[]>('/admin/columns', { params })
  return data
}

export async function replaceValidations(
  columnId: number,
  validations: ValidationRuleCreate[]
): Promise<ColumnValidationsResponse> {
  const { data } = await client.put<ColumnValidationsResponse>(
    `/admin/columns/${columnId}/validations`,
    { validations }
  )
  return data
}

export async function bulkUploadValidations(file: File): Promise<BulkUploadResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await client.post<BulkUploadResponse>(
    '/admin/columns/validations/bulk',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  )
  return data
}
