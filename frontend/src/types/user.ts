// ========== User ==========
export type UserRole = 'editor' | 'reviewer' | 'admin' | 'developer'

export interface User {
  id: number
  username: string
  display_name: string
  roles: UserRole[]
  is_active: boolean
  line_id: number | null
}

// 인증 세션 컨텍스트(/auth/me) 타입
// username은 구버전 클라이언트 호환을 위한 읽기 전용 alias(임시)
export interface AuthUser {
  id: number
  userid: string
  username?: string
  display_name: string
  roles: UserRole[]
  line_id: number | null
  department?: string | null
  last_login_ip?: string | null
}
