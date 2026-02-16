import type { ColumnDefinition, ColumnCategory } from '@/types'

/**
 * Evaluate a condition based on operator (equals, not_equals, contains).
 */
export function evaluateCondition(actual: unknown, expected: unknown, operator: string): boolean {
  const actualStr = actual !== null && actual !== undefined ? String(actual) : ''
  const expectedStr = String(expected)

  if (operator === 'not_equals') {
    return actualStr !== expectedStr
  } else if (operator === 'contains') {
    return actualStr.toLowerCase().includes(expectedStr.toLowerCase())
  } else {
    // equals (default)
    return actualStr === expectedStr
  }
}

/**
 * Build a reverse dependency map: condition_column → [dependent ColumnDefinitions]
 *
 * This map helps identify which columns need re-validation when a condition column changes.
 */
export function buildConditionDependencyMap(
  categories: ColumnCategory[]
): Map<string, ColumnDefinition[]> {
  const dependencyMap = new Map<string, ColumnDefinition[]>()

  for (const category of categories) {
    for (const column of category.columns) {
      for (const rule of column.validations) {
        if (rule.rule_type === 'conditional_required' && rule.is_active) {
          const config = rule.rule_config as {
            condition_column: string
            condition_value: unknown
            operator?: string
          }
          const conditionColumn = config.condition_column

          if (!dependencyMap.has(conditionColumn)) {
            dependencyMap.set(conditionColumn, [])
          }
          dependencyMap.get(conditionColumn)!.push(column)
        }
      }
    }
  }

  return dependencyMap
}

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
          condition_column: string
          condition_value: unknown
          operator?: string
        }
        const depValue = _rowConditions[config.condition_column]
        if (evaluateCondition(depValue, config.condition_value, config.operator ?? 'equals')) {
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
