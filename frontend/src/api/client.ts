import axios, { AxiosError } from 'axios'
import { useToastStore } from '@/stores/useToastStore'

const client = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ detail?: string }>) => {
    const addToast = useToastStore.getState().addToast

    if (!error.response) {
      addToast('서버에 연결할 수 없습니다. 네트워크를 확인해주세요.', 'error')
      return Promise.reject(new ApiError(0, '네트워크 연결 오류'))
    }

    const { status, data } = error.response
    const detail = data?.detail || '알 수 없는 오류가 발생했습니다.'
    const originalRequest = error.config
    const url = originalRequest?.url || ''

    if (status === 401) {
      const isAuthEndpoint =
        url.includes('/auth/me') ||
        url.includes('/auth/login') ||
        url.includes('/auth/logout') ||
        url.includes('/auth/callback')

      if (!isAuthEndpoint && typeof window !== 'undefined') {
        const currentPath = window.location.pathname
        window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`
      }

      return Promise.reject(new ApiError(status, detail))
    }

    if (status === 409) {
      return Promise.reject(new ApiError(status, detail))
    }

    if (status === 404) {
      addToast('요청한 리소스를 찾을 수 없습니다.', 'error')
    } else if (status === 422) {
      addToast(`입력값 오류: ${detail}`, 'error')
    } else if (status >= 500) {
      addToast('서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 'error')
    } else if (status >= 400) {
      addToast(detail, 'error')
    }

    return Promise.reject(new ApiError(status, detail))
  }
)

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export default client
