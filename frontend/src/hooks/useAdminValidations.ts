import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchAdminColumns,
  replaceValidations,
  bulkUploadValidations,
} from '@/api/admin'
import type { ValidationRuleCreate } from '@/types'
import { useToastStore } from '@/stores/useToastStore'

export const adminColumnKeys = {
  all: ['admin', 'columns'] as const,
  list: (categoryCode?: string) => [...adminColumnKeys.all, 'list', categoryCode] as const,
}

export function useAdminColumns(categoryCode?: string) {
  return useQuery({
    queryKey: adminColumnKeys.list(categoryCode),
    queryFn: () => fetchAdminColumns({ category_code: categoryCode }),
    staleTime: 5 * 60 * 1000,
  })
}

export function useReplaceValidations() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({
      columnId,
      validations,
    }: {
      columnId: number
      validations: ValidationRuleCreate[]
    }) => replaceValidations(columnId, validations),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminColumnKeys.all })
      addToast('검증 규칙이 저장되었습니다.', 'success')
    },
    onError: () => {
      addToast('검증 규칙 저장에 실패했습니다.', 'error')
    },
  })
}

export function useBulkUploadValidations() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (file: File) => bulkUploadValidations(file),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: adminColumnKeys.all })
      addToast(
        `검증 규칙 일괄 업로드 완료 (컬럼: ${data.columns_updated}, 규칙: ${data.rules_created})`,
        'success'
      )
    },
    onError: () => {
      addToast('검증 규칙 일괄 업로드에 실패했습니다.', 'error')
    },
  })
}
