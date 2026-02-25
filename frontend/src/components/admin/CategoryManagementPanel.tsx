import { useState } from 'react'
import { Plus, Pencil, Trash2, Check, X, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useAdminCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useReorderCategories,
} from '@/hooks/useAdminMaster'
import type { CategoryResponse } from '@/api/adminMaster'

interface EditingRow {
  id: number
  category_name: string
}

interface NewCategoryForm {
  category_code: string
  category_name: string
}

export function CategoryManagementPanel() {
  const { data: categories = [], isLoading } = useAdminCategories()
  const createMutation = useCreateCategory()
  const updateMutation = useUpdateCategory()
  const deleteMutation = useDeleteCategory()
  const reorderMutation = useReorderCategories()
  const [editingRow, setEditingRow] = useState<EditingRow | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [newForm, setNewForm] = useState<NewCategoryForm>({ category_code: '', category_name: '' })
  const [serverError, setServerError] = useState('')

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

  const handleAdd = () => {
    setIsAdding(true)
    setNewForm({ category_code: '', category_name: '' })
    setServerError('')
  }

  const handleAddSubmit = async () => {
    if (!newForm.category_code.trim() || !newForm.category_name.trim()) return
    setServerError('')
    try {
      await createMutation.mutateAsync({
        category_code: newForm.category_code.trim(),
        category_name: newForm.category_name.trim(),
      })
      setIsAdding(false)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setServerError(axiosErr.response?.data?.detail ?? '생성 중 오류가 발생했습니다.')
    }
  }

  const handleAddCancel = () => {
    setIsAdding(false)
    setServerError('')
  }

  const handleDelete = async (cat: CategoryResponse) => {
    if (cat.column_count > 0) {
      alert('컬럼이 있는 카테고리는 삭제할 수 없습니다.')
      return
    }
    if (!confirm(`'${cat.category_name}' 카테고리를 삭제하시겠습니까?`)) return
    try {
      await deleteMutation.mutateAsync(cat.id)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      alert(axiosErr.response?.data?.detail ?? '삭제 중 오류가 발생했습니다.')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-medium">카테고리 관리</h2>
        <Button size="sm" onClick={handleAdd} disabled={isAdding}>
          <Plus className="h-4 w-4 mr-1" />
          카테고리 추가
        </Button>
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
            {isAdding && (
              <tr className="border-t bg-blue-50/50">
                <td className="px-4 py-3 text-muted-foreground">-</td>
                <td className="px-4 py-3">
                  <Input
                    value={newForm.category_code}
                    onChange={(e) => setNewForm({ ...newForm, category_code: e.target.value })}
                    placeholder="예: EQP"
                    className="h-7 text-sm font-mono"
                    autoFocus
                  />
                </td>
                <td className="px-4 py-3">
                  <Input
                    value={newForm.category_name}
                    onChange={(e) => setNewForm({ ...newForm, category_name: e.target.value })}
                    placeholder="예: Equipment"
                    className="h-7 text-sm"
                  />
                  {serverError && <p className="text-red-600 text-xs mt-1">{serverError}</p>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">-</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={handleAddSubmit} disabled={createMutation.isPending}>
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleAddCancel}>
                      <X className="h-3.5 w-3.5 text-red-600" />
                    </Button>
                  </div>
                </td>
              </tr>
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
                        <>
                          <Button variant="ghost" size="sm" onClick={() => handleEdit(cat)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => handleDelete(cat)}
                            disabled={cat.column_count > 0}
                            title={cat.column_count > 0 ? '컬럼이 있는 카테고리는 삭제할 수 없습니다' : '삭제'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
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
