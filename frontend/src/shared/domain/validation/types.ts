export type ValidationValueType = 'text' | 'number' | 'choice'
export type ValidationSeverity = 'error' | 'warning'
export type ValidationRuleType = 'required_if' | 'value_exists_in_prior_por'

export interface ChoiceDefinition {
  readonly code: string
  readonly is_active: boolean
}

export interface ParameterDefinition {
  readonly code: string
  readonly display_name: string
  readonly value_type: ValidationValueType
  readonly required: boolean
  readonly pattern: string | null
  readonly pattern_hint: string | null
  readonly min_value: string | null
  readonly max_value: string | null
  readonly choice_set_code: string | null
  readonly choices: readonly ChoiceDefinition[]
  readonly sort_order: number
}

export interface ProjectContext {
  readonly project_id: number
  readonly line_id: string
  readonly process_id: string
}

export interface ConditionInput {
  readonly id: number
  readonly label: string
  readonly condition_index: number
  readonly is_por: boolean
  readonly values: Readonly<Record<string, string | null>>
}

export interface LayerInput {
  readonly key: string
  readonly layer_id: string
  readonly step_seq: string
  readonly eqp_type: string | null
  readonly area_name: string | null
  readonly sort_order: number
  readonly conditions: readonly ConditionInput[]
}

export interface ValidationScope {
  readonly line_ids: readonly string[]
  readonly process_ids: readonly string[]
  readonly layer_ids: readonly string[]
  readonly step_seqs: readonly string[]
  readonly eqp_types: readonly string[]
  readonly area_names: readonly string[]
}

export interface RequiredIfSpec {
  readonly schema_version: number
  readonly type: 'required_if'
  readonly when_parameter_code: string
  readonly equals: string
  readonly required_parameter_code: string
}

export interface PriorPorSpec {
  readonly schema_version: number
  readonly type: 'value_exists_in_prior_por'
  readonly source_parameter_code: string
  readonly candidate_parameter_code: string
}

export type ValidationRuleSpec = RequiredIfSpec | PriorPorSpec

export interface ValidationRuleDefinition {
  readonly code: string
  readonly name: string
  readonly severity: ValidationSeverity
  readonly version: number
  readonly scope: ValidationScope
  readonly spec: ValidationRuleSpec
}

export interface ValidationInput {
  readonly context: ProjectContext
  readonly parameters: readonly ParameterDefinition[]
  readonly layers: readonly LayerInput[]
  readonly rules: readonly ValidationRuleDefinition[]
}

export type IssueDetailValue = string | number | boolean | null

interface ValidationIssueAnchor {
  readonly key: string
  readonly rule_code: string | null
  readonly rule_version: number | null
  readonly severity: ValidationSeverity
  readonly condition_id: number
  readonly layer_key: string
  readonly parameter_code: string
}

export type EmptyIssueDetails = Readonly<Record<string, never>>
export type RangeIssueDetails = Readonly<{
  max_value: string | null
  min_value: string | null
}>
export type PatternIssueDetails = Readonly<{ pattern_hint: string | null }>
export type RequiredIfIssueDetails = Readonly<{
  equals: string
  required_parameter_code: string
  when_parameter_code: string
}>
export type PriorPorIssueDetails = Readonly<{
  candidate_parameter_code: string
  searched_layer_count: number
}>

type KnownValidationIssue<Code extends string, Details> = ValidationIssueAnchor & {
  readonly code: Code
  readonly details: Details
}

export type ValidationIssue =
  | KnownValidationIssue<'required', EmptyIssueDetails>
  | KnownValidationIssue<'number_malformed', EmptyIssueDetails>
  | KnownValidationIssue<'range_min', RangeIssueDetails>
  | KnownValidationIssue<'range_max', RangeIssueDetails>
  | KnownValidationIssue<'pattern_mismatch', PatternIssueDetails>
  | KnownValidationIssue<'choice_unknown', EmptyIssueDetails>
  | KnownValidationIssue<'choice_inactive', EmptyIssueDetails>
  | KnownValidationIssue<'required_if', RequiredIfIssueDetails>
  | KnownValidationIssue<'value_not_found_in_prior_por', PriorPorIssueDetails>

/** Future-compatible transport shape accepted by the safe message mapper. */
export interface ValidationIssuePayload extends ValidationIssueAnchor {
  readonly code: string
  readonly details: Readonly<Record<string, IssueDetailValue>>
}
