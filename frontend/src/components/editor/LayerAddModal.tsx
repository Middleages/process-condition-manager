import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useBackboneProducts } from '@/hooks/useProducts'
import { useAddLayer } from '@/hooks/useProjects'
import { useAuthStore } from '@/stores/useAuthStore'
import { useToastStore } from '@/stores/useToastStore'
import { Loader2 } from 'lucide-react'
import type { ProjectLayerData, LayerInfo, BackboneProduct } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  existingLayers: ProjectLayerData[]
  allLayers: LayerInfo[]
}

export function LayerAddModal({
  open,
  onOpenChange,
  projectId,
  existingLayers,
  allLayers,
}: Props) {
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const addToast = useToastStore((s) => s.addToast)
  const { data: backboneProducts = [] } = useBackboneProducts()
  const addLayer = useAddLayer(projectId)

  const [layerId, setLayerId] = useState('')
  const [useSource, setUseSource] = useState(false)
  const [sourceProductId, setSourceProductId] = useState('')

  // Filter out already-existing layers
  const existingLayerIds = new Set(existingLayers.map((l) => l.layer_id))
  const availableLayers = allLayers.filter((l) => !existingLayerIds.has(l.id))

  // Reset on open
  useEffect(() => {
    if (open) {
      setLayerId('')
      setUseSource(false)
      setSourceProductId('')
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!layerId || !currentUserId) return

    try {
      await addLayer.mutateAsync({
        layer_id: Number(layerId),
        source_product_id: useSource && sourceProductId ? Number(sourceProductId) : undefined,
        changed_by: currentUserId,
      })
      addToast('레이어가 추가되었습니다.', 'success')
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
          <DialogTitle>레이어 추가</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">추가할 레이어</label>
              {availableLayers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  추가 가능한 레이어가 없습니다.
                </p>
              ) : (
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={layerId}
                  onChange={(e) => setLayerId(e.target.value)}
                  required
                >
                  <option value="">레이어를 선택하세요</option>
                  {availableLayers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.layer_name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useSource}
                  onChange={(e) => setUseSource(e.target.checked)}
                  className="rounded"
                />
                Backbone에서 조건 복사
              </label>
            </div>

            {useSource && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">소스 Backbone 제품</label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={sourceProductId}
                  onChange={(e) => setSourceProductId(e.target.value)}
                >
                  <option value="">Backbone 제품을 선택하세요</option>
                  {backboneProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {getProductLabel(p)}
                    </option>
                  ))}
                </select>
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
                !layerId ||
                !currentUserId ||
                availableLayers.length === 0 ||
                addLayer.isPending
              }
            >
              {addLayer.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              추가
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
