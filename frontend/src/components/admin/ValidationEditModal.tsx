import { useEffect, useState } from 'react'
import { useReplaceValidations } from '@/hooks/useAdminValidations'
import { useColumns } from '@/hooks/useColumns'
import type { ColumnDefinition, ValidationRuleCreate } from '@/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Trash2 } from 'lucide-react'
import { CrossLayerRuleForm } from './CrossLayerRuleForm'

interface ValidationEditModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  column: ColumnDefinition & { category_code: string }
}

type RuleType = 'range' | 'required' | 'conditional_required' | 'cross_layer'

const RULE_TYPES: { value: RuleType; label: string }[] = [
  { value: 'range', label: 'Range' },
  { value: 'required', label: 'Required' },
  { value: 'conditional_required', label: 'Conditional Required' },
  { value: 'cross_layer', label: 'Cross-Layer' },
]

interface EditableRule {
  id: string // temporary ID for React key
  rule_type: RuleType
  rule_config: Record<string, unknown>
  error_message: string
  is_active: boolean
}

export function ValidationEditModal({ open, onOpenChange, column }: ValidationEditModalProps) {
  const replaceMutation = useReplaceValidations()
  const { data: categories = [] } = useColumns()

  const [rules, setRules] = useState<EditableRule[]>([])

  // Populate rules from column.validations
  useEffect(() => {
    if (column) {
      const editableRules: EditableRule[] = column.validations.map((v, idx) => ({
        id: `existing-${idx}`,
        rule_type: v.rule_type,
        rule_config: v.rule_config,
        error_message: v.error_message,
        is_active: v.is_active,
      }))
      setRules(editableRules)
    }
  }, [column])

  const handleAddRule = (ruleType: RuleType) => {
    let defaultConfig: Record<string, unknown> = {}
    let defaultMessage = ''

    if (ruleType === 'range') {
      defaultConfig = { min: 0, max: 100 }
      defaultMessage = '값이 범위를 벗어났습니다.'
    } else if (ruleType === 'required') {
      defaultConfig = {}
      defaultMessage = '필수 입력 항목입니다.'
    } else if (ruleType === 'conditional_required') {
      defaultConfig = { condition_column: '', condition_value: '', operator: 'equals' }
      defaultMessage = '조건부 필수 항목입니다.'
    } else if (ruleType === 'cross_layer') {
      // cross_layer 기본 설정: reference_exists 유형으로 시작
      defaultConfig = { check_type: 'reference_exists', source_column: '', target: 'step_seq' }
      defaultMessage = 'Cross-layer 검증 조건을 만족하지 않습니다.'
    }

    const newRule: EditableRule = {
      id: `new-${Date.now()}`,
      rule_type: ruleType,
      rule_config: defaultConfig,
      error_message: defaultMessage,
      is_active: true,
    }
    setRules([...rules, newRule])
  }

  const handleDeleteRule = (id: string) => {
    setRules(rules.filter((r) => r.id !== id))
  }

  const handleRuleChange = (id: string, field: keyof EditableRule, value: unknown) => {
    setRules(
      rules.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    )
  }

  const handleConfigChange = (id: string, key: string, value: unknown) => {
    setRules(
      rules.map((r) =>
        r.id === id
          ? { ...r, rule_config: { ...r.rule_config, [key]: value } }
          : r
      )
    )
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const validations: ValidationRuleCreate[] = rules.map((r) => ({
      rule_type: r.rule_type,
      rule_config: r.rule_config,
      error_message: r.error_message,
      is_active: r.is_active,
    }))

    replaceMutation.mutate(
      { columnId: column.id, validations },
      {
        onSuccess: () => onOpenChange(false),
      }
    )
  }

  // Build column options for conditional_required
  const allColumns = categories.flatMap((cat) => cat.columns)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            검증 규칙: {column.column_name} ({column.display_name})
          </DialogTitle>
        </DialogHeader>

        <div className="text-sm text-muted-foreground space-y-1 border-b pb-3">
          <div>타입: {column.data_type}</div>
          <div>단위: {column.unit || '--'}</div>
          <div>카테고리: {column.category_code}</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Rule List */}
          <div className="space-y-4">
            {rules.map((rule) => (
              <div key={rule.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge>{rule.rule_type}</Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteRule(rule.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Dynamic Fields per Rule Type */}
                {rule.rule_type === 'range' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Min</label>
                      <Input
                        type="number"
                        value={(rule.rule_config.min as number) ?? ''}
                        onChange={(e) =>
                          handleConfigChange(
                            rule.id,
                            'min',
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Max</label>
                      <Input
                        type="number"
                        value={(rule.rule_config.max as number) ?? ''}
                        onChange={(e) =>
                          handleConfigChange(
                            rule.id,
                            'max',
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      />
                    </div>
                  </div>
                )}

                {rule.rule_type === 'conditional_required' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">조건 컬럼</label>
                      <select
                        className="w-full border border-input bg-background px-3 py-2 rounded-md text-sm"
                        value={(rule.rule_config.condition_column as string) ?? ''}
                        onChange={(e) =>
                          handleConfigChange(rule.id, 'condition_column', e.target.value)
                        }
                      >
                        <option value="">선택</option>
                        {allColumns.map((col) => (
                          <option key={col.id} value={col.column_name}>
                            {col.column_name} - {col.display_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">조건 값</label>
                      <Input
                        value={(rule.rule_config.condition_value as string) ?? ''}
                        onChange={(e) =>
                          handleConfigChange(rule.id, 'condition_value', e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">연산자</label>
                      <select
                        className="w-full border border-input bg-background px-3 py-2 rounded-md text-sm"
                        value={(rule.rule_config.operator as string) ?? 'equals'}
                        onChange={(e) => handleConfigChange(rule.id, 'operator', e.target.value)}
                      >
                        <option value="equals">equals</option>
                        <option value="not_equals">not_equals</option>
                        <option value="contains">contains</option>
                      </select>
                    </div>
                  </div>
                )}

                {rule.rule_type === 'cross_layer' && (
                  // CrossLayerRuleForm: check_type에 따라 동적으로 필드를 렌더링
                  <CrossLayerRuleForm
                    ruleConfig={rule.rule_config}
                    onChange={(updatedConfig) =>
                      handleRuleChange(rule.id, 'rule_config', updatedConfig)
                    }
                    allColumns={allColumns.map((col) => ({
                      column_name: col.column_name,
                      display_name: col.display_name,
                    }))}
                  />
                )}

                {/* Error Message */}
                <div>
                  <label className="block text-sm font-medium mb-1">오류 메시지</label>
                  <Input
                    value={rule.error_message}
                    onChange={(e) => handleRuleChange(rule.id, 'error_message', e.target.value)}
                  />
                </div>

                {/* Active */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`active-${rule.id}`}
                    checked={rule.is_active}
                    onChange={(e) => handleRuleChange(rule.id, 'is_active', e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label htmlFor={`active-${rule.id}`} className="text-sm">
                    활성
                  </label>
                </div>
              </div>
            ))}
          </div>

          {/* Add Rule Dropdown */}
          <div className="flex gap-2">
            <select
              className="flex-1 border border-input bg-background px-3 py-2 rounded-md text-sm"
              onChange={(e) => {
                if (e.target.value) {
                  handleAddRule(e.target.value as RuleType)
                  e.target.value = ''
                }
              }}
              defaultValue=""
            >
              <option value="">+ 규칙 추가</option>
              {RULE_TYPES.map((rt) => (
                <option key={rt.value} value={rt.value}>
                  {rt.label}
                </option>
              ))}
            </select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={replaceMutation.isPending}>
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
