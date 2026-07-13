import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react'

import { getApiErrorMessage, getApiErrorStatus } from '@/api/client'
import {
  createParameter,
  deactivateParameter,
  getParameter,
  replaceParameterOptions,
  updateParameter,
} from '@/api/parameters'
import type { CategoryOut, ParameterOut, ValueType } from '@/api/types'
import { Badge } from '@/shared/components/Badge'
import { Button } from '@/shared/components/Button'
import { Field } from '@/shared/components/Field'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { Dialog, Drawer } from '@/shared/components/ModalSurface'
import { cn } from '@/shared/lib/cn'
import { useUnsavedChanges } from '@/shared/navigation/useUnsavedChanges'

import {
  buildParameterCreatePlan,
  buildParameterUpdatePlan,
  type ParameterFieldErrors,
  type ParameterFormState,
} from './form'
import {
  getExistingParameterDetailPresentation,
  parameterEditorSessionReducer,
  selectFreshParameterForHydration,
  startParameterEditorSession,
} from './parameterAdminState'
import {
  persistParameter,
  retryParameterOptions,
  type PersistParameterInput,
  type PersistResult,
} from './parameterPersistence'
import type { EditTarget } from './registryState'

const VALUE_TYPES: ValueType[] = ['text', 'number', 'choice', 'date', 'boolean']
const FIELD_ORDER: Array<keyof ParameterFormState> = [
  'code',
  'displayName',
  'valueType',
  'categoryId',
  'unit',
  'minValue',
  'maxValue',
  'description',
  'optionsText',
]
const UNSUPPORTED_CLEAR_MESSAGE =
  '현재 API에서는 설명·단위·카테고리·최소/최대값을 비울 수 없습니다. 기존 값을 복원하거나 해당 변경을 취소한 뒤 저장해 주세요.'

type OpenEditTarget = Exclude<EditTarget, { kind: 'closed' }>

export interface ParameterEditorDrawerProps {
  target: OpenEditTarget
  categories: readonly CategoryOut[]
  fallbackFocusRef: RefObject<HTMLElement>
  onClose: () => void
}

type ParameterDetailLoader = (parameterId: number) => Promise<ParameterOut>

export function parameterDetailQueryOptions(
  parameterId: number | null,
  loadParameter: ParameterDetailLoader = getParameter,
) {
  return {
    queryKey: ['parameters', 'detail', parameterId] as const,
    queryFn: () => loadParameter(parameterId as number),
    enabled: parameterId !== null,
    refetchOnMount: 'always' as const,
    retry: false,
  }
}

export function ParameterEditorDrawer({
  target,
  categories,
  fallbackFocusRef,
  onClose,
}: ParameterEditorDrawerProps) {
  const queryClient = useQueryClient()
  const parameterId = target.kind === 'existing' ? target.id : null
  const detailQuery = useQuery(parameterDetailQueryOptions(parameterId))
  const [session, dispatch] = useReducer(
    parameterEditorSessionReducer,
    target,
    startParameterEditorSession,
  )
  const [showValidation, setShowValidation] = useState(false)
  const [touched, setTouched] = useState<Set<keyof ParameterFormState>>(() => new Set())
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [completionReady, setCompletionReady] = useState(false)

  const freshParameter = selectFreshParameterForHydration(target, detailQuery)

  useEffect(() => {
    if (freshParameter) dispatch({ type: 'hydrate', parameter: freshParameter })
  }, [freshParameter])

  const createPlan = useMemo(
    () => (target.kind === 'new' ? buildParameterCreatePlan(session.form) : null),
    [session.form, target.kind],
  )
  const updatePlan = useMemo(
    () =>
      target.kind === 'existing' && session.original
        ? buildParameterUpdatePlan(session.original, session.form)
        : null,
    [session.form, session.original, target.kind],
  )
  const currentPlan = createPlan ?? updatePlan
  const fieldErrors = currentPlan?.fieldErrors ?? {}
  const unsupportedClears = updatePlan?.unsupportedClears ?? []
  const dirty = currentPlan?.dirty ?? false

  const saveMutation = useMutation<PersistResult, unknown, PersistParameterInput>({
    mutationFn: (input) =>
      persistParameter(input, {
        create: createParameter,
        update: updateParameter,
        replaceOptions: replaceParameterOptions,
      }),
    onSuccess: async (result) => {
      if (result.kind === 'options-partial-failure') {
        dispatch({
          type: 'options-partial-failure',
          baseParameter: result.baseParameter,
          optionsDraft: result.optionsDraft,
          error: result.error,
        })
        queryClient.setQueryData(
          ['parameters', 'detail', result.baseParameter.id],
          result.baseParameter,
        )
        await queryClient.invalidateQueries({ queryKey: ['parameters'] })
        return
      }

      queryClient.setQueryData(
        ['parameters', 'detail', result.parameter.id],
        result.parameter,
      )
      await queryClient.invalidateQueries({ queryKey: ['parameters'] })
      setCompletionReady(true)
    },
  })

  const retryMutation = useMutation({
    mutationFn: () =>
      retryParameterOptions(
        (session.original as ParameterOut).id,
        session.optionsRetry?.draft ?? [],
        {
          create: createParameter,
          update: updateParameter,
          replaceOptions: replaceParameterOptions,
        },
      ),
    onSuccess: async (parameter) => {
      queryClient.setQueryData(['parameters', 'detail', parameter.id], parameter)
      await queryClient.invalidateQueries({ queryKey: ['parameters'] })
      setCompletionReady(true)
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateParameter((session.original as ParameterOut).id),
    onSuccess: async (parameter) => {
      queryClient.setQueryData(['parameters', 'detail', parameter.id], parameter)
      await queryClient.invalidateQueries({ queryKey: ['parameters'] })
      setDeactivateOpen(false)
      setCompletionReady(true)
    },
  })

  const pending =
    saveMutation.isPending || retryMutation.isPending || deactivateMutation.isPending

  useUnsavedChanges({
    when: dirty && !completionReady,
    freezeWhen: pending,
    message: '저장하지 않은 파라미터 변경이 있습니다. 변경을 버리고 이동할까요?',
  })

  useEffect(() => {
    if (completionReady && !pending) onClose()
  }, [completionReady, onClose, pending])

  function updateField<K extends keyof ParameterFormState>(
    field: K,
    value: ParameterFormState[K],
  ) {
    dispatch({ type: 'change-field', field, value })
  }

  function markTouched(field: keyof ParameterFormState) {
    setTouched((current) => {
      if (current.has(field)) return current
      const next = new Set(current)
      next.add(field)
      return next
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || session.optionsRetry || currentPlan === null || !currentPlan.dirty) return

    if (Object.keys(fieldErrors).length > 0 || unsupportedClears.length > 0) {
      setShowValidation(true)
      focusFirstInvalidField(fieldErrors)
      return
    }

    if (target.kind === 'new' && createPlan) {
      saveMutation.mutate({ mode: 'create', plan: createPlan })
    } else if (target.kind === 'existing' && updatePlan && session.original) {
      saveMutation.mutate({
        mode: 'edit',
        parameterId: session.original.id,
        valueType: session.original.value_type,
        plan: updatePlan,
      })
    }
  }

  function requestClose() {
    if (!pending) onClose()
  }

  const title =
    target.kind === 'new'
      ? '새 파라미터'
      : target.kind === 'existing'
        ? '파라미터 수정'
        : '파라미터를 열 수 없습니다'

  return (
    <>
      <Drawer
        open
        title={title}
        fallbackFocusRef={fallbackFocusRef}
        returnFocusRef={target.kind === 'new' ? fallbackFocusRef : undefined}
        onRequestClose={requestClose}
        footer={
          session.hydrated && (target.kind === 'new' || session.original) ? (
            session.optionsRetry ? (
              <>
                <Button type="button" variant="ghost" disabled={pending} onClick={requestClose}>
                  닫기
                </Button>
                <Button
                  type="button"
                  loading={retryMutation.isPending}
                  disabled={saveMutation.isPending || deactivateMutation.isPending}
                  onClick={() => retryMutation.mutate()}
                >
                  선택지만 다시 저장
                </Button>
              </>
            ) : (
              <>
                {session.original?.is_active ? (
                  <Button
                    className="mr-auto"
                    type="button"
                    variant="danger"
                    disabled={pending}
                    onClick={() => setDeactivateOpen(true)}
                  >
                    비활성화
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" disabled={pending} onClick={requestClose}>
                  취소
                </Button>
                <Button
                  form="parameter-editor-form"
                  type="submit"
                  aria-disabled={
                    currentPlan &&
                    (Object.keys(fieldErrors).length > 0 || unsupportedClears.length > 0)
                      ? true
                      : undefined
                  }
                  className={cn(
                    currentPlan &&
                      (Object.keys(fieldErrors).length > 0 || unsupportedClears.length > 0) &&
                      'aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
                  )}
                  loading={saveMutation.isPending}
                  disabled={!dirty || retryMutation.isPending || deactivateMutation.isPending}
                >
                  저장
                </Button>
              </>
            )
          ) : undefined
        }
      >
        <EditorBody
          target={target}
          categories={categories}
          session={session}
          detailQuery={detailQuery}
          fieldErrors={fieldErrors}
          showValidation={showValidation}
          touched={touched}
          partialError={session.optionsRetry?.error ?? null}
          saveError={saveMutation.error}
          retryError={retryMutation.error}
          fieldsLocked={session.optionsRetry !== null || pending}
          unsupportedClears={unsupportedClears.length > 0}
          onRetryDetail={() => detailQuery.refetch()}
          onSubmit={submit}
          onFieldChange={updateField}
          onFieldBlur={markTouched}
        />
      </Drawer>

      {deactivateOpen && session.original ? (
        <Dialog
          open
          title="파라미터 비활성화"
          onRequestClose={() => {
            if (!deactivateMutation.isPending) setDeactivateOpen(false)
          }}
          footer={
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={deactivateMutation.isPending}
                onClick={() => setDeactivateOpen(false)}
              >
                취소
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={deactivateMutation.isPending}
                onClick={() => deactivateMutation.mutate()}
              >
                비활성화 확인
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-950">
            <strong className="font-mono">{session.original.code}</strong> 파라미터를
            비활성화합니다. 기본 목록에서는 더 이상 표시되지 않습니다.
          </p>
          {deactivateMutation.isError ? (
            <InlineAlert className="mt-4" tone="error">
              {getApiErrorMessage(deactivateMutation.error)}
            </InlineAlert>
          ) : null}
        </Dialog>
      ) : null}
    </>
  )
}

interface EditorBodyProps {
  target: OpenEditTarget
  categories: readonly CategoryOut[]
  session: ReturnType<typeof startParameterEditorSession>
  detailQuery: ReturnType<typeof useQuery<ParameterOut>>
  fieldErrors: ParameterFieldErrors
  showValidation: boolean
  touched: ReadonlySet<keyof ParameterFormState>
  partialError: unknown
  saveError: unknown
  retryError: unknown
  fieldsLocked: boolean
  unsupportedClears: boolean
  onRetryDetail: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onFieldChange: <K extends keyof ParameterFormState>(
    field: K,
    value: ParameterFormState[K],
  ) => void
  onFieldBlur: (field: keyof ParameterFormState) => void
}

function EditorBody({
  target,
  categories,
  session,
  detailQuery,
  fieldErrors,
  showValidation,
  touched,
  partialError,
  saveError,
  retryError,
  fieldsLocked,
  unsupportedClears,
  onRetryDetail,
  onSubmit,
  onFieldChange,
  onFieldBlur,
}: EditorBodyProps) {
  if (target.kind === 'invalid') {
    return (
      <InlineAlert tone="error">
        잘못된 편집 주소입니다. 목록 필터는 그대로 유지되었습니다.
      </InlineAlert>
    )
  }

  const detailPresentation =
    target.kind === 'existing'
      ? getExistingParameterDetailPresentation(session, detailQuery.isError)
      : null

  if (detailPresentation?.kind === 'fatal-error') {
    return <ParameterDetailError error={detailQuery.error} onRetry={onRetryDetail} />
  }

  if (detailPresentation?.kind === 'loading') {
    return <InlineAlert tone="info">최신 파라미터 정보를 불러오는 중입니다.</InlineAlert>
  }

  const form = session.form
  const activeCategories = categories.filter(
    (category) => category.is_active || category.id === session.original?.category_id,
  )
  const errorFor = (field: keyof ParameterFormState) =>
    showValidation || touched.has(field) ? fieldErrors[field] : undefined

  return (
    <form id="parameter-editor-form" className="space-y-5" onSubmit={onSubmit}>
      {session.original ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-canvas px-3 py-2">
          <span className="min-w-0 truncate font-mono text-sm font-semibold text-ink-950">
            {session.original.code}
          </span>
          {session.original.is_active ? (
            <Badge tone="neutral">활성</Badge>
          ) : (
            <Badge tone="warning">비활성 파라미터</Badge>
          )}
        </div>
      ) : null}

      {unsupportedClears ? <InlineAlert tone="warning">{UNSUPPORTED_CLEAR_MESSAGE}</InlineAlert> : null}
      {detailPresentation?.kind === 'editor' && detailPresentation.refetchError ? (
        <ParameterDetailRefetchError error={detailQuery.error} onRetry={onRetryDetail} />
      ) : null}
      {session.optionsRetry ? (
        <InlineAlert tone="warning">
          <p>기본 정보는 저장됐지만 선택지는 저장되지 않았습니다.</p>
          <p className="mt-1 font-normal">
            선택지 초안을 유지했습니다. 선택지만 다시 저장할 수 있습니다.
          </p>
          {partialError ? (
            <p className="mt-2 text-xs font-normal">{getApiErrorMessage(partialError)}</p>
          ) : null}
        </InlineAlert>
      ) : null}
      {saveError ? <InlineAlert tone="error">{getApiErrorMessage(saveError)}</InlineAlert> : null}
      {retryError ? <InlineAlert tone="error">{getApiErrorMessage(retryError)}</InlineAlert> : null}

      <fieldset className="grid gap-4" disabled={fieldsLocked}>
        <legend className="mb-3 text-sm font-bold text-ink-950">기본 정보</legend>
        <Field inputId="parameter-code" label="Code" error={errorFor('code')}>
          <input
            className="input font-mono"
            data-parameter-field="code"
            readOnly={target.kind === 'existing'}
            value={form.code}
            onBlur={() => onFieldBlur('code')}
            onChange={(event) => onFieldChange('code', event.target.value)}
          />
        </Field>
        <Field inputId="parameter-display-name" label="표시명" error={errorFor('displayName')}>
          <input
            className="input"
            data-parameter-field="displayName"
            value={form.displayName}
            onBlur={() => onFieldBlur('displayName')}
            onChange={(event) => onFieldChange('displayName', event.target.value)}
          />
        </Field>
        <Field inputId="parameter-value-type" label="타입" error={errorFor('valueType')}>
          {target.kind === 'existing' ? (
            <input
              className="input"
              data-parameter-field="valueType"
              readOnly
              value={form.valueType}
            />
          ) : (
            <select
              className="input"
              data-parameter-field="valueType"
              value={form.valueType}
              onBlur={() => onFieldBlur('valueType')}
              onChange={(event) => onFieldChange('valueType', event.target.value as ValueType)}
            >
              {VALUE_TYPES.map((valueType) => (
                <option key={valueType} value={valueType}>
                  {valueType}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field inputId="parameter-category" label="카테고리" error={errorFor('categoryId')}>
          <select
            className="input"
            data-parameter-field="categoryId"
            value={form.categoryId}
            onBlur={() => onFieldBlur('categoryId')}
            onChange={(event) => onFieldChange('categoryId', event.target.value)}
          >
            <option value="">없음</option>
            {activeCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.display_name}
                {category.is_active ? '' : ' (비활성)'}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 border-t border-border-subtle pt-5" disabled={fieldsLocked}>
        <legend className="mb-3 text-sm font-bold text-ink-950">범위와 설명</legend>
        <Field inputId="parameter-unit" label="단위" error={errorFor('unit')}>
          <input
            className="input"
            data-parameter-field="unit"
            value={form.unit}
            onBlur={() => onFieldBlur('unit')}
            onChange={(event) => onFieldChange('unit', event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field inputId="parameter-min-value" label="최소값" error={errorFor('minValue')}>
            <input
              className="input"
              data-parameter-field="minValue"
              inputMode="decimal"
              value={form.minValue}
              onBlur={() => onFieldBlur('minValue')}
              onChange={(event) => onFieldChange('minValue', event.target.value)}
            />
          </Field>
          <Field inputId="parameter-max-value" label="최대값" error={errorFor('maxValue')}>
            <input
              className="input"
              data-parameter-field="maxValue"
              inputMode="decimal"
              value={form.maxValue}
              onBlur={() => onFieldBlur('maxValue')}
              onChange={(event) => onFieldChange('maxValue', event.target.value)}
            />
          </Field>
        </div>
        <Field inputId="parameter-description" label="설명" error={errorFor('description')}>
          <textarea
            className="input h-24 resize-y py-2"
            data-parameter-field="description"
            value={form.description}
            onBlur={() => onFieldBlur('description')}
            onChange={(event) => onFieldChange('description', event.target.value)}
          />
        </Field>
      </fieldset>

      {form.valueType === 'choice' ? (
        <fieldset className="grid gap-4 border-t border-border-subtle pt-5" disabled={fieldsLocked}>
          <legend className="mb-3 text-sm font-bold text-ink-950">선택지</legend>
          <Field
            inputId="parameter-options"
            label="선택지 (쉼표로 구분)"
            help="표시 순서대로 입력하세요. 기존 선택지의 표시명은 가능한 경우 그대로 유지됩니다."
            error={errorFor('optionsText')}
          >
            <textarea
              className="input h-24 resize-y py-2 font-mono"
              data-parameter-field="optionsText"
              value={form.optionsText}
              onBlur={() => onFieldBlur('optionsText')}
              onChange={(event) => onFieldChange('optionsText', event.target.value)}
            />
          </Field>
        </fieldset>
      ) : null}
    </form>
  )
}

export function ParameterDetailError({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const notFound = getApiErrorStatus(error) === 404

  return (
    <InlineAlert className="space-y-3" tone="error">
      <p>
        {notFound
          ? '요청한 파라미터를 찾을 수 없습니다. 목록 필터는 그대로 유지되었습니다.'
          : getApiErrorMessage(error)}
      </p>
      {!notFound ? (
        <Button size="compact" type="button" variant="secondary" onClick={onRetry}>
          다시 시도
        </Button>
      ) : null}
    </InlineAlert>
  )
}

export function ParameterDetailRefetchError({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  return (
    <InlineAlert className="space-y-3" tone="error">
      <div>
        <p className="font-semibold">최신 상세 정보를 다시 불러오지 못했습니다.</p>
        <p className="mt-1 font-normal">편집 중인 초안은 그대로 유지됩니다.</p>
        <p className="mt-1 text-xs font-normal">{getApiErrorMessage(error)}</p>
      </div>
      <Button size="compact" type="button" variant="secondary" onClick={onRetry}>
        다시 시도
      </Button>
    </InlineAlert>
  )
}

function focusFirstInvalidField(errors: ParameterFieldErrors) {
  const first = FIELD_ORDER.find((field) => errors[field] !== undefined)
  if (!first) return

  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-parameter-field="${first}"]`)?.focus()
  })
}
