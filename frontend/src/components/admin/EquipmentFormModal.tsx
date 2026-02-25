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
import { useCreateEquipment, useUpdateEquipment, useAdminLines } from '@/hooks/useAdminMaster'
import type { EquipmentResponse, EquipmentCreate } from '@/api/adminMaster'

interface EquipmentFormModalProps {
  isOpen: boolean
  onClose: () => void
  equipment?: EquipmentResponse | null
  lineId?: number
}

export function EquipmentFormModal({ isOpen, onClose, equipment, lineId }: EquipmentFormModalProps) {
  const isEdit = !!equipment
  const [formLineId, setFormLineId] = useState<string>('')
  const [equipmentName, setEquipmentName] = useState('')
  const [equipmentModel, setEquipmentModel] = useState('')
  const [prc, setPrc] = useState('')
  const [ip, setIp] = useState('')
  const [ftpId, setFtpId] = useState('')
  const [ftpPw, setFtpPw] = useState('')
  const [serverError, setServerError] = useState('')

  const createMutation = useCreateEquipment()
  const updateMutation = useUpdateEquipment()
  const { data: lines = [] } = useAdminLines()

  useEffect(() => {
    if (equipment) {
      setFormLineId(equipment.line_id.toString())
      setEquipmentName(equipment.equipment_name)
      setEquipmentModel(equipment.equipment_model ?? '')
      setPrc(equipment.prc ?? '')
      setIp(equipment.ip ?? '')
      setFtpId(equipment.ftp_id ?? '')
      setFtpPw('')
    } else {
      setFormLineId(lineId ? lineId.toString() : '')
      setEquipmentName('')
      setEquipmentModel('')
      setPrc('')
      setIp('')
      setFtpId('')
      setFtpPw('')
    }
    setServerError('')
  }, [equipment, lineId, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')

    if (!formLineId) {
      setServerError('라인을 선택해주세요.')
      return
    }

    const payload: EquipmentCreate = {
      line_id: parseInt(formLineId),
      equipment_name: equipmentName,
      equipment_model: equipmentModel || undefined,
      prc: prc || undefined,
      ip: ip || undefined,
      ftp_id: ftpId || undefined,
      ftp_pw: ftpPw || undefined,
    }

    try {
      if (isEdit && equipment) {
        await updateMutation.mutateAsync({ id: equipment.id, payload })
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
          <DialogTitle>{isEdit ? '설비 수정' : '설비 추가'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">라인 *</label>
            <select
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              value={formLineId}
              onChange={(e) => setFormLineId(e.target.value)}
              disabled={isEdit}
              required
            >
              <option value="">라인 선택</option>
              {lines.map((l) => (
                <option key={l.id} value={l.id.toString()}>
                  {l.line_name} ({l.line_code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">설비명 *</label>
            <Input
              value={equipmentName}
              onChange={(e) => setEquipmentName(e.target.value)}
              required
              placeholder="설비명"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">모델</label>
            <Input
              value={equipmentModel}
              onChange={(e) => setEquipmentModel(e.target.value)}
              placeholder="설비 모델명"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">PRC</label>
            <Input
              value={prc}
              onChange={(e) => setPrc(e.target.value)}
              placeholder="PRC"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">IP 주소</label>
            <Input
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="예: 192.168.1.100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">FTP ID</label>
            <Input
              value={ftpId}
              onChange={(e) => setFtpId(e.target.value)}
              placeholder="FTP ID"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              FTP 비밀번호{isEdit ? ' (변경 시에만 입력)' : ''}
            </label>
            <Input
              type="password"
              value={ftpPw}
              onChange={(e) => setFtpPw(e.target.value)}
              placeholder={isEdit ? '변경하지 않으려면 비워두세요' : 'FTP 비밀번호'}
            />
          </div>
          {serverError && <p className="text-red-600 text-sm">{serverError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              취소
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
