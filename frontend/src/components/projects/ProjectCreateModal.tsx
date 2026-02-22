import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { useProducts, useBackboneProducts } from '@/hooks/useProducts'
import { useLines } from '@/hooks/useLines'
import { useCreateProject } from '@/hooks/useProjects'
import { useAuthStore } from '@/stores/useAuthStore'
import { Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProjectCreateModal({ open, onOpenChange }: Props) {
  const navigate = useNavigate()
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const [selectedLineId, setSelectedLineId] = useState<number | undefined>(undefined)
  const { data: lines = [] } = useLines()
  const { data: allProducts = [] } = useProducts(
    selectedLineId ? { line_id: selectedLineId } : undefined
  )
  const { data: backboneProducts = [] } = useBackboneProducts(selectedLineId)
  const createProject = useCreateProject()

  const [productId, setProductId] = useState('')
  const [backboneProductId, setBackboneProductId] = useState('')

  const lineSelected = selectedLineId != null
  const productOptions = lineSelected
    ? allProducts.map((p) => ({ value: String(p.id), label: p.product_name }))
    : []
  const backboneOptions = lineSelected
    ? backboneProducts.map((p) => ({ value: String(p.id), label: p.product_name }))
    : []

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!productId || !backboneProductId || !currentUserId) return

    try {
      const result = await createProject.mutateAsync({
        product_id: Number(productId),
        backbone_product_id: Number(backboneProductId),
        created_by: currentUserId,
      })
      onOpenChange(false)
      setSelectedLineId(undefined)
      setProductId('')
      setBackboneProductId('')
      navigate(`/projects/${result.id}/edit`)
    } catch {
      // Error handled by TanStack Query
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>새 프로젝트 생성</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                라인 <span className="text-destructive">*</span>
              </label>
              <select
                value={selectedLineId ?? ''}
                onChange={(e) => {
                  setSelectedLineId(e.target.value ? Number(e.target.value) : undefined)
                  setProductId('')
                  setBackboneProductId('')
                }}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                required
              >
                <option value="">라인을 선택하세요</option>
                {lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.line_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">대상 제품</label>
              <Combobox
                options={productOptions}
                value={productId}
                onChange={setProductId}
                placeholder={lineSelected ? '제품을 선택하세요' : '라인을 먼저 선택하세요'}
                searchPlaceholder="제품 검색..."
                disabled={!lineSelected}
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Backbone 제품</label>
              <Combobox
                options={backboneOptions}
                value={backboneProductId}
                onChange={setBackboneProductId}
                placeholder={lineSelected ? 'Backbone을 선택하세요' : '라인을 먼저 선택하세요'}
                searchPlaceholder="Backbone 검색..."
                disabled={!lineSelected}
                required
              />
            </div>

            {!currentUserId && (
              <p className="text-sm text-destructive">
                헤더에서 사용자를 먼저 선택해주세요.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={!selectedLineId || !productId || !backboneProductId || !currentUserId || createProject.isPending}
            >
              {createProject.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              생성
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
