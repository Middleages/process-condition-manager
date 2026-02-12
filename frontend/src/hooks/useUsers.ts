import { useQuery } from '@tanstack/react-query'
import { fetchUsers } from '@/api/users'

export const userKeys = {
  all: ['users'] as const,
  list: () => [...userKeys.all, 'list'] as const,
}

export function useUsers() {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: () => fetchUsers(),
    staleTime: 5 * 60 * 1000,
  })
}
