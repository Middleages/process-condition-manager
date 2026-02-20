import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import SelectOptionsEditModal from '@/components/admin/SelectOptionsEditModal'
import { useSelectColumns } from '@/hooks/useAdminColumns'
import type { ColumnSelectOptions } from '@/types/adminUser'

function categoryBadgeClass(code: string | null) {
  if (!code) return 'bg-gray-100 text-gray-700'
  const map: Record<string, string> = {
    SP: 'bg-purple-100 text-purple-800',
    SC: 'bg-blue-100 text-blue-800',
    OVL: 'bg-orange-100 text-orange-800',
    DEV: 'bg-green-100 text-green-800',
  }
  return map[code] ?? 'bg-gray-100 text-gray-700'
}

export default function EnumManagementPage() {
  const [selectedColumn, setSelectedColumn] = useState<ColumnSelectOptions | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)

  const { data: columns = [], isLoading } = useSelectColumns()

  const handleEdit = (col: ColumnSelectOptions) => {
    setSelectedColumn(col)
    setIsEditOpen(true)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">선택 옵션 관리</h1>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">컬럼명</th>
              <th className="px-4 py-3 text-left font-medium">표시 이름</th>
              <th className="px-4 py-3 text-left font-medium">카테고리</th>
              <th className="px-4 py-3 text-left font-medium">현재 옵션</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  로딩 중...
                </td>
              </tr>
            )}
            {!isLoading && columns.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  선택 옵션이 있는 컬럼이 없습니다.
                </td>
              </tr>
            )}
            {columns.map((col) => (
              <tr key={col.id} className="border-t hover:bg-muted/50">
                <td className="px-4 py-3 font-mono text-xs">{col.column_name}</td>
                <td className="px-4 py-3">{col.display_name}</td>
                <td className="px-4 py-3">
                  {col.category_code ? (
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${categoryBadgeClass(col.category_code)}`}
                    >
                      {col.category_code}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {col.select_options && col.select_options.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {col.select_options.slice(0, 5).map((opt) => (
                        <span
                          key={opt}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-secondary text-secondary-foreground"
                        >
                          {opt}
                        </span>
                      ))}
                      {col.select_options.length > 5 && (
                        <span className="text-xs text-muted-foreground">
                          +{col.select_options.length - 5}개
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-xs">없음</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(col)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      편집
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SelectOptionsEditModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        column={selectedColumn}
      />
    </div>
  )
}
