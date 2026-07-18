export type BackboneDiffClassification = 'added' | 'changed' | 'cleared' | 'removed' | 'unchanged'
export type BackboneDiffRowStatus = 'matched' | 'added' | 'removed'
export type BackboneDiffLayerStatus = 'available' | 'unavailable'
export type BackboneDiffJumpStatus = 'available' | 'deleted'
export type BackboneDiffItemKind = 'row' | 'cell'

export interface BackboneDiffRootQueryInput {
  classification?: readonly BackboneDiffClassification[]
  layerKey?: string | null
  categoryCode?: string | null
  parameterCode?: string | null
  includeUnchanged?: boolean
  previewLimit?: number
}

export interface BackboneDiffBranchQueryInput {
  scope?: string
  cursor?: string | null
  limit?: number
}

export interface BackboneDiffCellQueryInput {
  scope?: string
  cursor?: string | null
  limit?: number
}

export interface BackboneDiffRootQueryOptions {
  readonly classification: readonly BackboneDiffClassification[]
  readonly layerKey: string | null
  readonly categoryCode: string | null
  readonly parameterCode: string | null
  readonly includeUnchanged: boolean
  readonly previewLimit: number
}

export interface BackboneDiffBranchQueryOptions {
  readonly scope: string
  readonly cursor: string | null
  readonly limit: number
}

export interface BackboneDiffCellQueryOptions {
  readonly scope: string
  readonly cursor: string | null
  readonly limit: number
}

export interface BackboneDiffCountsOut {
  layer_count: number
  available_layer_count: number
  unavailable_layer_count: number
  row_count: number
  cell_count: number
  full_row_count: number
  full_cell_count: number
  ambiguous_lineage_count: number
  added_count: number
  changed_count: number
  cleared_count: number
  removed_count: number
  unchanged_count: number
}

export interface BackboneDiffRowMetadataOut {
  label_changed: boolean
  index_changed: boolean
  por_changed: boolean
}

export interface BackboneDiffConditionMetadataOut {
  condition_id: number | null
  source_condition_id: number | null
  label: string | null
  condition_index: number | null
  is_por: boolean | null
}

export interface BackboneDiffParameterMetadataOut {
  parameter_code: string
  value_type: string
  display_name: string
  category_code: string | null
  sort_order: number
  active: boolean
}

export interface BackboneDiffLayerSummaryOut {
  layer_key: string
  layer_sort: number
  layer_status: BackboneDiffLayerStatus
  baseline_condition_count: number
  current_condition_count: number
  row_count: number
  cell_count: number
  full_row_count: number
  full_cell_count: number
  ambiguous_lineage_count: number
  changed_count: number
  branch_scope: string | null
}

export interface BackboneDiffPreviewItemOut {
  item_kind: BackboneDiffItemKind
  classification: BackboneDiffClassification
  layer_key: string
  effective_condition_index: number
  item_sort_key: Array<string | number | null>
  status_rank: number
  row_ref: string | null
  cell_scope: string | null
  row_status: BackboneDiffRowStatus | null
  parameter_code: string | null
}

export interface BackboneDiffRootOut {
  scope: string
  basis_hash: string
  counts: BackboneDiffCountsOut
  layer_summaries: BackboneDiffLayerSummaryOut[]
  changed_preview: BackboneDiffPreviewItemOut[]
}

export interface BackboneDiffConditionItemOut {
  row_ref: string
  row_status: BackboneDiffRowStatus
  effective_condition_index: number
  identity: number
  baseline_condition: BackboneDiffConditionMetadataOut | null
  current_condition: BackboneDiffConditionMetadataOut | null
  row_metadata: BackboneDiffRowMetadataOut
  filtered_cell_count: number
  full_cell_count: number
  jump_status: BackboneDiffJumpStatus
  cell_scope: string | null
}

export interface BackboneDiffConditionPageOut {
  scope: string
  basis_hash: string
  items: BackboneDiffConditionItemOut[]
  next_cursor: string | null
}

export interface BackboneDiffCellItemOut {
  classification: BackboneDiffClassification
  reason: string
  parameter_code: string
  parameter_sort: number
  baseline_value: string | null
  current_value: string | null
  baseline_metadata: BackboneDiffParameterMetadataOut | null
  current_metadata: BackboneDiffParameterMetadataOut | null
  jump_status: BackboneDiffJumpStatus
}

export interface BackboneDiffCellPageOut {
  scope: string
  basis_hash: string
  row_ref: string
  items: BackboneDiffCellItemOut[]
  next_cursor: string | null
}

const DEFAULT_PREVIEW_LIMIT = 20
const DEFAULT_BRANCH_LIMIT = 50
const DEFAULT_CELL_LIMIT = 100

const MIN_PREVIEW_LIMIT = 0
const MAX_PREVIEW_LIMIT = 20
const MIN_BRANCH_LIMIT = 1
const MAX_BRANCH_LIMIT = 100
const MIN_CELL_LIMIT = 1
const MAX_CELL_LIMIT = 200
const MAX_CLASSIFICATION_LENGTH = 64
const MAX_LAYER_KEY_LENGTH = 256
const MAX_TOKEN_LENGTH = 4096
const MAX_CODE_LENGTH = 64
const OPAQUE_TOKEN_CHARACTERS = /^[A-Za-z0-9_-]+$/

const CLASSIFICATIONS: readonly BackboneDiffClassification[] = [
  'added',
  'changed',
  'cleared',
  'removed',
  'unchanged',
]

const CLASSIFICATION_SORT_WEIGHT: Record<BackboneDiffClassification, number> = {
  added: 0,
  changed: 1,
  cleared: 2,
  removed: 3,
  unchanged: 4,
}

export const BACKBONE_DIFF_ALLOWED_CLASSIFICATIONS: readonly BackboneDiffClassification[] = CLASSIFICATIONS

export function createBackboneDiffRootQueryOptions(
  input: BackboneDiffRootQueryInput = {},
): BackboneDiffRootQueryOptions {
  const includeUnchanged = input.includeUnchanged ?? false
  const normalized = normalizeBackboneDiffClassifications(input.classification ?? [], includeUnchanged)

  return {
    classification: normalized,
    layerKey: normalizeOptionalText(input.layerKey ?? null, 'layerKey', MAX_LAYER_KEY_LENGTH),
    categoryCode: normalizeOptionalText(input.categoryCode ?? null, 'categoryCode', MAX_CODE_LENGTH),
    parameterCode: normalizeOptionalText(input.parameterCode ?? null, 'parameterCode', MAX_CODE_LENGTH),
    includeUnchanged,
    previewLimit: normalizeLimit(
      input.previewLimit ?? DEFAULT_PREVIEW_LIMIT,
      MIN_PREVIEW_LIMIT,
      MAX_PREVIEW_LIMIT,
      'previewLimit',
    ),
  }
}

export function createBackboneDiffBranchQueryOptions(
  input: BackboneDiffBranchQueryInput,
): BackboneDiffBranchQueryOptions {
  return {
    scope: normalizeRequiredOpaqueToken(input.scope, 'scope'),
    cursor: normalizeOptionalToken(input.cursor ?? null, 'cursor'),
    limit: normalizeLimit(input.limit ?? DEFAULT_BRANCH_LIMIT, MIN_BRANCH_LIMIT, MAX_BRANCH_LIMIT, 'limit'),
  }
}

export function createBackboneDiffCellQueryOptions(
  input: BackboneDiffCellQueryInput,
): BackboneDiffCellQueryOptions {
  return {
    scope: normalizeRequiredOpaqueToken(input.scope, 'scope'),
    cursor: normalizeOptionalToken(input.cursor ?? null, 'cursor'),
    limit: normalizeLimit(input.limit ?? DEFAULT_CELL_LIMIT, MIN_CELL_LIMIT, MAX_CELL_LIMIT, 'limit'),
  }
}

export function backboneDiffProjectQueryKey(projectId: number): readonly ['backboneDiff', number] {
  return ['backboneDiff', projectId]
}

export function backboneDiffRootQueryKey(
  projectId: number,
  queryInput: BackboneDiffRootQueryInput = {},
): readonly unknown[] {
  return [...backboneDiffProjectQueryKey(projectId), 'root', createBackboneDiffRootQueryOptions(queryInput)]
}

export function backboneDiffBranchQueryKey(
  projectId: number,
  layerKey: string,
  queryInput: BackboneDiffBranchQueryInput,
): readonly unknown[] {
  return [
    ...backboneDiffProjectQueryKey(projectId),
    'branch',
    normalizePathToken(layerKey, 'layerKey', MAX_LAYER_KEY_LENGTH),
    createBackboneDiffBranchQueryOptions(queryInput),
  ]
}

export function backboneDiffCellQueryKey(
  projectId: number,
  layerKey: string,
  rowRef: string,
  queryInput: BackboneDiffCellQueryInput,
): readonly unknown[] {
  const options = createBackboneDiffCellQueryOptions(queryInput)
  return [
    ...backboneDiffProjectQueryKey(projectId),
    'cell',
    normalizePathToken(layerKey, 'layerKey', MAX_LAYER_KEY_LENGTH),
    normalizeRequiredOpaqueToken(rowRef, 'rowRef'),
    options,
  ]
}

export function backboneDiffBranchPath(projectId: number, layerKey: string): string {
  return `/projects/${projectId}/backbone-diff/layers/${encodePathToken(layerKey, 'layerKey', MAX_LAYER_KEY_LENGTH)}/conditions`
}

export function backboneDiffCellPath(
  projectId: number,
  layerKey: string,
  rowRef: string,
): string {
  return `/projects/${projectId}/backbone-diff/layers/${encodePathToken(layerKey, 'layerKey', MAX_LAYER_KEY_LENGTH)}/conditions/${encodeOpaquePathToken(rowRef, 'rowRef')}/cells`
}

export function buildBackboneDiffRootQueryString(
  input: BackboneDiffRootQueryInput = {},
): string {
  const query = new URLSearchParams()
  const normalized = createBackboneDiffRootQueryOptions(input)

  if (normalized.layerKey !== null) {
    query.set('layer_key', normalized.layerKey)
  }
  for (const classification of normalized.classification) {
    query.append('classification', classification)
  }
  if (normalized.categoryCode !== null) {
    query.set('category_code', normalized.categoryCode)
  }
  if (normalized.parameterCode !== null) {
    query.set('parameter_code', normalized.parameterCode)
  }
  if (normalized.includeUnchanged) {
    query.set('include_unchanged', 'true')
  }
  query.set('preview_limit', String(normalized.previewLimit))

  return query.toString()
}

export function buildBackboneDiffBranchQueryString(input: BackboneDiffBranchQueryInput): string {
  const query = new URLSearchParams()
  const normalized = createBackboneDiffBranchQueryOptions(input)
  query.set('scope', normalized.scope)
  if (normalized.cursor !== null) {
    query.set('cursor', normalized.cursor)
  }
  query.set('limit', String(normalized.limit))
  return query.toString()
}

export function buildBackboneDiffCellQueryString(input: BackboneDiffCellQueryInput): string {
  const query = new URLSearchParams()
  const normalized = createBackboneDiffCellQueryOptions(input)
  query.set('scope', normalized.scope)
  if (normalized.cursor !== null) {
    query.set('cursor', normalized.cursor)
  }
  query.set('limit', String(normalized.limit))
  return query.toString()
}

function normalizeBackboneDiffClassifications(
  classifications: readonly BackboneDiffClassification[] | undefined,
  includeUnchanged: boolean,
): readonly BackboneDiffClassification[] {
  if (!Array.isArray(classifications)) {
    throw new TypeError('classification must be an array')
  }

  const filtered = classifications.filter((raw): raw is BackboneDiffClassification => {
    if (typeof raw !== 'string') {
      throw new TypeError('classification values must be one of the allowed values')
    }
    return CLASSIFICATIONS.includes(raw.trim() as BackboneDiffClassification)
  })

  if (filtered.length !== classifications.length) {
    throw new TypeError('classification values must be one of the allowed values')
  }

  const normalized = [...new Set(filtered.map((value) => value.trim() as BackboneDiffClassification))]
    .sort((left, right) => CLASSIFICATION_SORT_WEIGHT[left] - CLASSIFICATION_SORT_WEIGHT[right])

  if (!includeUnchanged && normalized.includes('unchanged')) {
    throw new TypeError('include_unchanged must be true when classification includes unchanged')
  }

  if (normalized.some((value) => value.length > MAX_CLASSIFICATION_LENGTH)) {
    throw new TypeError('classification contains an unsupported value')
  }

  return normalized
}

function normalizeLimit(
  value: number,
  min: number,
  max: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer between ${min} and ${max}`)
  }
  return value
}

function normalizeOptionalText(
  value: string | null,
  label: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const normalized = value.trim()
  if (normalized === '') {
    return null
  }
  if (normalized.length > maxLength) {
    throw new TypeError(`${label} is too long`)
  }
  return normalized
}

function normalizeRequiredToken(value: string | undefined | null, label: string): string {
  if (value === undefined || value === null) {
    throw new TypeError(`${label} is required`)
  }
  const normalized = value.trim()
  if (normalized === '') {
    throw new TypeError(`${label} is required`)
  }
  if (normalized.length > MAX_TOKEN_LENGTH) {
    throw new TypeError(`${label} must be at most ${MAX_TOKEN_LENGTH} characters`)
  }
  return normalized
}

function normalizeRequiredOpaqueToken(value: string | undefined | null, label: string): string {
  if (value === undefined || value === null) {
    throw new TypeError(`${label} is required`)
  }
  if (value.length === 0) {
    throw new TypeError(`${label} is required`)
  }
  if (value.length > MAX_TOKEN_LENGTH) {
    throw new TypeError(`${label} must be at most ${MAX_TOKEN_LENGTH} characters`)
  }
  if (!OPAQUE_TOKEN_CHARACTERS.test(value)) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

function normalizeOptionalToken(value: string | null, label: string): string | null {
  return normalizeOptionalOpaqueToken(value, label)
}

function normalizeOptionalOpaqueToken(value: string | null, label: string): string | null {
  if (value === null) {
    return null
  }
  return normalizeRequiredOpaqueToken(value, label)
}

function normalizePathToken(value: string, label: string, maxLength: number): string {
  const normalized = normalizeRequiredToken(value, label)
  if (normalized.length > maxLength) {
    throw new TypeError(`${label} is too long`)
  }
  return normalized
}

function encodePathToken(value: string, label: string, maxLength: number): string {
  return encodeURIComponent(normalizePathToken(value, label, maxLength))
}

function encodeOpaquePathToken(value: string, label: string): string {
  return encodeURIComponent(normalizeRequiredOpaqueToken(value, label))
}
