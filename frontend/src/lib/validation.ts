import type { ColumnDefinition } from '@/types'

/**
 * Client-side cell validation.
 * Returns array of error messages (empty = valid).
 */
export function validateCellValue(
  value: unknown,
  colDef: ColumnDefinition,
  _rowConditions: Record<string, unknown>
): string[] {
  const errors: string[] = []

  for (const rule of colDef.validations) {
    if (!rule.is_active) continue

    switch (rule.rule_type) {
      case 'required': {
        if (value === null || value === undefined || value === '') {
          errors.push(rule.error_message || `${colDef.display_name}은(는) 필수입니다.`)
        }
        break
      }

      case 'range': {
        if (value === null || value === undefined || value === '') break
        const num = Number(value)
        if (isNaN(num)) {
          errors.push(`${colDef.display_name}: 숫자를 입력해주세요.`)
          break
        }
        const config = rule.rule_config as { min?: number; max?: number }
        if (config.min !== undefined && num < config.min) {
          errors.push(rule.error_message || `${colDef.display_name}: 최소값 ${config.min} 이상이어야 합니다.`)
        }
        if (config.max !== undefined && num > config.max) {
          errors.push(rule.error_message || `${colDef.display_name}: 최대값 ${config.max} 이하여야 합니다.`)
        }
        break
      }

      case 'conditional_required': {
        const config = rule.rule_config as {
          depends_on: string
          condition: unknown
        }
        const depValue = _rowConditions[config.depends_on]
        if (depValue === config.condition) {
          if (value === null || value === undefined || value === '') {
            errors.push(rule.error_message || `${colDef.display_name}은(는) 조건부 필수입니다.`)
          }
        }
        break
      }
    }
  }

  return errors
}
