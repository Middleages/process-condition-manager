import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useColumns } from '@/hooks/useColumns'
import {
  useCreateColumn,
  useUpdateColumnMetadata,
  useDeleteColumn,
  useAdminCategories,
} from '@/hooks/useAdminMaster'
import type { ColumnDefinition } from '@/types'

interface EditingRow {
  id: number
  display_name: string
  unit: string
  is_required: boolean
}

interface NewColumnForm {
  column_name: string
  display_name: string
  category_id: number | ''
  data_type: string
  unit: string
  is_required: boolean
  select_options: string
}

const DATA_TYPES = [
  { value: 'integer', label: 'Integer' },
  { value: 'float', label: 'Float' },
  { value: 'string', label: 'String' },
  { value: 'select', label: 'Select' },
]

const INITIAL_FORM: NewColumnForm = {
  column_name: '',
  display_name: '',
  category_id: '',
  data_type: 'string',
  unit: '',
  is_required: false,
  select_options: '',
}

export function ColumnMetadataPanel() {
  const { data: categories = [], isLoading } = useColumns()
  const { data: adminCategories = [] } = useAdminCategories()
  const createMutation = useCreateColumn()
  const updateMutation = useUpdateColumnMetadata()
  const deleteMutation = useDeleteColumn()
  const [editingRow, setEditingRow] = useState<EditingRow | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [newForm, setNewForm] = useState<NewColumnForm>(INITIAL_FORM)
  const [serverError, setServerError] = useState('')

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

  const handleDelete = async (col: ColumnDefinition & { category_code: string }) => {
    if (!confirm(`'${col.column_name}' 컬럼을 삭제하시겠습니까?\n관련 검증 규칙도 함께 삭제됩니다.`)) return
    try {
      await deleteMutation.mutateAsync(col.id)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      alert(axiosErr.response?.data?.detail ?? '삭제 중 오류가 발생했습니다.')
    }
  }

  const handleOpenAdd = () => {
    setNewForm(INITIAL_FORM)
    setServerError('')
    setIsFormOpen(true)
  }

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')
    if (!newForm.column_name.trim() || !newForm.display_name.trim() || newForm.category_id === '') return
    try {
      const selectOptions =
        newForm.data_type === 'select' && newForm.select_options.trim()
          ? newForm.select_options.split(',').map((s) => s.trim()).filter(Boolean)
          : null

      await createMutation.mutateAsync({
        column_name: newForm.column_name.trim(),
        display_name: newForm.display_name.trim(),
        category_id: Number(newForm.category_id),
        data_type: newForm.data_type,
        unit: newForm.unit.trim() || null,
        is_required: newForm.is_required,
        select_options: selectOptions,
      })
      setIsFormOpen(false)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setServerError(axiosErr.response?.data?.detail ?? '생성 중 오류가 발생했습니다.')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-medium">컬럼 메타데이터 관리</h2>
        <Button size="sm" onClick={handleOpenAdd}>
          <Plus className="h-4 w-4 mr-1" />
          컬럼 추가
        </Button>
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
              <th className="px-4 py-3 text-left font-medium">데이터 타입</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">로딩 중...</td>
              </tr>
            )}
            {!isLoading && allColumns.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">컬럼이 없습니다.</td>
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
                  <td className="px-4 py-2 text-muted-foreground">{col.data_type}</td>
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
                        <>
                          <Button variant="ghost" size="sm" onClick={() => handleEdit(col)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => handleDelete(col)}
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

      {/* Column Create Modal */}
      <ColumnCreateModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        categories={adminCategories}
        form={newForm}
        setForm={setNewForm}
        onSubmit={handleAddSubmit}
        isPending={createMutation.isPending}
        serverError={serverError}
      />
    </div>
  )
}

interface ColumnCreateModalProps {
  isOpen: boolean
  onClose: () => void
  categories: Array<{ id: number; category_code: string; category_name: string }>
  form: NewColumnForm
  setForm: (f: NewColumnForm) => void
  onSubmit: (e: React.FormEvent) => Promise<void>
  isPending: boolean
  serverError: string
}

function ColumnCreateModal({
  isOpen,
  onClose,
  categories,
  form,
  setForm,
  onSubmit,
  isPending,
  serverError,
}: ColumnCreateModalProps) {
  useEffect(() => {
    if (!isOpen) return
    // Reset form when opened is handled by parent
  }, [isOpen])

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>컬럼 추가</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">컬럼명 (JSONB key) *</label>
            <Input
              value={form.column_name}
              onChange={(e) => setForm({ ...form, column_name: e.target.value })}
              required
              placeholder="예: SPIN_SPEED"
              className="font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">표시 이름 *</label>
            <Input
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              required
              placeholder="예: Spin Speed"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">카테고리 *</label>
            <select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value ? Number(e.target.value) : '' })}
              required
              className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              <option value="">선택하세요</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.category_code} - {cat.category_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">데이터 타입 *</label>
            <select
              value={form.data_type}
              onChange={(e) => setForm({ ...form, data_type: e.target.value })}
              required
              className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              {DATA_TYPES.map((dt) => (
                <option key={dt.value} value={dt.value}>{dt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">단위</label>
            <Input
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              placeholder="예: rpm, mJ, nm"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_required"
              checked={form.is_required}
              onChange={(e) => setForm({ ...form, is_required: e.target.checked })}
              className="h-4 w-4"
            />
            <label htmlFor="is_required" className="text-sm font-medium">필수 항목</label>
          </div>
          {form.data_type === 'select' && (
            <div>
              <label className="block text-sm font-medium mb-1">선택 옵션 (쉼표 구분)</label>
              <Input
                value={form.select_options}
                onChange={(e) => setForm({ ...form, select_options: e.target.value })}
                placeholder="예: Y,N 또는 HIGH,MID,LOW"
              />
              <p className="text-xs text-muted-foreground mt-1">쉼표로 구분하여 입력하세요.</p>
            </div>
          )}
          {serverError && <p className="text-red-600 text-sm">{serverError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>취소</Button>
            <Button type="submit" disabled={isPending}>{isPending ? '생성 중...' : '생성'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
