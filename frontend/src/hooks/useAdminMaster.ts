import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchAdminLines,
  createLine,
  updateLine,
  deleteLine,
  fetchAdminProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  fetchAdminLayers,
  createLayer,
  updateLayer,
  deleteLayer,
  reorderLayers,
  updateColumnMetadata,
  fetchCategories,
  updateCategory,
  reorderCategories,
} from '@/api/adminMaster'
import type {
  LineCreate,
  ProductCreate,
  LayerCreate,
  ColumnMetadataUpdate,
  CategoryUpdate,
} from '@/api/adminMaster'

export const adminMasterKeys = {
  lines: () => ['adminLines'] as const,
  products: (lineId?: number) =>
    lineId ? (['adminProducts', lineId] as const) : (['adminProducts'] as const),
  layers: () => ['adminLayers'] as const,
  columns: () => ['adminColumns'] as const,
  categories: () => ['adminCategories'] as const,
}

// ========== Lines ==========

export function useAdminLines() {
  return useQuery({
    queryKey: adminMasterKeys.lines(),
    queryFn: fetchAdminLines,
  })
}

export function useCreateLine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: LineCreate) => createLine(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminMasterKeys.lines() })
      queryClient.invalidateQueries({ queryKey: ['lines'] })
    },
  })
}

export function useUpdateLine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<LineCreate> }) =>
      updateLine(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminMasterKeys.lines() })
      queryClient.invalidateQueries({ queryKey: ['lines'] })
    },
  })
}

export function useDeleteLine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteLine(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminMasterKeys.lines() })
      queryClient.invalidateQueries({ queryKey: ['lines'] })
    },
  })
}

// ========== Products ==========

export function useAdminProducts(lineId?: number) {
  return useQuery({
    queryKey: adminMasterKeys.products(lineId),
    queryFn: () => fetchAdminProducts(lineId),
  })
}

export function useCreateProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: ProductCreate) => createProduct(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminProducts'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

export function useUpdateProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<ProductCreate> }) =>
      updateProduct(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminProducts'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

export function useDeleteProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminProducts'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

// ========== Layers ==========

export function useAdminLayers() {
  return useQuery({
    queryKey: adminMasterKeys.layers(),
    queryFn: fetchAdminLayers,
  })
}

export function useCreateLayer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: LayerCreate) => createLayer(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminMasterKeys.layers() })
      queryClient.invalidateQueries({ queryKey: ['layers'] })
    },
  })
}

export function useUpdateLayer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<LayerCreate> }) =>
      updateLayer(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminMasterKeys.layers() })
      queryClient.invalidateQueries({ queryKey: ['layers'] })
    },
  })
}

export function useDeleteLayer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteLayer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminMasterKeys.layers() })
      queryClient.invalidateQueries({ queryKey: ['layers'] })
    },
  })
}

export function useReorderLayers() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (orderedIds: number[]) => reorderLayers(orderedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminMasterKeys.layers() })
      queryClient.invalidateQueries({ queryKey: ['layers'] })
    },
  })
}

// ========== Columns ==========

export function useUpdateColumnMetadata() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ColumnMetadataUpdate }) =>
      updateColumnMetadata(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminMasterKeys.columns() })
      queryClient.invalidateQueries({ queryKey: ['columns'] })
    },
  })
}

// ========== Categories ==========

export function useAdminCategories() {
  return useQuery({
    queryKey: adminMasterKeys.categories(),
    queryFn: fetchCategories,
  })
}

export function useUpdateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: CategoryUpdate }) =>
      updateCategory(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminMasterKeys.categories() })
      queryClient.invalidateQueries({ queryKey: ['columns'] })
    },
  })
}

export function useReorderCategories() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (orderedIds: number[]) => reorderCategories(orderedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminMasterKeys.categories() })
      queryClient.invalidateQueries({ queryKey: ['columns'] })
    },
  })
}
