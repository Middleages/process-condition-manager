import { useState } from 'react'
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LayerFormModal } from './LayerFormModal'
import { useAdminLayers, useDeleteLayer, useReorderLayers } from '@/hooks/useAdminMaster'
import type { LayerResponse } from '@/api/adminMaster'

export function LayerManagementPanel() {
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedLayer, setSelectedLayer] = useState<LayerResponse | null>(null)

  const { data: layers = [], isLoading } = useAdminLayers()
  const deleteMutation = useDeleteLayer()
  const reorderMutation = useReorderLayers()

  const handleAdd = () => {
    setSelectedLayer(null)
    setIsFormOpen(true)
  }

  const handleEdit = (layer: LayerResponse) => {
    setSelectedLayer(layer)
    setIsFormOpen(true)
  }

  const handleDelete = async (layer: LayerResponse) => {
    if (!confirm(`'${layer.layer_name}' 레이어를 삭제하시겠습니까?\n연결된 프로젝트 레이어가 있으면 삭제할 수 없습니다.`)) return
    try {
      await deleteMutation.mutateAsync(layer.id)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      alert(axiosErr.response?.data?.detail ?? '삭제 중 오류가 발생했습니다.')
    }
  }

  const handleMoveUp = (index: number) => {
    if (index === 0) return
    const newOrder = [...layers]
    ;[newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]]
    reorderMutation.mutate(newOrder.map((l) => l.id))
  }

  const handleMoveDown = (index: number) => {
    if (index === layers.length - 1) return
    const newOrder = [...layers]
    ;[newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]]
    reorderMutation.mutate(newOrder.map((l) => l.id))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-medium">레이어 목록</h2>
        <Button size="sm" onClick={handleAdd}>
          <Plus className="h-4 w-4 mr-1" />
          레이어 추가
        </Button>
      </div>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">순서</th>
              <th className="px-4 py-3 text-left font-medium">레이어 이름</th>
              <th className="px-4 py-3 text-left font-medium">Step Seq</th>
              <th className="px-4 py-3 text-left font-medium">레이어 번호</th>
              <th className="px-4 py-3 text-left font-medium">정렬</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">로딩 중...</td></tr>
            )}
            {!isLoading && layers.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">레이어가 없습니다.</td></tr>
            )}
            {layers.map((layer, index) => (
              <tr key={layer.id} className="border-t hover:bg-muted/50">
                <td className="px-4 py-3 text-muted-foreground">
                  <div className="flex gap-0.5">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleMoveUp(index)} disabled={index === 0}>
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleMoveDown(index)} disabled={index === layers.length - 1}>
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
                <td className="px-4 py-3 font-medium">{layer.layer_name}</td>
                <td className="px-4 py-3 font-mono text-xs">{layer.step_seq}</td>
                <td className="px-4 py-3 text-muted-foreground">{layer.layer_number}</td>
                <td className="px-4 py-3 text-muted-foreground">{layer.sort_order}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(layer)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(layer)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LayerFormModal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} layer={selectedLayer} />
    </div>
  )
}
