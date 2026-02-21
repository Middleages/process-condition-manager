import { useState } from 'react'
import { Pencil, Check, X, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAdminCategories, useUpdateCategory, useReorderCategories } from '@/hooks/useAdminMaster'
import type { CategoryResponse } from '@/api/adminMaster'

interface EditingRow {
  id: number
  category_name: string
}

export function CategoryManagementPanel() {
  const { data: categories = [], isLoading } = useAdminCategories()
  const updateMutation = useUpdateCategory()
  const reorderMutation = useReorderCategories()
  const [editingRow, setEditingRow] = useState<EditingRow | null>(null)

  const handleEdit = (cat: CategoryResponse) => {
    setEditingRow({ id: cat.id, category_name: cat.category_name })
  }

  const handleSave = async () => {
    if (!editingRow) return
    try {
      await updateMutation.mutateAsync({ id: editingRow.id, payload: { category_name: editingRow.category_name } })
      setEditingRow(null)
    } catch {
      alert('저장 중 오류가 발생했습니다.')
    }
  }

  const handleCancel = () => setEditingRow(null)

  const handleMoveUp = (index: number) => {
    if (index === 0) return
    const newOrder = [...categories]
    ;[newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]]
    reorderMutation.mutate(newOrder.map((c) => c.id))
  }

  const handleMoveDown = (index: number) => {
    if (index === categories.length - 1) return
    const newOrder = [...categories]
    ;[newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]]
    reorderMutation.mutate(newOrder.map((c) => c.id))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-medium">카테고리 관리</h2>
        <p className="text-sm text-muted-foreground">카테고리명 수정 및 순서 변경이 가능합니다.</p>
      </div>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">순서</th>
              <th className="px-4 py-3 text-left font-medium">카테고리 코드</th>
              <th className="px-4 py-3 text-left font-medium">카테고리 이름</th>
              <th className="px-4 py-3 text-left font-medium">컬럼 수</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">로딩 중...</td></tr>
            )}
            {categories.map((cat, index) => {
              const isEditing = editingRow?.id === cat.id
              return (
                <tr key={cat.id} className="border-t hover:bg-muted/50">
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleMoveUp(index)} disabled={index === 0}>
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleMoveDown(index)} disabled={index === categories.length - 1}>
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono font-medium">{cat.category_code}</td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <Input
                        value={editingRow.category_name}
                        onChange={(e) => setEditingRow({ ...editingRow, category_name: e.target.value })}
                        className="h-7 text-sm"
                      />
                    ) : (
                      cat.category_name
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{cat.column_count}</td>
                  <td className="px-4 py-3">
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
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(cat)}>
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
