import { useQuery } from '@tanstack/react-query'
import { fetchLines } from '@/api/lines'

export function useLines() {
  return useQuery({
    queryKey: ['lines'],
    queryFn: fetchLines,
  })
}
