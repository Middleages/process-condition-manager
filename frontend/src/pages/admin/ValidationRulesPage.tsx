import { useState, useMemo } from 'react'
import { useAdminColumns } from '@/hooks/useAdminValidations'
import type { ColumnDefinition, ColumnValidation, CategoryCode } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ValidationEditModal } from '@/components/admin/ValidationEditModal'
import { BulkUploadModal } from '@/components/admin/BulkUploadModal'
import { Pencil, Upload, Search } from 'lucide-react'

const CATEGORIES: { code: CategoryCode; label: string }[] = [
  { code: 'SP', label: 'SP' },
  { code: 'SC', label: 'SC' },
  { code: 'OVL', label: 'OVL' },
  { code: 'DEV', label: 'DEV' },
]

export default function ValidationRulesPage() {
  const [category, setCategory] = useState<CategoryCode>('SP')
  const [search, setSearch] = useState('')
  const [editingColumn, setEditingColumn] = useState<
    (ColumnDefinition & { category_code: string }) | undefined
  >()
  const [modalOpen, setModalOpen] = useState(false)
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false)

  const { data: categories = [], isLoading } = useAdminColumns(category)

  // Flatten columns with category_code
  const columns = useMemo(() => {
    return categories.flatMap((cat) =>
      cat.columns.map((col) => ({
        ...col,
        category_code: cat.category_code,
      }))
    )
  }, [categories])

  // Client-side search
  const filteredColumns = useMemo(() => {
    if (!search) return columns
    const lowerSearch = search.toLowerCase()
    return columns.filter(
      (col) =>
        col.column_name.toLowerCase().includes(lowerSearch) ||
        col.display_name.toLowerCase().includes(lowerSearch)
    )
  }, [columns, search])

  const handleEdit = (col: ColumnDefinition & { category_code: string }) => {
    setEditingColumn(col)
    setModalOpen(true)
  }

  // Helper to summarize validations
  const getRequiredSummary = (validations: ColumnValidation[]) => {
    const required = validations.find((v) => v.is_active && v.rule_type === 'required')
    return required ? 'Y' : '--'
  }

  const getRangeSummary = (validations: ColumnValidation[]) => {
    const range = validations.find((v) => v.is_active && v.rule_type === 'range')
    if (!range) return '--'
    const config = range.rule_config as { min?: number; max?: number }
    return `${config.min ?? '?'} ~ ${config.max ?? '?'}`
  }

  const getConditionalSummary = (validations: ColumnValidation[]) => {
    const cond = validations.find(
      (v) => v.is_active && v.rule_type === 'conditional_required'
    )
    if (!cond) return '--'
    const config = cond.rule_config as {
      condition_column?: string
      condition_value?: string
    }
    return `${config.condition_column ?? '?'}=${config.condition_value ?? '?'}`
  }

  const getCrossLayerSummary = (validations: ColumnValidation[]) => {
    const crossRules = validations.filter(
      (v) => v.is_active && v.rule_type === 'cross_layer'
    )
    if (crossRules.length === 0) return '--'
    const types = crossRules.map((v) => {
      const checkType = (v.rule_config as { check_type?: string }).check_type
      if (checkType === 'reference_exists') return 'Ref'
      if (checkType === 'compare_layers') return 'Cmp'
      if (checkType === 'equipment_compatibility') return 'Eq'
      return checkType ?? '?'
    })
    return types.join(', ')
  }

  const getRulesCount = (validations: ColumnValidation[]) => {
    return validations.length
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">검증 규칙 관리</h1>
        <Button onClick={() => setBulkUploadOpen(true)}>
          <Upload className="h-4 w-4 mr-2" />
          일괄 업로드
        </Button>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-2">
        {CATEGORIES.map((cat) => (
          <Button
            key={cat.code}
            variant={category === cat.code ? 'default' : 'outline'}
            onClick={() => setCategory(cat.code)}
          >
            {cat.label}
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="컬럼명 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">로딩 중...</div>
      ) : filteredColumns.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">컬럼 데이터가 없습니다.</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">컬럼명</th>
                <th className="px-4 py-3 text-left text-sm font-medium">타입</th>
                <th className="px-4 py-3 text-left text-sm font-medium">필수</th>
                <th className="px-4 py-3 text-left text-sm font-medium">범위</th>
                <th className="px-4 py-3 text-left text-sm font-medium">조건부 필수</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Cross-Layer</th>
                <th className="px-4 py-3 text-center text-sm font-medium">규칙 수</th>
                <th className="px-4 py-3 text-right text-sm font-medium">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredColumns.map((col) => (
                <tr key={col.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 text-sm">
                    <div>{col.column_name}</div>
                    <div className="text-xs text-muted-foreground">{col.display_name}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">{col.data_type}</td>
                  <td className="px-4 py-3 text-sm">{getRequiredSummary(col.validations)}</td>
                  <td className="px-4 py-3 text-sm">{getRangeSummary(col.validations)}</td>
                  <td className="px-4 py-3 text-sm">{getConditionalSummary(col.validations)}</td>
                  <td className="px-4 py-3 text-sm">{getCrossLayerSummary(col.validations)}</td>
                  <td className="px-4 py-3 text-center text-sm">
                    <Badge variant="secondary">{getRulesCount(col.validations)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(col)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div className="text-sm text-muted-foreground">
        총 {filteredColumns.length}개 컬럼 • 검증 규칙 합계:{' '}
        {filteredColumns.reduce((sum, col) => sum + col.validations.length, 0)}개
      </div>

      {/* Modals */}
      {editingColumn && (
        <ValidationEditModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          column={editingColumn}
        />
      )}
      <BulkUploadModal open={bulkUploadOpen} onOpenChange={setBulkUploadOpen} />
    </div>
  )
}
