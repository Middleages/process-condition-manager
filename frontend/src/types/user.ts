// ========== User ==========
export type UserRole = 'editor' | 'reviewer' | 'admin' | 'developer'

export interface User {
  id: number
  username: string
  display_name: string
  roles: UserRole[]
  is_active: boolean
}

// 인증 세션 컨텍스트에 사용되는 User 부분 타입
export type AuthUser = Pick<User, 'id' | 'username' | 'display_name' | 'roles'>
