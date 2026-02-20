import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import LineFormModal from './LineFormModal'
import { useAdminLines, useDeleteLine } from '@/hooks/useAdminMaster'
import type { LineResponse } from '@/api/adminMaster'

export default function LineManagementPanel() {
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedLine, setSelectedLine] = useState<LineResponse | null>(null)

  const { data: lines = [], isLoading } = useAdminLines()
  const deleteMutation = useDeleteLine()

  const handleEdit = (line: LineResponse) => {
    setSelectedLine(line)
    setIsFormOpen(true)
  }

  const handleAdd = () => {
    setSelectedLine(null)
    setIsFormOpen(true)
  }

  const handleDelete = async (line: LineResponse) => {
    if (!confirm(`'${line.line_name}' 라인을 삭제하시겠습니까?\n연결된 제품이 있으면 삭제할 수 없습니다.`)) return
    try {
      await deleteMutation.mutateAsync(line.id)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      alert(axiosErr.response?.data?.detail ?? '삭제 중 오류가 발생했습니다.')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-medium">라인 목록</h2>
        <Button size="sm" onClick={handleAdd}>
          <Plus className="h-4 w-4 mr-1" />
          라인 추가
        </Button>
      </div>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">라인 코드</th>
              <th className="px-4 py-3 text-left font-medium">라인 이름</th>
              <th className="px-4 py-3 text-left font-medium">제품 수</th>
              <th className="px-4 py-3 text-left font-medium">생성일</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">로딩 중...</td></tr>
            )}
            {!isLoading && lines.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">라인이 없습니다.</td></tr>
            )}
            {lines.map((line) => (
              <tr key={line.id} className="border-t hover:bg-muted/50">
                <td className="px-4 py-3 font-mono text-xs">{line.line_code}</td>
                <td className="px-4 py-3">{line.line_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{line.product_count}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(line.created_at).toLocaleDateString('ko-KR')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(line)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => handleDelete(line)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LineFormModal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} line={selectedLine} />
    </div>
  )
}
