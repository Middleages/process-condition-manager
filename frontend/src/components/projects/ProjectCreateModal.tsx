import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { useProducts, useBackboneProducts } from '@/hooks/useProducts'
import { useCreateProject } from '@/hooks/useProjects'
import { useUserStore } from '@/stores/useUserStore'
import { Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProjectCreateModal({ open, onOpenChange }: Props) {
  const navigate = useNavigate()
  const currentUserId = useUserStore((s) => s.currentUserId)
  const { data: allProducts = [] } = useProducts()
  const { data: backboneProducts = [] } = useBackboneProducts()
  const createProject = useCreateProject()

  const [productId, setProductId] = useState('')
  const [backboneProductId, setBackboneProductId] = useState('')

  const productOptions = allProducts.map((p) => ({
    value: String(p.id),
    label: p.product_name,
  }))

  const backboneOptions = backboneProducts.map((p) => ({
    value: String(p.id),
    label: p.product_name,
  }))

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
              <label className="text-sm font-medium mb-1.5 block">대상 제품</label>
              <Combobox
                options={productOptions}
                value={productId}
                onChange={setProductId}
                placeholder="제품을 선택하세요"
                searchPlaceholder="제품 검색..."
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Backbone 제품</label>
              <Combobox
                options={backboneOptions}
                value={backboneProductId}
                onChange={setBackboneProductId}
                placeholder="Backbone을 선택하세요"
                searchPlaceholder="Backbone 검색..."
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
              disabled={!productId || !backboneProductId || !currentUserId || createProject.isPending}
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
