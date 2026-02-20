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
import { useCreateLayer, useUpdateLayer } from '@/hooks/useAdminMaster'
import type { LayerResponse } from '@/api/adminMaster'

interface LayerFormModalProps {
  isOpen: boolean
  onClose: () => void
  layer?: LayerResponse | null
}

export default function LayerFormModal({ isOpen, onClose, layer }: LayerFormModalProps) {
  const isEdit = !!layer
  const [layerName, setLayerName] = useState('')
  const [stepSeq, setStepSeq] = useState('')
  const [layerNumber, setLayerNumber] = useState<number>(1)
  const [sortOrder, setSortOrder] = useState<number>(0)
  const [serverError, setServerError] = useState('')

  const createMutation = useCreateLayer()
  const updateMutation = useUpdateLayer()

  useEffect(() => {
    if (layer) {
      setLayerName(layer.layer_name)
      setStepSeq(layer.step_seq)
      setLayerNumber(layer.layer_number)
      setSortOrder(layer.sort_order)
    } else {
      setLayerName('')
      setStepSeq('')
      setLayerNumber(1)
      setSortOrder(0)
    }
    setServerError('')
  }, [layer, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')
    const payload = { layer_name: layerName, step_seq: stepSeq, layer_number: layerNumber, sort_order: sortOrder }
    try {
      if (isEdit && layer) {
        await updateMutation.mutateAsync({ id: layer.id, payload })
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
          <DialogTitle>{isEdit ? '레이어 수정' : '레이어 추가'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">레이어 이름 *</label>
            <Input value={layerName} onChange={(e) => setLayerName(e.target.value)} required placeholder="예: BPSG" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Step Seq *</label>
            <Input value={stepSeq} onChange={(e) => setStepSeq(e.target.value)} required placeholder="예: 001" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">레이어 번호 *</label>
              <Input
                type="number"
                value={layerNumber}
                onChange={(e) => setLayerNumber(parseInt(e.target.value) || 1)}
                required
                min={1}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">정렬 순서</label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
              />
            </div>
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
