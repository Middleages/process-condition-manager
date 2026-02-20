import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useCreateProduct, useUpdateProduct, useAdminLines } from '@/hooks/useAdminMaster'
import type { ProductResponse } from '@/api/adminMaster'

interface ProductFormModalProps {
  isOpen: boolean
  onClose: () => void
  product?: ProductResponse | null
}

export default function ProductFormModal({ isOpen, onClose, product }: ProductFormModalProps) {
  const isEdit = !!product
  const [productName, setProductName] = useState('')
  const [description, setDescription] = useState('')
  const [isBackbone, setIsBackbone] = useState(false)
  const [lineId, setLineId] = useState<string>('')
  const [partId, setPartId] = useState('')
  const [serverError, setServerError] = useState('')

  const createMutation = useCreateProduct()
  const updateMutation = useUpdateProduct()
  const { data: lines = [] } = useAdminLines()

  useEffect(() => {
    if (product) {
      setProductName(product.product_name)
      setDescription(product.description ?? '')
      setIsBackbone(product.is_backbone)
      setLineId(product.line_id?.toString() ?? '')
      setPartId(product.part_id ?? '')
    } else {
      setProductName('')
      setDescription('')
      setIsBackbone(false)
      setLineId('')
      setPartId('')
    }
    setServerError('')
  }, [product, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')
    const payload = {
      product_name: productName,
      description: description || null,
      is_backbone: isBackbone,
      line_id: lineId ? parseInt(lineId) : null,
      part_id: partId || null,
    }
    try {
      if (isEdit && product) {
        await updateMutation.mutateAsync({ id: product.id, payload })
      } else {
        await createMutation.mutateAsync(payload)
      }
      onClose()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setServerError(axiosErr.response?.data?.detail ?? '저장 중 오류가 발생했습니다.')
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isEdit ? '제품 수정' : '제품 추가'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">제품명 *</label>
            <Input value={productName} onChange={(e) => setProductName(e.target.value)} required placeholder="제품명" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">설명</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="설명" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">라인</label>
            <select
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
            >
              <option value="">라인 선택 (선택사항)</option>
              {lines.map((l) => (
                <option key={l.id} value={l.id.toString()}>{l.line_name} ({l.line_code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Part ID</label>
            <Input value={partId} onChange={(e) => setPartId(e.target.value)} placeholder="Part ID" />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isBackbone"
              checked={isBackbone}
              onChange={(e) => setIsBackbone(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="isBackbone" className="text-sm font-medium">Backbone 제품</label>
          </div>
          {serverError && <p className="text-red-600 text-sm">{serverError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>취소</Button>
            <Button type="submit" disabled={isPending}>{isPending ? '저장 중...' : '저장'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
