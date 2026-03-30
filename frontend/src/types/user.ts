// ========== User ==========
export type UserRole = 'editor' | 'reviewer' | 'admin' | 'developer'

export interface User {
  id: number
  userid: string
  roles: UserRole[]
  is_active: boolean
  line_id: number | null
}

export type AuthUser = Pick<User, 'id' | 'userid' | 'roles' | 'line_id'>

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
