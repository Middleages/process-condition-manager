// ========== User ==========
export interface User {
  id: number
  username: string
  display_name: string
  role: 'editor' | 'reviewer' | 'admin'
  is_active: boolean
}

// Subset of User used for authenticated session context.
// role is narrowed to the literal union from User, replacing the previous `string` type.
export type AuthUser = Pick<User, 'id' | 'username' | 'display_name' | 'role'>
