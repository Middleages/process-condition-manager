// ========== User ==========
export type UserRole = 'editor' | 'reviewer' | 'admin' | 'developer'

export interface User {
  id: number
  userid: string
  roles: UserRole[]
  is_active: boolean
  line_id: number | null
}

// 인증 세션 컨텍스트에 사용되는 User 부분 타입
export type AuthUser = Pick<User, 'id' | 'userid' | 'roles' | 'line_id'>
