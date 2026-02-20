export interface AdminUser {
  id: number
  username: string
  display_name: string
  email: string | null
  role: 'editor' | 'reviewer' | 'admin'
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AdminUserCreate {
  username: string
  display_name: string
  email?: string | null
  role: string
  password: string
}

export interface AdminUserUpdate {
  display_name?: string
  email?: string | null
  role?: string
  is_active?: boolean
}

export interface AdminPasswordReset {
  new_password: string
}

export interface ColumnSelectOptions {
  id: number
  column_name: string
  display_name: string
  category_code: string | null
  data_type: string
  select_options: (string | number)[] | null
}
