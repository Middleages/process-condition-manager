import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchAdminUsers,
  createAdminUser,
  updateAdminUser,
  deactivateAdminUser,
  resetAdminPassword,
} from '@/api/adminUsers'
import type { AdminUserCreate, AdminUserUpdate, AdminPasswordReset } from '@/types/adminUser'

export const adminUserKeys = {
  all: ['adminUsers'] as const,
  list: (includeInactive?: boolean) =>
    [...adminUserKeys.all, { includeInactive }] as const,
}

export function useAdminUsers(includeInactive = false) {
  return useQuery({
    queryKey: adminUserKeys.list(includeInactive),
    queryFn: () => fetchAdminUsers(includeInactive),
  })
}

export function useCreateAdminUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: AdminUserCreate) => createAdminUser(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.all })
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useUpdateAdminUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: AdminUserUpdate }) =>
      updateAdminUser(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.all })
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useDeactivateAdminUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deactivateAdminUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.all })
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useResetAdminPassword() {
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: AdminPasswordReset }) =>
      resetAdminPassword(id, payload),
  })
}
