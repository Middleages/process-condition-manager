import { useState } from 'react'
import { useBulkUploadValidations } from '@/hooks/useAdminValidations'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Upload } from 'lucide-react'

interface BulkUploadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BulkUploadModal({ open, onOpenChange }: BulkUploadModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const uploadMutation = useBulkUploadValidations()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!file) {
      alert('파일을 선택해주세요.')
      return
    }

    const confirmed = confirm(
      '이 작업은 기존 검증 규칙을 모두 대체합니다. 계속하시겠습니까?'
    )
    if (!confirmed) return

    uploadMutation.mutate(file, {
      onSuccess: (data) => {
        alert(
          `업로드 완료\n총 ${data.total_rows}개 행\n컬럼: ${data.columns_updated}\n규칙: ${data.rules_created}\n경고: ${data.warnings.length}개`
        )
        onOpenChange(false)
        setFile(null)
      },
      onError: (error: Error) => {
        alert(`업로드 실패: ${error.message}`)
      },
    })
  }

  const handleClose = () => {
    setFile(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>검증 규칙 일괄 업로드</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="border-2 border-dashed rounded-lg p-6 text-center">
            <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <input
              type="file"
              accept=".xlsx"
              onChange={handleFileChange}
              className="block w-full text-sm text-muted-foreground
                file:mr-4 file:py-2 file:px-4
                file:rounded file:border-0
                file:text-sm file:font-semibold
                file:bg-primary file:text-primary-foreground
                hover:file:bg-primary/90"
            />
            {file && (
              <div className="mt-3 text-sm">
                선택된 파일: <span className="font-medium">{file.name}</span>
              </div>
            )}
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
            <strong>경고:</strong> 이 작업은 영향을 받는 컬럼의 기존 검증 규칙을 모두
            대체합니다. Excel 파일에 정의된 규칙만 남게 됩니다.
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              취소
            </Button>
            <Button type="submit" disabled={!file || uploadMutation.isPending}>
              {uploadMutation.isPending ? '업로드 중...' : '업로드'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
