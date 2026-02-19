import axios, { AxiosError } from 'axios'
import { useToastStore } from '@/stores/useToastStore'
import { authToken } from '@/api/authToken'

const client = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // Send cookies (refresh_token) automatically
})

// -------------------------------------------------------------------------
// Token refresh queue management
// -------------------------------------------------------------------------
let isRefreshing = false
let refreshQueue: Array<{
  resolve: (token: string) => void
  reject: (error: unknown) => void
}> = []

function processQueue(error: unknown, token: string | null = null) {
  refreshQueue.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error)
    } else {
      resolve(token!)
    }
  })
  refreshQueue = []
}

// -------------------------------------------------------------------------
// Request interceptor: attach Authorization header from authToken singleton
// -------------------------------------------------------------------------
client.interceptors.request.use((config) => {
  const token = authToken.get()
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// -------------------------------------------------------------------------
// Response interceptor: unified error handling + 401 token refresh
// -------------------------------------------------------------------------
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
    const originalRequest = error.config!

    // -----------------------------------------------------------------------
    // 401 Unauthorized: attempt token refresh (except for auth endpoints)
    // -----------------------------------------------------------------------
    if (status === 401) {
      const url = originalRequest.url || ''
      const isAuthEndpoint = url.includes('/auth/refresh') || url.includes('/auth/login')

      if (!isAuthEndpoint) {
        if (isRefreshing) {
          // Queue this request to be replayed after refresh completes
          return new Promise((resolve, reject) => {
            refreshQueue.push({ resolve, reject })
          }).then((token) => {
            originalRequest.headers['Authorization'] = `Bearer ${token}`
            return client(originalRequest)
          })
        }

        isRefreshing = true

        try {
          const newToken = await authToken.refresh()

          if (newToken) {
            processQueue(null, newToken)
            originalRequest.headers['Authorization'] = `Bearer ${newToken}`
            isRefreshing = false
            return client(originalRequest)
          } else {
            const sessionError = new ApiError(401, 'Session expired')
            processQueue(sessionError)
            authToken.clearAuth()
            if (typeof window !== 'undefined') {
              const currentPath = window.location.pathname
              window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`
            }
            return Promise.reject(sessionError)
          }
        } catch (refreshError) {
          processQueue(refreshError)
          authToken.clearAuth()
          if (typeof window !== 'undefined') {
            const currentPath = window.location.pathname
            window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`
          }
          return Promise.reject(new ApiError(401, 'Session expired'))
        } finally {
          isRefreshing = false
        }
      }

      // Auth endpoints returning 401 fall through to default error handling
      return Promise.reject(new ApiError(status, detail))
    }

    // -----------------------------------------------------------------------
    // Other error status codes
    // -----------------------------------------------------------------------

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
