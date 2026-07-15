import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import { createCategory } from '@/api/categories'
import { getApiErrorMessage } from '@/api/client'
import { Button } from '@/shared/components/Button'
import { Field } from '@/shared/components/Field'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { Dialog } from '@/shared/components/ModalSurface'

export interface CategoryCreateDialogProps {
  open: boolean
  onClose: () => void
}

export function CategoryCreateDialog({ open, onClose }: CategoryCreateDialogProps) {
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [displayName, setDisplayName] = useState('')

  const createMutation = useMutation({
    mutationFn: () =>
      createCategory({
        code: code.trim(),
        display_name: displayName.trim(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['parameter-categories'] })
      setCode('')
      setDisplayName('')
      onClose()
    },
  })

  function resetAndClose() {
    if (createMutation.isPending) return
    setCode('')
    setDisplayName('')
    createMutation.reset()
    onClose()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (code.trim() === '' || displayName.trim() === '' || createMutation.isPending) return
    createMutation.mutate()
  }

  return (
    <Dialog
      open={open}
      title="카테고리 추가"
      onRequestClose={resetAndClose}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            disabled={createMutation.isPending}
            onClick={resetAndClose}
          >
            취소
          </Button>
          <Button
            form="parameter-category-create-form"
            type="submit"
            loading={createMutation.isPending}
            disabled={code.trim() === '' || displayName.trim() === ''}
          >
            카테고리 만들기
          </Button>
        </>
      }
    >
      <form id="parameter-category-create-form" className="grid gap-4" onSubmit={submit}>
        <p className="text-sm text-muted">
          파라미터를 분류할 새 카테고리를 만듭니다. 이 화면에서는 생성만 지원합니다.
        </p>
        <Field inputId="parameter-category-code" label="카테고리 코드">
          <input
            className="input font-mono"
            autoComplete="off"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Field inputId="parameter-category-display-name" label="표시명">
          <input
            className="input"
            autoComplete="off"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>

        {createMutation.isError ? (
          <InlineAlert tone="error">{getApiErrorMessage(createMutation.error)}</InlineAlert>
        ) : null}
      </form>
    </Dialog>
  )
}
