import { useState, useEffect } from 'react'
import { Plus, X, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useUpdateSelectOptions } from '@/hooks/useAdminColumns'
import type { ColumnSelectOptions } from '@/types/adminUser'

interface SelectOptionsEditModalProps {
  isOpen: boolean
  onClose: () => void
  column: ColumnSelectOptions | null
}

export function SelectOptionsEditModal({
  isOpen,
  onClose,
  column,
}: SelectOptionsEditModalProps) {
  const [options, setOptions] = useState<string[]>([])
  const [serverError, setServerError] = useState('')

  const updateMutation = useUpdateSelectOptions()

  useEffect(() => {
    if (column) {
      setOptions((column.select_options ?? []).map(String))
    } else {
      setOptions([])
    }
    setServerError('')
  }, [column, isOpen])

  const handleAddOption = () => {
    setOptions((prev) => [...prev, ''])
  }

  const handleRemoveOption = (index: number) => {
    setOptions((prev) => prev.filter((_, i) => i !== index))
  }

  const handleChangeOption = (index: number, value: string) => {
    setOptions((prev) => prev.map((opt, i) => (i === index ? value : opt)))
  }

  const handleMoveUp = (index: number) => {
    if (index === 0) return
    setOptions((prev) => {
      const next = [...prev]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
    })
  }

  const handleMoveDown = (index: number) => {
    if (index === options.length - 1) return
    setOptions((prev) => {
      const next = [...prev]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      return next
    })
  }

  const handleSubmit = async () => {
    if (!column) return
    setServerError('')

    const filtered = options.filter((o) => o.trim() !== '')
    try {
      await updateMutation.mutateAsync({ columnId: column.id, selectOptions: filtered })
      onClose()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setServerError(axiosErr.response?.data?.detail ?? '저장 중 오류가 발생했습니다.')
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>
            선택 옵션 편집 - {column?.display_name}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{column?.column_name}</p>
        </DialogHeader>

        <div className="space-y-2 max-h-72 overflow-y-auto py-1">
          {options.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">옵션이 없습니다.</p>
          )}
          {options.map((opt, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex flex-col gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={() => handleMoveUp(index)}
                  disabled={index === 0}
                >
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={() => handleMoveDown(index)}
                  disabled={index === options.length - 1}
                >
                  <ArrowDown className="h-3 w-3" />
                </Button>
              </div>
              <Input
                value={opt}
                onChange={(e) => handleChangeOption(index, e.target.value)}
                placeholder={`옵션 ${index + 1}`}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700"
                onClick={() => handleRemoveOption(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <Button type="button" variant="outline" size="sm" onClick={handleAddOption} className="w-full mt-2">
          <Plus className="h-4 w-4 mr-1" />
          옵션 추가
        </Button>

        {serverError && <p className="text-red-600 text-sm">{serverError}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateMutation.isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
