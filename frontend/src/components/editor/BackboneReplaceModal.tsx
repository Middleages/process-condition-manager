import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useBackboneProducts, useBackboneLayers } from '@/hooks/useProducts'
import { useReplaceBackbone } from '@/hooks/useProjects'
import { useAuthStore } from '@/stores/useAuthStore'
import { useToastStore } from '@/stores/useToastStore'
import { Loader2 } from 'lucide-react'
import type { ProjectLayerData, BackboneProduct } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  layer: ProjectLayerData | null
}

export function BackboneReplaceModal({ open, onOpenChange, projectId, layer }: Props) {
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const addToast = useToastStore((s) => s.addToast)
  const { data: backboneProducts = [] } = useBackboneProducts()
  const replaceBackbone = useReplaceBackbone(projectId)

  const [sourceProductId, setSourceProductId] = useState('')
  const [sourceLayerName, setSourceLayerName] = useState('')

  // Fetch layers from the Approved project of the selected backbone product
  const { data: sourceLayers = [], isLoading: loadingLayers } = useBackboneLayers(
    sourceProductId ? Number(sourceProductId) : undefined
  )

  // Auto-match layer by name when layers are loaded
  useEffect(() => {
    if (!sourceLayers.length || !layer?.layer_name) return
    const match = sourceLayers.find((l) => l.layer_name === layer.layer_name)
    setSourceLayerName(match ? match.layer_name : '')
  }, [sourceLayers, layer?.layer_name])

  // Reset source layer name when product selection changes
  useEffect(() => {
    setSourceLayerName('')
  }, [sourceProductId])

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSourceProductId('')
      setSourceLayerName('')
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!layer || !sourceProductId || !currentUserId) return

    try {
      const result = await replaceBackbone.mutateAsync({
        projectLayerId: layer.id,
        req: {
          source_product_id: Number(sourceProductId),
          source_layer_name: sourceLayerName || null,
          changed_by: currentUserId,
        },
      })
      addToast(
        `Backbone 교체 완료 (${result.changed_columns}개 컬럼 변경)`,
        'success'
      )
      onOpenChange(false)
    } catch {
      // Error handled by interceptor
    }
  }

  // Build product option label with version info
  const getProductLabel = (p: BackboneProduct) => {
    const versionSuffix = p.revision
      ? ` (v${p.revision}${p.approved_at ? ', ' + new Date(p.approved_at).toLocaleDateString('ko-KR') : ''})`
      : ''
    return `${p.product_name}${versionSuffix}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Backbone 교체</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-md px-3 py-2 text-sm">
              <span className="text-muted-foreground">대상 레이어:</span>{' '}
              <span className="font-medium">{layer?.layer_name}</span>
              {layer?.backbone_product_name && (
                <span className="text-muted-foreground ml-2">
                  (현재: {layer.backbone_product_name})
                </span>
              )}
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">소스 Backbone 제품</label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={sourceProductId}
                onChange={(e) => setSourceProductId(e.target.value)}
                required
              >
                <option value="">Backbone 제품을 선택하세요</option>
                {backboneProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {getProductLabel(p)}
                  </option>
                ))}
              </select>
            </div>

            {sourceProductId && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  소스 레이어
                  {sourceLayerName && (
                    <span className="text-muted-foreground font-normal ml-1">(자동 매칭됨)</span>
                  )}
                </label>
                {loadingLayers ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    레이어 목록 로드 중...
                  </div>
                ) : (
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={sourceLayerName}
                    onChange={(e) => setSourceLayerName(e.target.value)}
                    required
                  >
                    <option value="">레이어를 선택하세요</option>
                    {sourceLayers.map((l) => (
                      <option key={l.id} value={l.layer_name}>
                        {l.layer_name}
                      </option>
                    ))}
                  </select>
                )}
                {!loadingLayers && sourceLayers.length > 0 && !sourceLayerName && (
                  <p className="text-xs text-amber-600 mt-1">
                    매칭되는 레이어가 없습니다. 수동으로 선택해주세요.
                  </p>
                )}
                {!loadingLayers && sourceLayers.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    이 제품의 Approved 프로젝트에 레이어가 없습니다.
                  </p>
                )}
              </div>
            )}

            {!currentUserId && (
              <p className="text-sm text-destructive">
                헤더에서 사용자를 먼저 선택해주세요.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button
              type="submit"
              disabled={
                !sourceProductId ||
                !sourceLayerName ||
                !currentUserId ||
                replaceBackbone.isPending
              }
            >
              {replaceBackbone.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              교체 실행
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
