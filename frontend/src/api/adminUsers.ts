import client from './client'
import type { AdminUser, AdminUserCreate, AdminUserUpdate, AdminPasswordReset } from '@/types/adminUser'

export async function fetchAdminUsers(includeInactive = false): Promise<AdminUser[]> {
  const { data } = await client.get<AdminUser[]>('/admin/users', {
    params: { include_inactive: includeInactive },
  })
  return data
}

export async function createAdminUser(payload: AdminUserCreate): Promise<AdminUser> {
  const { data } = await client.post<AdminUser>('/admin/users', payload)
  return data
}

export async function updateAdminUser(id: number, payload: AdminUserUpdate): Promise<AdminUser> {
  const { data } = await client.put<AdminUser>(`/admin/users/${id}`, payload)
  return data
}

export async function deactivateAdminUser(id: number): Promise<AdminUser> {
  const { data } = await client.put<AdminUser>(`/admin/users/${id}/deactivate`)
  return data
}

export async function resetAdminPassword(
  id: number,
  payload: AdminPasswordReset
): Promise<{ message: string }> {
  const { data } = await client.put<{ message: string }>(
    `/admin/users/${id}/password`,
    payload
  )
  return data
}
