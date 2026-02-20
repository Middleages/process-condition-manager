import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchSelectColumns, updateSelectOptions } from '@/api/adminColumns'

export const adminColumnKeys = {
  selectOptions: () => ['adminSelectColumns'] as const,
}

export function useSelectColumns() {
  return useQuery({
    queryKey: adminColumnKeys.selectOptions(),
    queryFn: fetchSelectColumns,
  })
}

export function useUpdateSelectOptions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ columnId, selectOptions }: { columnId: number; selectOptions: string[] }) =>
      updateSelectOptions(columnId, selectOptions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminColumnKeys.selectOptions() })
      queryClient.invalidateQueries({ queryKey: ['columns'] })
    },
  })
}
