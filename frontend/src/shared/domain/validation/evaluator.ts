import { compareCanonicalDecimals, normalizeDecimalInput } from '../decimal'

import { compilePortablePattern, PortablePatternError, type PortablePattern } from './pattern'
import type {
  ConditionInput,
  LayerInput,
  ParameterDefinition,
  PriorPorSpec,
  ProjectContext,
  RequiredIfSpec,
  ValidationInput,
  ValidationIssue,
  ValidationRuleDefinition,
  ValidationScope,
  ValidationSeverity,
} from './types'

interface PreparedParameter {
  readonly definition: ParameterDefinition
  readonly minValue: string | null
  readonly maxValue: string | null
  readonly pattern: PortablePattern | null
  readonly choices: ReadonlyMap<string, boolean>
}

type IssueCode = ValidationIssue['code']
type DetailsFor<Code extends IssueCode> = Extract<ValidationIssue, { code: Code }>['details']

export class ValidationConfigurationError extends Error {
  readonly code = 'validation_configuration_invalid'

  constructor() {
    super('검증 규칙 구성이 올바르지 않습니다.')
    this.name = 'ValidationConfigurationError'
  }
}

class InvalidDecimalError extends Error {}

const DECIMAL_PATTERN = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/

export function evaluateProject(input: ValidationInput): readonly ValidationIssue[] {
  const { preparedByCode, orderedParameters } = prepareParameters(input.parameters)

  const layerKeys = new Set(input.layers.map((layer) => layer.key))
  if (layerKeys.size !== input.layers.length) configurationInvalid()
  const orderedLayers = [...input.layers]
    .sort(compareLayers)
    .map((layer) => ({
      layer,
      conditions: [...layer.conditions].sort(compareConditions),
    }))

  const issues: ValidationIssue[] = []
  for (const { layer, conditions } of orderedLayers) {
    for (const condition of conditions) {
      for (const parameter of orderedParameters) {
        evaluateStandaloneCell(parameter, layer, condition, issues)
      }
    }
  }

  const seenRuleCodes = new Set<string>()
  const orderedRules = [...input.rules].sort(compareRules)
  for (const rule of orderedRules) {
    if (seenRuleCodes.has(rule.code)) configurationInvalid()
    seenRuleCodes.add(rule.code)
    if (!scopeAppliesToProject(rule.scope, input.context)) continue

    if (rule.spec.type === 'required_if') {
      evaluateRequiredIf(rule, rule.spec, preparedByCode, orderedLayers, issues)
    } else if (rule.spec.type === 'value_exists_in_prior_por') {
      evaluatePriorPor(rule, rule.spec, preparedByCode, orderedLayers, issues)
    } else {
      configurationInvalid()
    }
  }

  const layerRank = new Map(orderedLayers.map(({ layer }, rank) => [layer.key, rank]))
  const conditionRank = new Map(
    orderedLayers.map(({ layer, conditions }) => [
      layer.key,
      new Map(
        conditions.map((condition) => [
          condition.id,
          [condition.condition_index, condition.id] as const,
        ]),
      ),
    ]),
  )
  const parameterRank = new Map(
    orderedParameters.map((parameter) => [
      parameter.definition.code,
      [parameter.definition.sort_order, parameter.definition.code] as const,
    ]),
  )

  issues.sort((left, right) =>
    compareIssue(left, right, layerRank, conditionRank, parameterRank),
  )
  return issues
}

function prepareParameters(parameters: readonly ParameterDefinition[]): {
  readonly preparedByCode: ReadonlyMap<string, PreparedParameter>
  readonly orderedParameters: readonly PreparedParameter[]
} {
  const preparedByCode = new Map<string, PreparedParameter>()
  for (const parameter of parameters) {
    if (preparedByCode.has(parameter.code)) configurationInvalid()

    let minValue: string | null = null
    let maxValue: string | null = null
    let pattern: PortablePattern | null = null
    const choices = new Map<string, boolean>()

    if (parameter.value_type === 'number') {
      if (parameter.pattern !== null || parameter.pattern_hint !== null) configurationInvalid()
      if (parameter.choices.length > 0 || parameter.choice_set_code !== null) {
        configurationInvalid()
      }
      try {
        if (parameter.min_value !== null) minValue = normalizeDecimal(parameter.min_value)
        if (parameter.max_value !== null) maxValue = normalizeDecimal(parameter.max_value)
      } catch (error) {
        if (!(error instanceof InvalidDecimalError)) throw error
        configurationInvalid()
      }
      if (
        minValue !== null &&
        maxValue !== null &&
        compareCanonicalDecimals(minValue, maxValue) > 0
      ) {
        configurationInvalid()
      }
    } else if (parameter.value_type === 'text') {
      if (parameter.min_value !== null || parameter.max_value !== null) configurationInvalid()
      if (parameter.choices.length > 0 || parameter.choice_set_code !== null) {
        configurationInvalid()
      }
      if ((parameter.pattern === null) !== (parameter.pattern_hint === null)) {
        configurationInvalid()
      }
      if (parameter.pattern !== null) {
        try {
          pattern = compilePortablePattern(parameter.pattern)
        } catch (error) {
          if (!(error instanceof PortablePatternError)) throw error
          configurationInvalid()
        }
      }
    } else if (parameter.value_type === 'choice') {
      if (parameter.min_value !== null || parameter.max_value !== null) configurationInvalid()
      if (parameter.pattern !== null || parameter.pattern_hint !== null) configurationInvalid()
      if (parameter.choice_set_code === null) configurationInvalid()
      for (const choice of parameter.choices) {
        if (choices.has(choice.code)) configurationInvalid()
        choices.set(choice.code, choice.is_active)
      }
    } else {
      configurationInvalid()
    }

    preparedByCode.set(parameter.code, {
      definition: parameter,
      minValue,
      maxValue,
      pattern,
      choices,
    })
  }

  return {
    preparedByCode,
    orderedParameters: [...preparedByCode.values()].sort((left, right) =>
      compareOrderAndText(
        left.definition.sort_order,
        left.definition.code,
        right.definition.sort_order,
        right.definition.code,
      ),
    ),
  }
}

function evaluateStandaloneCell(
  parameter: PreparedParameter,
  layer: LayerInput,
  condition: ConditionInput,
  issues: ValidationIssue[],
): void {
  const definition = parameter.definition
  const rawValue = condition.values[definition.code]
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    if (definition.required) {
      issues.push(standaloneIssue('required', condition, layer, definition.code, {}))
    }
    return
  }

  if (definition.value_type === 'number') {
    let canonical: string
    try {
      canonical = normalizeDecimal(rawValue)
    } catch (error) {
      if (!(error instanceof InvalidDecimalError)) throw error
      issues.push(standaloneIssue('number_malformed', condition, layer, definition.code, {}))
      return
    }
    const details = { max_value: parameter.maxValue, min_value: parameter.minValue }
    if (
      parameter.minValue !== null &&
      compareCanonicalDecimals(canonical, parameter.minValue) < 0
    ) {
      issues.push(standaloneIssue('range_min', condition, layer, definition.code, details))
    } else if (
      parameter.maxValue !== null &&
      compareCanonicalDecimals(canonical, parameter.maxValue) > 0
    ) {
      issues.push(standaloneIssue('range_max', condition, layer, definition.code, details))
    }
    return
  }

  if (definition.value_type === 'text') {
    if (parameter.pattern !== null && !parameter.pattern.matches(rawValue)) {
      issues.push(
        standaloneIssue('pattern_mismatch', condition, layer, definition.code, {
          pattern_hint: definition.pattern_hint,
        }),
      )
    }
    return
  }

  const active = parameter.choices.get(rawValue)
  if (active === undefined) {
    issues.push(standaloneIssue('choice_unknown', condition, layer, definition.code, {}))
  } else if (!active) {
    issues.push(
      standaloneIssue(
        'choice_inactive',
        condition,
        layer,
        definition.code,
        {},
        'warning',
      ),
    )
  }
}

function evaluateRequiredIf(
  rule: ValidationRuleDefinition,
  spec: RequiredIfSpec,
  preparedByCode: ReadonlyMap<string, PreparedParameter>,
  orderedLayers: readonly OrderedLayer[],
  issues: ValidationIssue[],
): void {
  if (spec.schema_version !== 1) configurationInvalid()
  const when = requireParameter(preparedByCode, spec.when_parameter_code)
  requireParameter(preparedByCode, spec.required_parameter_code)
  const equals = canonicalConfigurationValue(when.definition, spec.equals)
  if (when.definition.value_type === 'choice' && !when.choices.has(equals)) {
    configurationInvalid()
  }

  for (const { layer, conditions } of orderedLayers) {
    if (!scopeAppliesToLayer(rule.scope, layer)) continue
    for (const condition of conditions) {
      const current = storedTypedValue(
        when.definition,
        condition.values[spec.when_parameter_code],
      )
      if (current !== equals) continue
      const target = condition.values[spec.required_parameter_code]
      if (target !== undefined && target !== null && target !== '') continue
      issues.push(
        relationIssue('required_if', rule, condition, layer, spec.required_parameter_code, {
          equals,
          required_parameter_code: spec.required_parameter_code,
          when_parameter_code: spec.when_parameter_code,
        }),
      )
    }
  }
}

function evaluatePriorPor(
  rule: ValidationRuleDefinition,
  spec: PriorPorSpec,
  preparedByCode: ReadonlyMap<string, PreparedParameter>,
  orderedLayers: readonly OrderedLayer[],
  issues: ValidationIssue[],
): void {
  if (spec.schema_version !== 1) configurationInvalid()
  const source = requireParameter(preparedByCode, spec.source_parameter_code)
  const candidate = requireParameter(preparedByCode, spec.candidate_parameter_code)
  if (source.definition.value_type !== candidate.definition.value_type) configurationInvalid()
  if (
    source.definition.value_type === 'choice' &&
    source.definition.choice_set_code !== candidate.definition.choice_set_code
  ) {
    configurationInvalid()
  }

  const priorCandidates = new Set<string>()
  let searchedLayerCount = 0
  for (const { layer, conditions } of orderedLayers) {
    if (scopeAppliesToLayer(rule.scope, layer)) {
      for (const condition of conditions) {
        const current = storedTypedValue(
          source.definition,
          condition.values[spec.source_parameter_code],
        )
        if (current !== null && !priorCandidates.has(current)) {
          issues.push(
            relationIssue(
              'value_not_found_in_prior_por',
              rule,
              condition,
              layer,
              spec.source_parameter_code,
              {
                candidate_parameter_code: spec.candidate_parameter_code,
                searched_layer_count: searchedLayerCount,
              },
            ),
          )
        }
      }
    }

    const por = conditions.find((condition) => condition.is_por)
    if (por !== undefined) {
      const currentCandidate = storedTypedValue(
        candidate.definition,
        por.values[spec.candidate_parameter_code],
      )
      if (currentCandidate !== null) priorCandidates.add(currentCandidate)
    }
    searchedLayerCount += 1
  }
}

interface OrderedLayer {
  readonly layer: LayerInput
  readonly conditions: readonly ConditionInput[]
}

function requireParameter(
  preparedByCode: ReadonlyMap<string, PreparedParameter>,
  code: string,
): PreparedParameter {
  const parameter = preparedByCode.get(code)
  if (parameter === undefined) configurationInvalid()
  return parameter
}

function canonicalConfigurationValue(parameter: ParameterDefinition, value: string): string {
  let canonical: string | null
  try {
    canonical = canonicalTypedValue(parameter, value)
  } catch (error) {
    if (!(error instanceof InvalidDecimalError)) throw error
    configurationInvalid()
  }
  if (canonical === null) configurationInvalid()
  return canonical
}

function storedTypedValue(
  parameter: ParameterDefinition,
  rawValue: string | null | undefined,
): string | null {
  try {
    return canonicalTypedValue(parameter, rawValue)
  } catch (error) {
    if (!(error instanceof InvalidDecimalError)) throw error
    return null
  }
}

function canonicalTypedValue(
  parameter: ParameterDefinition,
  rawValue: string | null | undefined,
): string | null {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null
  return parameter.value_type === 'number' ? normalizeDecimal(rawValue) : rawValue
}

function normalizeDecimal(raw: string): string {
  const text = stripPythonWhitespace(raw)
  if (
    text === '' ||
    [...text].length > 256 ||
    !DECIMAL_PATTERN.test(text) ||
    [...text].filter((character) => character >= '0' && character <= '9').length > 128
  ) {
    throw new InvalidDecimalError()
  }
  // Exact validation above neutralizes the small Python-strip/JavaScript-trim set difference;
  // reuse the established frontend canonicalizer for the string-only normalization itself.
  const result = normalizeDecimalInput(text)
  if (result.kind !== 'valid') throw new InvalidDecimalError()
  return result.value
}

function stripPythonWhitespace(raw: string): string {
  const characters = [...raw]
  let start = 0
  let end = characters.length
  while (start < end && isPythonWhitespace(codePoint(characters[start] ?? ''))) start += 1
  while (end > start && isPythonWhitespace(codePoint(characters[end - 1] ?? ''))) end -= 1
  return characters.slice(start, end).join('')
}

function isPythonWhitespace(value: number): boolean {
  return (
    (value >= 0x0009 && value <= 0x000d) ||
    (value >= 0x001c && value <= 0x0020) ||
    value === 0x0085 ||
    value === 0x00a0 ||
    value === 0x1680 ||
    (value >= 0x2000 && value <= 0x200a) ||
    value === 0x2028 ||
    value === 0x2029 ||
    value === 0x202f ||
    value === 0x205f ||
    value === 0x3000
  )
}

function scopeAppliesToProject(scope: ValidationScope, context: ProjectContext): boolean {
  return (
    (scope.line_ids.length === 0 || scope.line_ids.includes(context.line_id)) &&
    (scope.process_ids.length === 0 || scope.process_ids.includes(context.process_id))
  )
}

function scopeAppliesToLayer(scope: ValidationScope, layer: LayerInput): boolean {
  return (
    (scope.layer_ids.length === 0 || scope.layer_ids.includes(layer.layer_id)) &&
    (scope.step_seqs.length === 0 || scope.step_seqs.includes(layer.step_seq)) &&
    (scope.eqp_types.length === 0 || includesNullable(scope.eqp_types, layer.eqp_type)) &&
    (scope.area_names.length === 0 || includesNullable(scope.area_names, layer.area_name))
  )
}

function includesNullable(values: readonly string[], value: string | null): boolean {
  return value !== null && values.includes(value)
}

function standaloneIssue<Code extends Exclude<IssueCode, 'required_if' | 'value_not_found_in_prior_por'>>(
  code: Code,
  condition: ConditionInput,
  layer: LayerInput,
  parameterCode: string,
  details: DetailsFor<Code>,
  severity: ValidationSeverity = 'error',
): Extract<ValidationIssue, { code: Code }> {
  // Code and details are tied by DetailsFor<Code>; the assertion only restores that generic
  // correlation after constructing the common wire-order object.
  return {
    key: `${code}:${condition.id}:${parameterCode}`,
    code,
    rule_code: null,
    rule_version: null,
    severity,
    condition_id: condition.id,
    layer_key: layer.key,
    parameter_code: parameterCode,
    details,
  } as Extract<ValidationIssue, { code: Code }>
}

function relationIssue<Code extends 'required_if' | 'value_not_found_in_prior_por'>(
  code: Code,
  rule: ValidationRuleDefinition,
  condition: ConditionInput,
  layer: LayerInput,
  parameterCode: string,
  details: DetailsFor<Code>,
): Extract<ValidationIssue, { code: Code }> {
  return {
    key: `${code}:${rule.code}:${rule.version}:${condition.id}:${parameterCode}`,
    code,
    rule_code: rule.code,
    rule_version: rule.version,
    severity: rule.severity,
    condition_id: condition.id,
    layer_key: layer.key,
    parameter_code: parameterCode,
    details,
  } as Extract<ValidationIssue, { code: Code }>
}

function compareLayers(left: LayerInput, right: LayerInput): number {
  return compareOrderAndText(left.sort_order, left.key, right.sort_order, right.key)
}

function compareConditions(left: ConditionInput, right: ConditionInput): number {
  return compareNumbers(left.condition_index, right.condition_index) || compareNumbers(left.id, right.id)
}

function compareRules(left: ValidationRuleDefinition, right: ValidationRuleDefinition): number {
  return compareText(left.code, right.code) || compareNumbers(left.version, right.version)
}

function compareIssue(
  left: ValidationIssue,
  right: ValidationIssue,
  layerRank: ReadonlyMap<string, number>,
  conditionRank: ReadonlyMap<string, ReadonlyMap<number, readonly [number, number]>>,
  parameterRank: ReadonlyMap<string, readonly [number, string]>,
): number {
  const severity = severityRank(left.severity) - severityRank(right.severity)
  if (severity !== 0) return severity
  const layer = requireRank(layerRank, left.layer_key) - requireRank(layerRank, right.layer_key)
  if (layer !== 0) return layer

  const leftCondition = requireConditionRank(conditionRank, left)
  const rightCondition = requireConditionRank(conditionRank, right)
  const condition = compareNumbers(leftCondition[0], rightCondition[0]) ||
    compareNumbers(leftCondition[1], rightCondition[1])
  if (condition !== 0) return condition

  const leftParameter = requireParameterRank(parameterRank, left.parameter_code)
  const rightParameter = requireParameterRank(parameterRank, right.parameter_code)
  const parameter = compareNumbers(leftParameter[0], rightParameter[0]) ||
    compareText(leftParameter[1], rightParameter[1])
  if (parameter !== 0) return parameter

  return (
    compareText(left.rule_code ?? '', right.rule_code ?? '') ||
    compareNumbers(left.rule_version ?? -1, right.rule_version ?? -1) ||
    compareText(left.key, right.key)
  )
}

function severityRank(severity: ValidationSeverity): number {
  return severity === 'error' ? 0 : 1
}

function requireRank(ranks: ReadonlyMap<string, number>, key: string): number {
  const rank = ranks.get(key)
  if (rank === undefined) configurationInvalid()
  return rank
}

function requireConditionRank(
  ranks: ReadonlyMap<string, ReadonlyMap<number, readonly [number, number]>>,
  issue: ValidationIssue,
): readonly [number, number] {
  const rank = ranks.get(issue.layer_key)?.get(issue.condition_id)
  if (rank === undefined) configurationInvalid()
  return rank
}

function requireParameterRank(
  ranks: ReadonlyMap<string, readonly [number, string]>,
  code: string,
): readonly [number, string] {
  const rank = ranks.get(code)
  if (rank === undefined) configurationInvalid()
  return rank
}

function compareOrderAndText(
  leftOrder: number,
  leftText: string,
  rightOrder: number,
  rightText: string,
): number {
  return compareNumbers(leftOrder, rightOrder) || compareText(leftText, rightText)
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Python string ordering compares Unicode code points; JavaScript's `<` compares UTF-16 units. */
function compareText(left: string, right: string): number {
  const leftPoints = [...left].map(codePoint)
  const rightPoints = [...right].map(codePoint)
  const width = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < width; index += 1) {
    const comparison = compareNumbers(leftPoints[index] ?? 0, rightPoints[index] ?? 0)
    if (comparison !== 0) return comparison
  }
  return compareNumbers(leftPoints.length, rightPoints.length)
}

function codePoint(character: string): number {
  return character.codePointAt(0) ?? 0
}

function configurationInvalid(): never {
  throw new ValidationConfigurationError()
}
