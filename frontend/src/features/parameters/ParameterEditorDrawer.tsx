import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react'
import { Link } from 'react-router-dom'

import { listChoiceSets } from '@/api/choiceSets'
import { getApiErrorMessage, getApiErrorStatus } from '@/api/client'
import {
  createParameter,
  deactivateParameter,
  getParameter,
  updateParameter,
} from '@/api/parameters'
import type {
  CategoryOut,
  ChoiceSetSummaryOut,
  ParameterOut,
  ValueType,
} from '@/api/types'
import { Badge } from '@/shared/components/Badge'
import { Button } from '@/shared/components/Button'
import { Field } from '@/shared/components/Field'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { Dialog, Drawer } from '@/shared/components/ModalSurface'
import { SearchableChoice } from '@/shared/components/SearchableChoice'
import { cn } from '@/shared/lib/cn'
import { useUnsavedChanges } from '@/shared/navigation/useUnsavedChanges'

import { choiceSetKeys } from '../choiceSets/choiceQueries'
import {
  buildParameterCreatePlan,
  buildParameterUpdatePlan,
  type ParameterFieldErrors,
  type ParameterFormState,
} from './form'
import {
  getExistingParameterDetailPresentation,
  invalidateParameterAdminQueries,
  parameterEditorSessionReducer,
  selectFreshParameterForHydration,
  startParameterEditorSession,
} from './parameterAdminState'
import { persistParameter, type PersistParameterInput } from './parameterPersistence'
import {
  authorizeParameterChoiceSet,
  deriveParameterChoiceSetPickerState,
  reconcileParameterChoiceSetAuthorization,
  type EditTarget,
} from './registryState'

const VALUE_TYPES: ValueType[] = ['text', 'number', 'choice']
const FIELD_ORDER: Array<keyof ParameterFormState> = [
  'code',
  'displayName',
  'valueType',
  'categoryId',
  'required',
  'choiceSetCode',
  'unit',
  'minValue',
  'maxValue',
  'pattern',
  'patternHint',
  'description',
]

type OpenEditTarget = Exclude<EditTarget, { kind: 'closed' }>
type ActiveChoiceSetLoader = (
  includeInactive?: boolean,
) => Promise<ChoiceSetSummaryOut[]>
type ActiveChoiceSetRefetch = (options: {
  throwOnError: true
}) => Promise<{ data?: ChoiceSetSummaryOut[]; error?: unknown }>

export interface ParameterEditorDrawerProps {
  target: OpenEditTarget
  categories: readonly CategoryOut[]
  fallbackFocusRef: RefObject<HTMLElement>
  onClose: () => void
}

type ParameterDetailLoader = (
  parameterId: number,
  signal?: AbortSignal,
) => Promise<ParameterOut>

export function parameterDetailQueryOptions(
  parameterId: number | null,
  loadParameter: ParameterDetailLoader = getParameter,
) {
  return {
    queryKey: ['parameters', 'detail', parameterId] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      loadParameter(parameterId as number, signal),
    enabled: parameterId !== null,
    refetchOnMount: 'always' as const,
    retry: false,
  }
}

export function activeParameterChoiceSetsQueryOptions(
  loadChoiceSets: ActiveChoiceSetLoader = listChoiceSets,
) {
  return queryOptions({
    queryKey: choiceSetKeys.list(false),
    queryFn: () => loadChoiceSets(false),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    retry: false,
  })
}

export async function prepareParameterChoiceSetPicker(
  refetch: ActiveChoiceSetRefetch,
): Promise<ChoiceSetSummaryOut[]> {
  const result = await refetch({ throwOnError: true })
  if (result.data === undefined) {
    throw result.error ?? new Error('활성 선택지 집합 목록을 확인할 수 없습니다.')
  }
  return result.data
}

export function shouldBlockParameterChoiceSetResource({
  isFetching,
  isPaused,
}: {
  isFetching: boolean
  isPaused: boolean
}): boolean {
  return isFetching || isPaused
}

export function shouldBlockParameterChoiceSetCreateResource({
  isCreate,
  valueType,
  resourceReady,
}: {
  isCreate: boolean
  valueType: ValueType
  resourceReady: boolean
}): boolean {
  return isCreate && valueType === 'choice' && !resourceReady
}

export function firstInvalidParameterField(
  errors: ParameterFieldErrors,
): keyof ParameterFormState | undefined {
  return FIELD_ORDER.find((field) => errors[field] !== undefined)
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
  const choiceSetsQuery = useQuery({
    ...activeParameterChoiceSetsQueryOptions(),
    enabled: target.kind === 'new',
  })
  const [session, dispatch] = useReducer(
    parameterEditorSessionReducer,
    target,
    startParameterEditorSession,
  )
  const [showValidation, setShowValidation] = useState(false)
  const [touched, setTouched] = useState<Set<keyof ParameterFormState>>(() => new Set())
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [completionReady, setCompletionReady] = useState(false)
  const [authorizedChoiceSetCode, setAuthorizedChoiceSetCode] = useState<string | null>(null)

  const freshParameter = selectFreshParameterForHydration(target, detailQuery)

  useEffect(() => {
    if (freshParameter) dispatch({ type: 'hydrate', parameter: freshParameter })
  }, [freshParameter])

  const choiceListStatus = choiceSetsQuery.isPending
    ? 'loading'
    : choiceSetsQuery.isError
      ? 'error'
      : 'success'
  const choiceSetResourceBlocked = shouldBlockParameterChoiceSetResource(choiceSetsQuery)
  const choiceSetPicker = deriveParameterChoiceSetPickerState({
    rawCode: session.form.choiceSetCode,
    authorizedCode: authorizedChoiceSetCode,
    sets: choiceSetsQuery.data ?? [],
    status: choiceListStatus,
    refreshing: choiceSetResourceBlocked,
  })

  useEffect(() => {
    if (target.kind !== 'new' || !choiceSetsQuery.isSuccess || choiceSetResourceBlocked) return
    setAuthorizedChoiceSetCode((current) =>
      reconcileParameterChoiceSetAuthorization(
        current,
        session.form.choiceSetCode,
        choiceSetsQuery.data,
      ),
    )
  }, [
    choiceSetsQuery.data,
    choiceSetsQuery.isSuccess,
    choiceSetResourceBlocked,
    session.form.choiceSetCode,
    target.kind,
  ])

  const createPlan = useMemo(
    () =>
      target.kind === 'new'
        ? buildParameterCreatePlan(session.form, {
            activeChoiceSetCodes: choiceSetPicker.activeCodes,
            authorizedChoiceSetCode,
          })
        : null,
    [
      authorizedChoiceSetCode,
      choiceSetPicker.activeCodes,
      session.form,
      target.kind,
    ],
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
  const dirty = currentPlan?.dirty ?? false
  const createChoiceSetResourceBlocked = shouldBlockParameterChoiceSetCreateResource({
    isCreate: target.kind === 'new',
    valueType: session.form.valueType,
    resourceReady: choiceSetPicker.resourceReady,
  })

  const saveMutation = useMutation<ParameterOut, unknown, PersistParameterInput>({
    mutationFn: (input) =>
      persistParameter(input, {
        create: createParameter,
        update: updateParameter,
      }),
    onSuccess: async (parameter) => {
      queryClient.setQueryData(['parameters', 'detail', parameter.id], parameter)
      await invalidateParameterAdminQueries(queryClient)
      setCompletionReady(true)
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateParameter((session.original as ParameterOut).id),
    onSuccess: async (parameter) => {
      queryClient.setQueryData(['parameters', 'detail', parameter.id], parameter)
      await invalidateParameterAdminQueries(queryClient)
      setDeactivateOpen(false)
      setCompletionReady(true)
    },
  })

  const pending = saveMutation.isPending || deactivateMutation.isPending

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

  function selectChoiceSet(code: string | null) {
    const normalized = authorizeParameterChoiceSet(code ?? '')
    updateField('choiceSetCode', normalized ?? '')
    setAuthorizedChoiceSetCode(normalized)
    markTouched('choiceSetCode')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || currentPlan === null || !currentPlan.dirty) return

    if (
      Object.keys(fieldErrors).length > 0 ||
      createChoiceSetResourceBlocked
    ) {
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
  const invalidPlan =
    currentPlan !== null && Object.keys(fieldErrors).length > 0

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
                aria-disabled={invalidPlan ? true : undefined}
                className={cn(
                  invalidPlan && 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
                )}
                loading={saveMutation.isPending}
                disabled={
                  !dirty ||
                  deactivateMutation.isPending ||
                  createChoiceSetResourceBlocked
                }
              >
                저장
              </Button>
            </>
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
          saveError={saveMutation.error}
          fieldsLocked={pending}
          choiceSets={choiceSetsQuery.data ?? []}
          choiceSetsLoading={choiceSetsQuery.isPending || choiceSetResourceBlocked}
          choiceSetsError={
            choiceSetsQuery.isError ? getApiErrorMessage(choiceSetsQuery.error) : null
          }
          choiceSetResourceReady={choiceSetPicker.resourceReady}
          selectedChoiceSetActive={choiceSetPicker.selectedActive}
          onPrepareChoiceSet={async () => {
            await prepareParameterChoiceSetPicker((options) =>
              choiceSetsQuery.refetch(options),
            )
          }}
          onRetryDetail={() => detailQuery.refetch()}
          onSubmit={submit}
          onFieldChange={updateField}
          onFieldBlur={markTouched}
          onChoiceSetChange={selectChoiceSet}
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
  saveError: unknown
  fieldsLocked: boolean
  choiceSets: readonly ChoiceSetSummaryOut[]
  choiceSetsLoading: boolean
  choiceSetsError: string | null
  choiceSetResourceReady: boolean
  selectedChoiceSetActive: boolean
  onPrepareChoiceSet: () => Promise<void>
  onRetryDetail: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onFieldChange: <K extends keyof ParameterFormState>(
    field: K,
    value: ParameterFormState[K],
  ) => void
  onFieldBlur: (field: keyof ParameterFormState) => void
  onChoiceSetChange: (code: string | null) => void
}

function EditorBody({
  target,
  categories,
  session,
  detailQuery,
  fieldErrors,
  showValidation,
  touched,
  saveError,
  fieldsLocked,
  choiceSets,
  choiceSetsLoading,
  choiceSetsError,
  choiceSetResourceReady,
  selectedChoiceSetActive,
  onPrepareChoiceSet,
  onRetryDetail,
  onSubmit,
  onFieldChange,
  onFieldBlur,
  onChoiceSetChange,
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

      {detailPresentation?.kind === 'editor' && detailPresentation.refetchError ? (
        <ParameterDetailRefetchError error={detailQuery.error} onRetry={onRetryDetail} />
      ) : null}
      {saveError ? <InlineAlert tone="error">{getApiErrorMessage(saveError)}</InlineAlert> : null}

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
        <label
          className="flex items-center gap-2 text-sm font-semibold text-ink-950"
          htmlFor="parameter-required"
        >
          <input
            id="parameter-required"
            data-parameter-field="required"
            type="checkbox"
            checked={form.required}
            onBlur={() => onFieldBlur('required')}
            onChange={(event) => onFieldChange('required', event.target.checked)}
          />
          필수 입력
        </label>
      </fieldset>

      {form.valueType === 'choice' ? (
        <section className="grid gap-3 border-t border-border-subtle pt-5" aria-label="선택지 집합 연결">
          {target.kind === 'new' ? (
            <ParameterChoiceSetPicker
              rawCode={form.choiceSetCode}
              sets={choiceSets}
              loading={choiceSetsLoading}
              error={choiceSetsError}
              validationError={errorFor('choiceSetCode') ?? null}
              resourceReady={choiceSetResourceReady}
              sourceActive={selectedChoiceSetActive}
              disabled={fieldsLocked}
              onOpen={onPrepareChoiceSet}
              onChange={onChoiceSetChange}
            />
          ) : (
            <ExistingParameterChoiceSetBinding choiceSet={session.original?.choice_set ?? null} />
          )}
        </section>
      ) : null}

      <fieldset className="grid gap-4 border-t border-border-subtle pt-5" disabled={fieldsLocked}>
        <legend className="mb-3 text-sm font-bold text-ink-950">검증과 설명</legend>
        {form.valueType === 'number' ? (
          <>
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
          </>
        ) : null}
        {form.valueType === 'text' ? (
          <>
            <Field inputId="parameter-pattern" label="패턴 (관리자용)" error={errorFor('pattern')}>
              <input
                className="input font-mono"
                data-parameter-field="pattern"
                value={form.pattern}
                onBlur={() => onFieldBlur('pattern')}
                onChange={(event) => onFieldChange('pattern', event.target.value)}
              />
            </Field>
            <Field
              inputId="parameter-pattern-hint"
              label="사용자 형식 안내"
              error={errorFor('patternHint')}
            >
              <input
                className="input"
                data-parameter-field="patternHint"
                value={form.patternHint}
                onBlur={() => onFieldBlur('patternHint')}
                onChange={(event) => onFieldChange('patternHint', event.target.value)}
              />
            </Field>
          </>
        ) : null}
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
    </form>
  )
}

export interface ParameterChoiceSetPickerProps {
  rawCode: string
  sets: readonly ChoiceSetSummaryOut[]
  loading: boolean
  error: string | null
  validationError?: string | null
  resourceReady: boolean
  sourceActive: boolean
  disabled: boolean
  onOpen: () => Promise<void>
  onChange: (code: string | null) => void
}

export function deriveParameterChoiceSetComboboxAvailability({
  rawCode,
  selectedActive,
  resourceReady,
}: {
  rawCode: string
  selectedActive: boolean
  resourceReady: boolean
}) {
  return {
    // The active-only registry is the source. A stale selected value must not disable every
    // alternative row; its inactivity is represented only by sourceInactive below.
    sourceActive: true as const,
    sourceInactive: rawCode.trim() !== '' && !selectedActive,
    selectionReady: resourceReady,
  }
}

export function ParameterChoiceSetPicker({
  rawCode,
  sets,
  loading,
  error,
  validationError = null,
  resourceReady,
  sourceActive,
  disabled,
  onOpen,
  onChange,
}: ParameterChoiceSetPickerProps) {
  const activeSets = sets.filter((set) => set.is_active)
  const options = activeSets.map((set) => ({
    code: set.code,
    label: set.display_name,
    is_active: set.is_active,
  }))
  const hasRawDraft = rawCode.trim() !== ''
  const availability = deriveParameterChoiceSetComboboxAvailability({
    rawCode,
    selectedActive: sourceActive,
    resourceReady,
  })

  return (
    <div className="grid gap-3" data-parameter-field-container="choiceSetCode">
      <SearchableChoice
        id="parameter-choice-set"
        label="선택지 집합"
        value={hasRawDraft ? rawCode : null}
        options={options}
        loading={loading}
        error={error}
        validationError={validationError}
        disabled={disabled}
        sourceActive={availability.sourceActive}
        sourceInactive={availability.sourceInactive}
        selectionReady={availability.selectionReady}
        required
        allowClear
        onOpen={onOpen}
        onChange={onChange}
      />
      {!loading && error === null && activeSets.length === 0 ? (
        <InlineAlert tone="info">
          <p>활성 선택지 집합이 없습니다.</p>
          <Link
            className="mt-2 inline-flex font-semibold text-brand-700 underline underline-offset-2"
            to="/parameters/choice-sets"
          >
            선택지 집합 관리로 이동
          </Link>
        </InlineAlert>
      ) : null}
      {hasRawDraft && !sourceActive && error === null ? (
        <InlineAlert tone="warning">
          선택했던 집합이 최신 활성 목록에 없습니다. 초안 code는 보존되었지만
          생성하려면 활성 집합을 다시 선택해 주세요.
        </InlineAlert>
      ) : null}
    </div>
  )
}

export function ExistingParameterChoiceSetBinding({
  choiceSet,
}: {
  choiceSet: ChoiceSetSummaryOut | null
}) {
  if (choiceSet === null) {
    return (
      <InlineAlert tone="error">
        Choice 파라미터에 연결된 선택지 집합 정보가 없습니다.
      </InlineAlert>
    )
  }

  return (
    <div className="grid gap-2">
      <label className="text-sm font-semibold text-ink-950" htmlFor="parameter-choice-set-readonly">
        선택지 집합
      </label>
      <input
        id="parameter-choice-set-readonly"
        className="input font-mono"
        readOnly
        value={`${choiceSet.code} · ${choiceSet.display_name}`}
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {!choiceSet.is_active ? <Badge tone="warning">사용 중지됨</Badge> : null}
        <Link
          className="font-semibold text-brand-700 underline underline-offset-2"
          to={`/parameters/choice-sets/${encodeURIComponent(choiceSet.code)}`}
        >
          선택지 집합 관리에서 열기
        </Link>
      </div>
      <p className="text-xs text-muted">
        이 연결은 Phase 2.6에서 생성 후 변경할 수 없습니다. 표시명과 선택지는 집합 관리에서
        유지하세요.
      </p>
    </div>
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
  const first = firstInvalidParameterField(errors)
  if (!first) return

  window.requestAnimationFrame(() => {
    if (first === 'choiceSetCode') {
      document.getElementById('parameter-choice-set')?.focus()
      return
    }
    document.querySelector<HTMLElement>(`[data-parameter-field="${first}"]`)?.focus()
  })
}
