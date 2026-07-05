import axios, { AxiosError } from 'axios'

import type { ApiErrorBody } from './types'

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
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
