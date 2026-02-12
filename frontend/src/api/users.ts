import client from './client'
import type { User } from '@/types'

export async function fetchUsers(params?: {
  role?: string
}): Promise<User[]> {
  const { data } = await client.get<User[]>('/users', { params })
  return data
}
