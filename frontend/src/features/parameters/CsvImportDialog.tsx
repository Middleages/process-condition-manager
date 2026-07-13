import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useReducer } from 'react'

import { getApiErrorMessage } from '@/api/client'
import { applyParameterImport, previewParameterImport } from '@/api/parameters'
import type { ImportResultOut } from '@/api/types'
import { Badge } from '@/shared/components/Badge'
import { Button } from '@/shared/components/Button'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { Dialog } from '@/shared/components/ModalSurface'

import {
  canApplyCsvImport,
  csvImportReducer,
  initialCsvImportState,
} from './parameterAdminState'

const SAMPLE =
  'code,display_name,type,category,min,max,options\nspin_speed,Spin Speed,number,sp,0,5000,\npr_type,PR Type,choice,sp,,,"pos,neg"'

export interface CsvImportDialogProps {
  open: boolean
  onClose: () => void
}

export function CsvImportDialog({ open, onClose }: CsvImportDialogProps) {
  const queryClient = useQueryClient()
  const [state, dispatch] = useReducer(csvImportReducer, initialCsvImportState)

  const previewMutation = useMutation({
    mutationFn: (submittedCsvText: string) => previewParameterImport(submittedCsvText),
    onSuccess: (result, submittedCsvText) =>
      dispatch({ type: 'preview-succeeded', submittedCsvText, result }),
  })
  const applyMutation = useMutation({
    mutationFn: (submittedCsvText: string) => applyParameterImport(submittedCsvText),
    onSuccess: async (result, submittedCsvText) => {
      dispatch({ type: 'apply-succeeded', submittedCsvText, result })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['parameters'] }),
        queryClient.invalidateQueries({ queryKey: ['parameter-categories'] }),
      ])
    },
  })
  const pending = previewMutation.isPending || applyMutation.isPending

  function close() {
    if (pending) return
    dispatch({ type: 'reset' })
    previewMutation.reset()
    applyMutation.reset()
    onClose()
  }

  return (
    <Dialog
      open={open}
      title="CSV 가져오기"
      onRequestClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={pending} onClick={close}>
            닫기
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={previewMutation.isPending}
            disabled={state.csvText.trim() === '' || applyMutation.isPending}
            onClick={() => previewMutation.mutate(state.csvText)}
          >
            미리보기 (dry-run)
          </Button>
          <Button
            type="button"
            loading={applyMutation.isPending}
            disabled={!canApplyCsvImport(state) || previewMutation.isPending}
            onClick={() => applyMutation.mutate(state.csvText)}
          >
            적용
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        code 기준으로 여러 파라미터를 만들거나 갱신합니다. 먼저 미리보기에서 신규·갱신·오류
        행을 확인하세요. 오류 행은 적용되지 않습니다.
      </p>

      <label
        className="mb-1.5 block text-sm font-semibold text-ink-950"
        htmlFor="parameter-csv-text"
      >
        CSV 내용
      </label>
      <textarea
        id="parameter-csv-text"
        className="input h-56 resize-y py-2 font-mono text-xs leading-5"
        disabled={applyMutation.isPending}
        placeholder={SAMPLE}
        value={state.csvText}
        onChange={(event) => {
          dispatch({ type: 'edit', csvText: event.target.value })
          previewMutation.reset()
          applyMutation.reset()
        }}
      />

      {previewMutation.isError ? (
        <InlineAlert className="mt-4" tone="error">
          {getApiErrorMessage(previewMutation.error)}
        </InlineAlert>
      ) : null}
      {applyMutation.isError ? (
        <InlineAlert className="mt-4" tone="error">
          {getApiErrorMessage(applyMutation.error)}
        </InlineAlert>
      ) : null}

      {state.preview ? <ImportSummary result={state.preview} applied={state.applied} /> : null}
    </Dialog>
  )
}

function ImportSummary({ result, applied }: { result: ImportResultOut; applied: boolean }) {
  const errorRows = result.rows.filter((row) => row.action === 'error')

  return (
    <section className="mt-5 space-y-3" aria-label={applied ? '적용 결과' : '미리보기 결과'}>
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="draft">{applied ? '생성됨' : '신규'} {result.created_count}</Badge>
        <Badge tone="neutral">{applied ? '갱신됨' : '갱신'} {result.updated_count}</Badge>
        <Badge tone={result.error_count > 0 ? 'error' : 'neutral'}>
          오류 {result.error_count}
        </Badge>
      </div>

      {applied ? <InlineAlert tone="success">CSV 적용이 완료되었습니다.</InlineAlert> : null}
      {errorRows.length > 0 ? (
        <InlineAlert tone="warning">
          <p className="font-semibold">다음 오류 행은 적용되지 않습니다.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 font-normal">
            {errorRows.map((row) => (
              <li key={`${row.line}-${row.code}`}>
                {row.line}행 <span className="font-mono">{row.code || '(code 없음)'}</span> —{' '}
                {row.message}
              </li>
            ))}
          </ul>
        </InlineAlert>
      ) : null}
    </section>
  )
}
