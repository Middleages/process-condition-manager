import axios, { AxiosError } from 'axios'
import { useUserStore } from '@/stores/useUserStore'
import { useToastStore } from '@/stores/useToastStore'

const client = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor: attach X-User-Id header
client.interceptors.request.use((config) => {
  const userId = useUserStore.getState().currentUserId
  if (userId) {
    config.headers['X-User-Id'] = String(userId)
  }
  return config
})

// Response interceptor: unified error handling
client.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ detail?: string }>) => {
    const addToast = useToastStore.getState().addToast

    if (!error.response) {
      addToast('서버에 연결할 수 없습니다. 네트워크를 확인해주세요.', 'error')
      return Promise.reject(new ApiError(0, '네트워크 연결 오류'))
    }

    const { status, data } = error.response
    const detail = data?.detail || '알 수 없는 오류가 발생했습니다.'

    // 409 Conflict: let caller handle (bulk save conflict detection)
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
