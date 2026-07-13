import axios, { AxiosError } from 'axios'

import type { ApiErrorBody } from './types'

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

function isApiError(error: unknown): error is AxiosError<ApiErrorBody> {
  return axios.isAxiosError<ApiErrorBody>(error)
}

/**
 * 잠금 충돌(409) 여부. 잠금 획득 실패(다른 사용자 편집 중), 하트비트/셀 저장 시
 * 토큰 무효(잠금 상실)가 모두 409 + `code: "lock_conflict"`로 온다. 상태 코드만으로도
 * 충분하지만, 코드가 실려 있으면 함께 확인한다.
 */
export function isLockConflict(error: unknown): boolean {
  if (!isApiError(error)) return false
  return error.response?.status === 409 || error.response?.data?.code === 'lock_conflict'
}

/** 잠금 충돌 응답에 보유자 정보가 있으면 읽기 전용 배너에 표시한다. */
export function getLockConflictHolder(error: unknown): string | null {
  if (!isLockConflict(error) || !isApiError(error)) return null
  const holder = error.response?.data?.details?.locked_by
  return typeof holder === 'string' && holder !== '' ? holder : null
}
