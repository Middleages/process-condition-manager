import { useEffect, useState } from 'react'
import { useCreateExportSystem, useUpdateExportSystem } from '@/hooks/useExportAdmin'
import type { ExportSystemAdmin, ExportSystemCreate } from '@/types/export'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ExportSystemFormProps {
  isOpen: boolean
  onClose: () => void
  system?: ExportSystemAdmin | null
}

const FORMAT_TYPE_OPTIONS = [
  { value: 'TYPE_A', label: 'TYPE_A - 수평 배치' },
  { value: 'TYPE_B', label: 'TYPE_B - 설비 분할' },
  { value: 'TYPE_C', label: 'TYPE_C - 키-값 전치' },
] as const

export function ExportSystemForm({ isOpen, onClose, system }: ExportSystemFormProps) {
  const isEdit = !!system

  const createMutation = useCreateExportSystem()
  const updateMutation = useUpdateExportSystem()

  const [systemName, setSystemName] = useState('')
  const [formatType, setFormatType] = useState<'TYPE_A' | 'TYPE_B' | 'TYPE_C'>('TYPE_A')
  const [description, setDescription] = useState('')
  const [additionalConfig, setAdditionalConfig] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  // Populate form when editing
  useEffect(() => {
    if (system) {
      setSystemName(system.system_name)
      setFormatType(system.format_type)
      setDescription(system.description ?? '')
      setAdditionalConfig(
        system.additional_config ? JSON.stringify(system.additional_config, null, 2) : ''
      )
      setIsActive(system.is_active)
    } else {
      setSystemName('')
      setFormatType('TYPE_A')
      setDescription('')
      setAdditionalConfig('')
      setIsActive(true)
    }
    setConfigError(null)
    setServerError(null)
  }, [system, isOpen])

  const buildPayload = (): ExportSystemCreate | null => {
    let parsedConfig: Record<string, unknown> | undefined = undefined

    if (additionalConfig.trim()) {
      try {
        parsedConfig = JSON.parse(additionalConfig)
      } catch {
        setConfigError('추가 설정(JSON) 형식이 올바르지 않습니다.')
        return null
      }
    }

    setConfigError(null)

    return {
      system_name: systemName.trim(),
      format_type: formatType,
      description: description.trim() || undefined,
      additional_config: parsedConfig,
      is_active: isActive,
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setServerError(null)

    const payload = buildPayload()
    if (!payload) return

    if (isEdit && system) {
      updateMutation.mutate(
        { id: system.id, payload },
        {
          onSuccess: () => onClose(),
          onError: (err: unknown) => {
            const status = (err as { response?: { status?: number } })?.response?.status
            if (status === 409) {
              setServerError('같은 이름의 시스템이 이미 존재합니다.')
            } else {
              setServerError('저장 중 오류가 발생했습니다.')
            }
          },
        }
      )
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => onClose(),
        onError: (err: unknown) => {
          const status = (err as { response?: { status?: number } })?.response?.status
          if (status === 409) {
            setServerError('같은 이름의 시스템이 이미 존재합니다.')
          } else {
            setServerError('저장 중 오류가 발생했습니다.')
          }
        },
      })
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? '전산 출력 시스템 수정' : '전산 출력 시스템 추가'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Server-level error */}
          {serverError && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
              {serverError}
            </div>
          )}

          {/* system_name */}
          <div>
            <label className="block text-sm font-medium mb-1">
              시스템 이름 <span className="text-destructive">*</span>
            </label>
            <Input
              value={systemName}
              onChange={(e) => setSystemName(e.target.value)}
              placeholder="예: ERP_SYSTEM_A"
              maxLength={100}
              required
            />
          </div>

          {/* format_type */}
          <div>
            <label className="block text-sm font-medium mb-1">
              포맷 타입 <span className="text-destructive">*</span>
            </label>
            <select
              className="w-full border border-input bg-background px-3 py-2 rounded-md text-sm"
              value={formatType}
              onChange={(e) =>
                setFormatType(e.target.value as 'TYPE_A' | 'TYPE_B' | 'TYPE_C')
              }
              required
            >
              {FORMAT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* description */}
          <div>
            <label className="block text-sm font-medium mb-1">설명</label>
            <textarea
              className="w-full border border-input bg-background px-3 py-2 rounded-md text-sm resize-none"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="시스템 설명 (선택)"
            />
          </div>

          {/* additional_config */}
          <div>
            <label className="block text-sm font-medium mb-1">추가 설정 (JSON)</label>
            <textarea
              className={`w-full border bg-background px-3 py-2 rounded-md text-sm font-mono resize-none ${
                configError ? 'border-destructive' : 'border-input'
              }`}
              rows={4}
              value={additionalConfig}
              onChange={(e) => {
                setAdditionalConfig(e.target.value)
                setConfigError(null)
              }}
              placeholder={'{\n  "key": "value"\n}'}
            />
            {configError && (
              <p className="mt-1 text-xs text-destructive">{configError}</p>
            )}
          </div>

          {/* is_active */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="export-system-is-active"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="export-system-is-active" className="text-sm">
              활성
            </label>
          </div>

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
