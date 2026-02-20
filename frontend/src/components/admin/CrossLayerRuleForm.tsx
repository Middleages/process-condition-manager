// CrossLayerRuleForm.tsx
// Cross-Layer 검증 규칙 설정 폼 컴포넌트
// check_type에 따라 동적으로 필드를 렌더링한다

import { Input } from '@/components/ui/input'

// 지원하는 check_type 목록
type CheckType = 'reference_exists' | 'compare_layers' | 'equipment_compatibility'

const CHECK_TYPE_OPTIONS: { value: CheckType; label: string }[] = [
  { value: 'reference_exists', label: '참조 레이어 존재 검증' },
  { value: 'compare_layers', label: '레이어 간 값 비교' },
  { value: 'equipment_compatibility', label: '설비 호환성 검증' },
]

// compare_layers에서 사용하는 비교 연산자 목록
const OPERATOR_OPTIONS = [
  { value: '<=', label: '<=' },
  { value: '>=', label: '>=' },
  { value: '<', label: '<' },
  { value: '>', label: '>' },
  { value: '==', label: '==' },
  { value: '!=', label: '!=' },
]

// equipment_compatibility에서 사용하는 호환성 타입 목록
const COMPATIBILITY_OPTIONS = [
  { value: 'same_value', label: '동일 값' },
  { value: 'within_range', label: '허용 범위 내' },
]

// 공통 select 스타일 (ValidationEditModal과 동일)
const SELECT_CLASS = 'w-full border border-input bg-background px-3 py-2 rounded-md text-sm'

interface CrossLayerRuleFormProps {
  ruleConfig: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
  allColumns: Array<{ column_name: string; display_name: string }>
}

export function CrossLayerRuleForm({
  ruleConfig,
  onChange,
  allColumns,
}: CrossLayerRuleFormProps) {
  const checkType = (ruleConfig.check_type as CheckType) || 'reference_exists'

  // check_type 변경 시 관련 기본값을 초기화하여 혼동을 방지
  const handleCheckTypeChange = (newType: CheckType) => {
    if (newType === 'reference_exists') {
      onChange({
        check_type: newType,
        source_column: ruleConfig.source_column ?? '',
        target: 'step_seq',
      })
    } else if (newType === 'compare_layers') {
      onChange({
        check_type: newType,
        column: ruleConfig.column ?? '',
        operator: '<=',
        reference_layer_column: '',
        threshold_ratio: '',
      })
    } else if (newType === 'equipment_compatibility') {
      onChange({
        check_type: newType,
        column: ruleConfig.column ?? '',
        compatibility: 'same_value',
        range_tolerance: '',
      })
    }
  }

  // 단일 필드 변경 헬퍼
  const handleField = (key: string, value: unknown) => {
    onChange({ ...ruleConfig, [key]: value })
  }

  // 컬럼 선택 드롭다운 공통 렌더러
  const renderColumnSelect = (
    label: string,
    field: string,
    value: string
  ) => (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <select
        className={SELECT_CLASS}
        value={value}
        onChange={(e) => handleField(field, e.target.value)}
      >
        <option value="">컬럼 선택</option>
        {allColumns.map((col) => (
          <option key={col.column_name} value={col.column_name}>
            {col.column_name} - {col.display_name}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <div className="space-y-3">
      {/* check_type 선택 드롭다운 */}
      <div>
        <label className="block text-sm font-medium mb-1">검증 유형</label>
        <select
          className={SELECT_CLASS}
          value={checkType}
          onChange={(e) => handleCheckTypeChange(e.target.value as CheckType)}
        >
          {CHECK_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* reference_exists: 참조 레이어 존재 검증 필드 */}
      {checkType === 'reference_exists' && (
        <>
          {renderColumnSelect(
            '소스 컬럼',
            'source_column',
            (ruleConfig.source_column as string) ?? ''
          )}
          {/* target은 기본 step_seq로 고정 (읽기 전용 표시) */}
          <div>
            <label className="block text-sm font-medium mb-1">대상</label>
            <Input
              value="step_seq"
              readOnly
              className="bg-muted text-muted-foreground cursor-not-allowed"
            />
          </div>
        </>
      )}

      {/* compare_layers: 레이어 간 값 비교 필드 */}
      {checkType === 'compare_layers' && (
        <>
          {renderColumnSelect(
            '비교 컬럼',
            'column',
            (ruleConfig.column as string) ?? ''
          )}
          <div>
            <label className="block text-sm font-medium mb-1">연산자</label>
            <select
              className={SELECT_CLASS}
              value={(ruleConfig.operator as string) ?? '<='}
              onChange={(e) => handleField('operator', e.target.value)}
            >
              {OPERATOR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {renderColumnSelect(
            '참조 레이어 컬럼',
            'reference_layer_column',
            (ruleConfig.reference_layer_column as string) ?? ''
          )}
          <div>
            <label className="block text-sm font-medium mb-1">
              허용 비율 <span className="text-muted-foreground font-normal">(선택, 예: 0.1)</span>
            </label>
            <Input
              type="number"
              step={0.1}
              value={(ruleConfig.threshold_ratio as string | number) ?? ''}
              placeholder="비워두면 적용 안함"
              onChange={(e) =>
                handleField(
                  'threshold_ratio',
                  e.target.value !== '' ? Number(e.target.value) : ''
                )
              }
            />
          </div>
        </>
      )}

      {/* equipment_compatibility: 설비 호환성 검증 필드 */}
      {checkType === 'equipment_compatibility' && (
        <>
          {renderColumnSelect(
            '대상 컬럼',
            'column',
            (ruleConfig.column as string) ?? ''
          )}
          <div>
            <label className="block text-sm font-medium mb-1">호환성 유형</label>
            <select
              className={SELECT_CLASS}
              value={(ruleConfig.compatibility as string) ?? 'same_value'}
              onChange={(e) => handleField('compatibility', e.target.value)}
            >
              {COMPATIBILITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {/* range_tolerance는 within_range 선택 시에만 표시 */}
          {ruleConfig.compatibility === 'within_range' && (
            <div>
              <label className="block text-sm font-medium mb-1">
                허용 오차 <span className="text-muted-foreground font-normal">(예: 0.05)</span>
              </label>
              <Input
                type="number"
                step={0.01}
                value={(ruleConfig.range_tolerance as string | number) ?? ''}
                placeholder="허용 오차 값 입력"
                onChange={(e) =>
                  handleField(
                    'range_tolerance',
                    e.target.value !== '' ? Number(e.target.value) : ''
                  )
                }
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
