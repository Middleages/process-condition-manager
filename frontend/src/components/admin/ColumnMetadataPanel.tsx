import { useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useColumns } from '@/hooks/useColumns'
import { useUpdateColumnMetadata } from '@/hooks/useAdminMaster'
import type { ColumnDefinition } from '@/types'

interface EditingRow {
  id: number
  display_name: string
  unit: string
  is_required: boolean
}

export function ColumnMetadataPanel() {
  const { data: categories = [], isLoading } = useColumns()
  const updateMutation = useUpdateColumnMetadata()
  const [editingRow, setEditingRow] = useState<EditingRow | null>(null)

  // Flatten all columns from all categories
  const allColumns: Array<ColumnDefinition & { category_code: string }> = categories.flatMap((cat) =>
    cat.columns.map((col) => ({ ...col, category_code: cat.category_code }))
  )

  const handleEdit = (col: ColumnDefinition & { category_code: string }) => {
    setEditingRow({
      id: col.id,
      display_name: col.display_name,
      unit: col.unit ?? '',
      is_required: col.is_required,
    })
  }

  const handleSave = async () => {
    if (!editingRow) return
    try {
      await updateMutation.mutateAsync({
        id: editingRow.id,
        payload: {
          display_name: editingRow.display_name,
          unit: editingRow.unit || null,
          is_required: editingRow.is_required,
        },
      })
      setEditingRow(null)
    } catch {
      alert('저장 중 오류가 발생했습니다.')
    }
  }

  const handleCancel = () => setEditingRow(null)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-medium">컬럼 메타데이터 관리</h2>
        <p className="text-sm text-muted-foreground">편집 버튼을 클릭하여 수정하세요.</p>
      </div>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">컬럼명</th>
              <th className="px-4 py-3 text-left font-medium">표시 이름</th>
              <th className="px-4 py-3 text-left font-medium">단위</th>
              <th className="px-4 py-3 text-left font-medium">필수 여부</th>
              <th className="px-4 py-3 text-left font-medium">카테고리</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">로딩 중...</td>
              </tr>
            )}
            {allColumns.map((col) => {
              const isEditing = editingRow?.id === col.id
              return (
                <tr key={col.id} className="border-t hover:bg-muted/50">
                  <td className="px-4 py-2 font-mono text-xs">{col.column_name}</td>
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <Input
                        value={editingRow.display_name}
                        onChange={(e) => setEditingRow({ ...editingRow, display_name: e.target.value })}
                        className="h-7 text-sm"
                      />
                    ) : (
                      col.display_name
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <Input
                        value={editingRow.unit}
                        onChange={(e) => setEditingRow({ ...editingRow, unit: e.target.value })}
                        placeholder="단위"
                        className="h-7 text-sm w-24"
                      />
                    ) : (
                      <span className="text-muted-foreground">{col.unit ?? '-'}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <input
                        type="checkbox"
                        checked={editingRow.is_required}
                        onChange={(e) => setEditingRow({ ...editingRow, is_required: e.target.checked })}
                        className="h-4 w-4"
                      />
                    ) : (
                      <span className={col.is_required ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
                        {col.is_required ? '필수' : '선택'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{col.category_code}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {isEditing ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                            <Check className="h-3.5 w-3.5 text-green-600" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={handleCancel}>
                            <X className="h-3.5 w-3.5 text-red-600" />
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(col)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
