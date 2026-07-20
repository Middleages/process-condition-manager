import axios, { AxiosError } from 'axios'

import type { ApiErrorBody, ChoiceSetSummaryOut } from './types'

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

export function getApiErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    return error.response?.data.message ?? error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return '알 수 없는 오류가 발생했다.'
}

export function getApiErrorStatus(error: unknown): number | null {
  if (!isApiError(error)) return null
  return error.response?.status ?? null
}

export function getApiErrorDetails(
  error: unknown,
  code: string,
): Record<string, unknown> | null {
  if (!isApiError(error) || error.response?.data.code !== code) return null
  const details = error.response.data.details
  return details !== null && typeof details === 'object' && !Array.isArray(details)
    ? details
    : null
}

function isApiError(error: unknown): error is AxiosError<ApiErrorBody> {
  return axios.isAxiosError<ApiErrorBody>(error)
}

/** 잠금 획득 실패나 잠금 상실의 409 `lock_conflict` 여부. */
export function isLockConflict(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.response?.status === 409 &&
    error.response.data?.code === 'lock_conflict'
  )
}

export function isChoiceSetChanged(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.response?.status === 409 &&
    error.response.data?.code === 'choice_set_changed'
  )
}

export function getChoiceSetChangedDetails(error: unknown): Record<string, unknown> | null {
  if (!isChoiceSetChanged(error) || !isApiError(error)) return null
  const details: unknown = error.response?.data?.details
  return details !== null && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : null
}

export function getChoiceSetChangedSummary(error: unknown): ChoiceSetSummaryOut | null {
  const raw = getChoiceSetChangedDetails(error)?.choice_set
  return isChoiceSetSummary(raw) ? raw : null
}

function isChoiceSetSummary(value: unknown): value is ChoiceSetSummaryOut {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const summary = value as Record<string, unknown>
  return (
    typeof summary.code === 'string' &&
    typeof summary.display_name === 'string' &&
    (summary.description === null || typeof summary.description === 'string') &&
    typeof summary.is_active === 'boolean' &&
    isPositiveInteger(summary.version) &&
    isNonNegativeInteger(summary.option_count) &&
    isNonNegativeInteger(summary.active_option_count) &&
    isNonNegativeInteger(summary.parameter_usage_count) &&
    Array.isArray(summary.profile_usage_fields) &&
    summary.profile_usage_fields.every((field) => typeof field === 'string') &&
    typeof summary.created_at === 'string' &&
    typeof summary.updated_at === 'string'
  )
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

/** 잠금 충돌 응답에 보유자 정보가 있으면 읽기 전용 배너에 표시한다. */
export function getLockConflictHolder(error: unknown): string | null {
  if (!isLockConflict(error) || !isApiError(error)) return null
  const holder = error.response?.data?.details?.locked_by
  return typeof holder === 'string' && holder !== '' ? holder : null
}

export function getExistingProjectId(error: unknown): number | null {
  if (!isApiError(error) || error.response?.status !== 409) return null

  const projectId = error.response.data?.details?.existing_project_id
  return Number.isInteger(projectId) && (projectId as number) > 0 ? (projectId as number) : null
}
