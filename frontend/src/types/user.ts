// ========== User ==========
export interface User {
  id: number
  username: string
  display_name: string
  role: 'editor' | 'reviewer' | 'admin'
  is_active: boolean
}
