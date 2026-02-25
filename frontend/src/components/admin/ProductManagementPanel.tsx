import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProductFormModal } from './ProductFormModal'
import { useAdminProducts, useDeleteProduct, useAdminLines } from '@/hooks/useAdminMaster'
import type { ProductResponse } from '@/api/adminMaster'

interface ProductManagementPanelProps {
  readOnly?: boolean
}

export function ProductManagementPanel({ readOnly = false }: ProductManagementPanelProps) {
  const [selectedLineId, setSelectedLineId] = useState<string>('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<ProductResponse | null>(null)

  const { data: lines = [] } = useAdminLines()
  const { data: products = [], isLoading } = useAdminProducts(
    selectedLineId ? parseInt(selectedLineId) : undefined
  )
  const deleteMutation = useDeleteProduct()

  const handleAdd = () => {
    setSelectedProduct(null)
    setIsFormOpen(true)
  }

  const handleEdit = (product: ProductResponse) => {
    setSelectedProduct(product)
    setIsFormOpen(true)
  }

  const handleDelete = async (product: ProductResponse) => {
    if (!confirm(`'${product.product_name}' 제품을 삭제하시겠습니까?\n연결된 프로젝트가 있으면 삭제할 수 없습니다.`)) return
    try {
      await deleteMutation.mutateAsync(product.id)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      alert(axiosErr.response?.data?.detail ?? '삭제 중 오류가 발생했습니다.')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="font-medium">제품 목록</h2>
          <select
            className="border border-input rounded-md px-3 py-1.5 text-sm bg-background"
            value={selectedLineId}
            onChange={(e) => setSelectedLineId(e.target.value)}
          >
            <option value="">전체 라인</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id.toString()}>{l.line_name}</option>
            ))}
          </select>
        </div>
        {!readOnly && (
          <Button size="sm" onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-1" />
            제품 추가
          </Button>
        )}
        {readOnly && <span className="text-xs text-muted-foreground">읽기 전용</span>}
      </div>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">제품명</th>
              <th className="px-4 py-3 text-left font-medium">설명</th>
              <th className="px-4 py-3 text-left font-medium">라인</th>
              <th className="px-4 py-3 text-left font-medium">Part ID</th>
              <th className="px-4 py-3 text-left font-medium">생성일</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">로딩 중...</td></tr>
            )}
            {!isLoading && products.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">제품이 없습니다.</td></tr>
            )}
            {products.map((product) => (
              <tr key={product.id} className="border-t hover:bg-muted/50">
                <td className="px-4 py-3 font-medium">{product.product_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{product.description ?? '-'}</td>
                <td className="px-4 py-3 text-muted-foreground">{product.line_name ?? '-'}</td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{product.part_id ?? '-'}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(product.created_at).toLocaleDateString('ko-KR')}
                </td>
                <td className="px-4 py-3">
                  {!readOnly && (
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(product)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(product)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ProductFormModal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} product={selectedProduct} />
    </div>
  )
}
