import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import type { ProjectProfilePatchIn } from '@/api/types'
import {
  useChoiceSetOptions,
  type ChoiceSetOptionsResource,
} from '@/features/choiceSets/useChoiceSetOptions'
import { Button } from '@/shared/components/Button'
import { Field } from '@/shared/components/Field'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { Drawer } from '@/shared/components/ModalSurface'
import { SearchableChoice } from '@/shared/components/SearchableChoice'
import { useUnsavedChanges } from '@/shared/navigation/useUnsavedChanges'

import {
  PROFILE_FORM_FIELDS,
  toProfilePatch,
  type ProfileChoiceAuthorization,
  type ProfileChoiceField,
  type ProfileFormField,
  type ProfileFormState,
  type ProfilePatchPlan,
} from './profileForm'
import {
  isProjectProfileCloseDisabled,
  type ProjectProfileLockState,
} from './profileLockState'
import { useProjectProfileLock } from './useProjectProfileLock'

export const PROFILE_DIRTY_CONFIRM_MESSAGE =
  '저장하지 않은 프로젝트 기본정보 변경이 있습니다. 변경을 버리고 닫을까요?'

export interface ProjectProfileDrawerChoiceResources {
  device_type_code: ChoiceSetOptionsResource
  project_category_code: ChoiceSetOptionsResource
  active_direction_code: ChoiceSetOptionsResource
  gate_direction_code: ChoiceSetOptionsResource
}

export interface ProjectProfileDrawerProps {
  projectId: number
  fallbackFocusRef: RefObject<HTMLElement>
  onClose: () => void
}

export function ProjectProfileDrawer({
  projectId,
  fallbackFocusRef,
  onClose,
}: ProjectProfileDrawerProps) {
  const session = useProjectProfileLock(projectId)
  const [showValidation, setShowValidation] = useState(false)
  const observedOpenRef = useRef(false)
  const deviceTypes = useChoiceSetOptions('device_type', {
    includeInactive: true,
    sheetFocused: false,
  })
  const projectCategories = useChoiceSetOptions('project_category', {
    includeInactive: true,
    sheetFocused: false,
  })
  const activeDirections = useChoiceSetOptions('active_direction', {
    includeInactive: true,
    sheetFocused: false,
  })
  const gateDirections = useChoiceSetOptions('gate_direction', {
    includeInactive: true,
    sheetFocused: false,
  })
  const resources = useMemo<ProjectProfileDrawerChoiceResources>(
    () => ({
      device_type_code: deviceTypes,
      project_category_code: projectCategories,
      active_direction_code: activeDirections,
      gate_direction_code: gateDirections,
    }),
    [activeDirections, deviceTypes, gateDirections, projectCategories],
  )
  const plan = buildProfileDrawerPatchPlan(session.state, resources)
  const pending = isProjectProfileCloseDisabled(session.state)

  if (session.state.phase !== 'closed') observedOpenRef.current = true

  useUnsavedChanges({
    when: plan.dirty,
    freezeWhen: pending,
    message: PROFILE_DIRTY_CONFIRM_MESSAGE,
  })

  useEffect(() => {
    if (observedOpenRef.current && session.state.phase === 'closed') onClose()
  }, [onClose, session.state.phase])

  function requestClose() {
    if (pending) return
    if (plan.dirty && !window.confirm(PROFILE_DIRTY_CONFIRM_MESSAGE)) return
    void session.close()
  }

  return (
    <ProjectProfileDrawerView
      state={session.state}
      resources={resources}
      showValidation={showValidation}
      fallbackFocusRef={fallbackFocusRef}
      onDraftChange={session.updateDraft}
      onRequestClose={requestClose}
      onRetryLoad={() => void session.retryLoad()}
      onReacquire={() => void session.reacquire()}
      onValidationFailure={() => setShowValidation(true)}
      onSave={(payload) => {
        setShowValidation(true)
        void session.save(payload)
      }}
    />
  )
}

export interface ProjectProfileDrawerViewProps {
  state: ProjectProfileLockState
  resources: ProjectProfileDrawerChoiceResources
  showValidation: boolean
  fallbackFocusRef: RefObject<HTMLElement>
  onDraftChange: (draft: ProfileFormState) => void
  onRequestClose: () => void
  onRetryLoad: () => void
  onReacquire: () => void
  onSave: (payload: ProjectProfilePatchIn) => void
  onValidationFailure?: () => void
}

export function ProjectProfileDrawerView({
  state,
  resources,
  showValidation,
  fallbackFocusRef,
  onDraftChange,
  onRequestClose,
  onRetryLoad,
  onReacquire,
  onSave,
  onValidationFailure,
}: ProjectProfileDrawerViewProps) {
  const plan = buildProfileDrawerPatchPlan(state, resources)
  const closeDisabled = isProjectProfileCloseDisabled(state)
  const formVisible = state.draft !== null && state.originalDraft !== null
  const controlsDisabled = state.phase !== 'editable'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state.phase !== 'editable' || !plan.dirty) return
    if (plan.payload === null) {
      onValidationFailure?.()
      return
    }
    onSave(plan.payload)
  }

  function updateField(field: ProfileFormField, value: string) {
    if (state.phase !== 'editable' || state.draft === null) return
    onDraftChange({ ...state.draft, [field]: value })
  }

  return (
    <Drawer
      open={state.phase !== 'closed'}
      title="프로젝트 기본정보 편집"
      fallbackFocusRef={fallbackFocusRef}
      closeDisabled={closeDisabled}
      onRequestClose={onRequestClose}
      footer={renderFooter({
        state,
        plan,
        onRequestClose,
        onRetryLoad,
        onReacquire,
      })}
    >
      <div className="space-y-4">
        {state.phase === 'acquiring' ? (
          <InlineAlert tone="info">프로젝트 편집 잠금을 확인하는 중입니다.</InlineAlert>
        ) : null}
        {state.phase === 'loading-profile' ? (
          <InlineAlert tone="info">
            잠금을 획득했습니다. 최신 프로젝트 기본정보를 불러오는 중입니다.
          </InlineAlert>
        ) : null}
        {state.phase === 'conflict' ? (
          <InlineAlert tone="warning">
            {state.holder ? `${state.holder} 님이 편집 중이라 ` : ''}
            잠금을 획득하지 못했습니다. 상세 정보는 계속 읽을 수 있습니다.
          </InlineAlert>
        ) : null}
        {state.phase === 'load-error' ? (
          <InlineAlert tone="error">
            최신 기본정보를 불러오지 못했습니다. 잠금은 유지됩니다. {state.error}
          </InlineAlert>
        ) : null}
        {state.phase === 'lock-lost' ? (
          <InlineAlert tone="warning">
            편집 잠금을 잃었습니다
            {state.holder ? ` (${state.holder} 님이 편집 중)` : ''}. 현재 값은 읽기 전용
            복구용 초안으로 유지됩니다. 최신 정보로 다시 편집하면 서버 값을 새로 불러옵니다.
          </InlineAlert>
        ) : null}
        {state.phase === 'editable' && state.error ? (
          <InlineAlert tone="error">
            저장하지 못했습니다. 잠금과 초안은 유지됩니다. {state.error}
          </InlineAlert>
        ) : null}

        {formVisible && state.draft ? (
          <form
            id="profile-editor-form"
            className="space-y-5"
            noValidate
            data-close-confirmation={plan.dirty ? PROFILE_DIRTY_CONFIRM_MESSAGE : undefined}
            onSubmit={submit}
          >
            {plan.dirty ? (
              <p className="text-xs font-medium text-warning" role="status">
                저장하지 않은 변경이 있습니다.
              </p>
            ) : null}

            <ProfileFieldGroup legend="Product">
              <TextProfileField
                field="process_name"
                label="Process Name"
                required
                state={state.draft}
                disabled={controlsDisabled}
                error={showValidation ? plan.errors.process_name : undefined}
                onChange={updateField}
              />
              <ProfileChoiceFieldControl
                field="device_type_code"
                label="Device Type"
                required
                state={state.draft}
                resource={resources.device_type_code}
                controlsDisabled={controlsDisabled}
                error={showValidation ? plan.errors.device_type_code : undefined}
                onChange={updateField}
              />
              <ProfileChoiceFieldControl
                field="project_category_code"
                label="Category"
                required
                state={state.draft}
                resource={resources.project_category_code}
                controlsDisabled={controlsDisabled}
                error={showValidation ? plan.errors.project_category_code : undefined}
                onChange={updateField}
              />
              <TextProfileField
                field="comment"
                label="Comment"
                multiline
                state={state.draft}
                disabled={controlsDisabled}
                error={showValidation ? plan.errors.comment : undefined}
                onChange={updateField}
              />
            </ProfileFieldGroup>

            <ProfileFieldGroup legend="Direction">
              <ProfileChoiceFieldControl
                field="active_direction_code"
                label="Active Direction"
                allowClear
                state={state.draft}
                resource={resources.active_direction_code}
                controlsDisabled={controlsDisabled}
                error={showValidation ? plan.errors.active_direction_code : undefined}
                onChange={updateField}
              />
              <ProfileChoiceFieldControl
                field="gate_direction_code"
                label="Gate Direction"
                allowClear
                state={state.draft}
                resource={resources.gate_direction_code}
                controlsDisabled={controlsDisabled}
                error={showValidation ? plan.errors.gate_direction_code : undefined}
                onChange={updateField}
              />
            </ProfileFieldGroup>

            <ProfileFieldGroup legend="Die/Shot">
              <TextProfileField field="gross_die" label="Gross Die" state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'gross_die')} onChange={updateField} />
              <TextProfileField field="pitch_x" label="Pitch X" decimal state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'pitch_x')} onChange={updateField} />
              <TextProfileField field="pitch_y" label="Pitch Y" decimal state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'pitch_y')} onChange={updateField} />
              <TextProfileField field="shot_x" label="Shot X" decimal state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'shot_x')} onChange={updateField} />
              <TextProfileField field="shot_y" label="Shot Y" decimal state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'shot_y')} onChange={updateField} />
              <TextProfileField field="slit_occupancy" label="Slit Occupancy" decimal state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'slit_occupancy')} onChange={updateField} />
              <TextProfileField field="lens_occupancy" label="Lens Occupancy" decimal state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'lens_occupancy')} onChange={updateField} />
              <TextProfileField field="shot_count" label="Shot Count" state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'shot_count')} onChange={updateField} />
              <TextProfileField field="full_shot" label="Full Shot" state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'full_shot')} onChange={updateField} />
            </ProfileFieldGroup>

            <ProfileFieldGroup legend="Wafer Position">
              <TextProfileField field="map_offset_x" label="Map Offset X" decimal state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'map_offset_x')} onChange={updateField} />
              <TextProfileField field="map_offset_y" label="Map Offset Y" decimal state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'map_offset_y')} onChange={updateField} />
              <TextProfileField field="scribe_lane_x" label="Scribe Lane X" decimal state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'scribe_lane_x')} onChange={updateField} />
              <TextProfileField field="scribe_lane_y" label="Scribe Lane Y" decimal state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'scribe_lane_y')} onChange={updateField} />
            </ProfileFieldGroup>

            <ProfileFieldGroup legend="Layer Summary">
              <TextProfileField field="layer_total" label="Layer Total" state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'layer_total')} onChange={updateField} />
              <TextProfileField field="euv" label="EUV" state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'euv')} onChange={updateField} />
              <TextProfileField field="imm" label="IMM" state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'imm')} onChange={updateField} />
              <TextProfileField field="arf" label="ARF" state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'arf')} onChange={updateField} />
              <TextProfileField field="krf" label="KRF" state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'krf')} onChange={updateField} />
              <TextProfileField field="iline" label="I-line" state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'iline')} onChange={updateField} />
              <TextProfileField field="soh" label="SOH" state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'soh')} onChange={updateField} />
              <TextProfileField field="pspi" label="PSPI" state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'pspi')} onChange={updateField} />
              <TextProfileField field="metal_layer_count" label="Metal Layer Count" state={state.draft} disabled={controlsDisabled} error={visibleError(showValidation, plan, 'metal_layer_count')} onChange={updateField} />
            </ProfileFieldGroup>
          </form>
        ) : null}

        {state.recoveryDraft ? (
          <Field
            inputId="profile-recovery-copy"
            label="복구용 초안"
            help="서버 값에 자동으로 합쳐지지 않았습니다. 아래 내용을 복사해 필요한 값을 직접 확인하세요."
          >
            <textarea
              className="input min-h-32 resize-y font-mono text-xs"
              readOnly
              value={formatRecoveryDraft(state.recoveryDraft)}
            />
          </Field>
        ) : null}
      </div>
    </Drawer>
  )
}

function renderFooter({
  state,
  plan,
  onRequestClose,
  onRetryLoad,
  onReacquire,
}: {
  state: ProjectProfileLockState
  plan: ProfilePatchPlan
  onRequestClose: () => void
  onRetryLoad: () => void
  onReacquire: () => void
}) {
  const pending = isProjectProfileCloseDisabled(state)
  if (state.phase === 'conflict') {
    return (
      <>
        <Button type="button" variant="ghost" onClick={onRequestClose}>닫기</Button>
        <Button type="button" onClick={onReacquire}>다시 시도</Button>
      </>
    )
  }
  if (state.phase === 'load-error') {
    return (
      <>
        <Button type="button" variant="ghost" onClick={onRequestClose}>닫기</Button>
        <Button type="button" onClick={onRetryLoad}>다시 시도</Button>
      </>
    )
  }
  if (state.phase === 'lock-lost') {
    return (
      <>
        <Button type="button" variant="ghost" onClick={onRequestClose}>닫기</Button>
        <Button type="button" onClick={onReacquire}>최신 정보로 다시 편집</Button>
      </>
    )
  }
  if (state.draft !== null) {
    return (
      <>
        <Button type="button" variant="ghost" disabled={pending} onClick={onRequestClose}>
          취소
        </Button>
        <Button
          form="profile-editor-form"
          type="submit"
          loading={state.phase === 'saving'}
          disabled={pending || state.phase !== 'editable' || !plan.dirty}
        >
          저장
        </Button>
      </>
    )
  }
  return <Button type="button" variant="ghost" onClick={onRequestClose}>닫기</Button>
}

function ProfileFieldGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-border-subtle p-4">
      <legend className="px-1 text-sm font-bold text-ink-950">{legend}</legend>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">{children}</div>
    </fieldset>
  )
}

function TextProfileField({
  field,
  label,
  state,
  disabled,
  error,
  required = false,
  decimal = false,
  multiline = false,
  onChange,
}: {
  field: ProfileFormField
  label: string
  state: ProfileFormState
  disabled: boolean
  error?: string
  required?: boolean
  decimal?: boolean
  multiline?: boolean
  onChange: (field: ProfileFormField, value: string) => void
}) {
  const inputId = profileFieldId(field)
  return (
    <Field inputId={inputId} label={<>{label}{required ? <span className="ml-1 text-error" aria-hidden="true">*</span> : null}</>} error={error}>
      {multiline ? (
        <textarea
          className="input min-h-20 resize-y"
          disabled={disabled}
          required={required}
          value={state[field]}
          onChange={(event) => onChange(field, event.target.value)}
        />
      ) : (
        <input
          className="input"
          type="text"
          inputMode={decimal ? 'decimal' : undefined}
          disabled={disabled}
          required={required}
          value={state[field]}
          onChange={(event) => onChange(field, event.target.value)}
        />
      )}
    </Field>
  )
}

function ProfileChoiceFieldControl({
  field,
  label,
  required = false,
  allowClear = false,
  state,
  resource,
  controlsDisabled,
  error,
  onChange,
}: {
  field: ProfileChoiceField
  label: string
  required?: boolean
  allowClear?: boolean
  state: ProfileFormState
  resource: ChoiceSetOptionsResource
  controlsDisabled: boolean
  error?: string
  onChange: (field: ProfileFormField, value: string) => void
}) {
  const value = state[field] === '' ? null : state[field]
  const selected = value === null
    ? undefined
    : resource.displayOptions.find((option) => option.code === value)
  const resourceBlocked =
    !resource.selectionReady || resource.loading || resource.error !== null
  return (
    <SearchableChoice
      id={profileFieldId(field)}
      label={label}
      value={value}
      options={resource.displayOptions}
      loading={resource.loading || resource.refreshing}
      error={resource.error}
      validationError={error ?? null}
      disabled={controlsDisabled || resourceBlocked}
      sourceActive={resource.setIsActive === true}
      sourceInactive={
        selected !== undefined &&
        (selected.is_active === false || resource.setIsActive === false)
      }
      selectionReady={resource.selectionReady}
      required={required}
      allowClear={allowClear}
      onOpen={resource.prepareToOpen}
      onRetry={resource.retryOptions}
      onChange={(code) => onChange(field, code ?? '')}
    />
  )
}

export function buildProfileDrawerPatchPlan(
  state: ProjectProfileLockState,
  resources: ProjectProfileDrawerChoiceResources,
): ProfilePatchPlan {
  if (state.originalDraft === null || state.draft === null) {
    return { payload: {}, errors: {}, dirty: false }
  }
  return toProfilePatch(
    state.originalDraft,
    state.draft,
    profileChoiceAuthorization(resources),
  )
}

function profileChoiceAuthorization(
  resources: ProjectProfileDrawerChoiceResources,
): ProfileChoiceAuthorization {
  return {
    device_type_code: authorizationFor(resources.device_type_code),
    project_category_code: authorizationFor(resources.project_category_code),
    active_direction_code: authorizationFor(resources.active_direction_code),
    gate_direction_code: authorizationFor(resources.gate_direction_code),
  }
}

function authorizationFor(resource: ChoiceSetOptionsResource) {
  const activeCodes = new Set(
    resource.displayOptions
      .filter((option) => option.is_active)
      .map((option) => option.code),
  )
  return {
    ready: resource.selectionReady && resource.setIsActive === true,
    activeCodes,
  }
}

function profileFieldId(field: ProfileFormField): string {
  return `profile-${field.replace(/_/g, '-')}`
}

function visibleError(
  showValidation: boolean,
  plan: ProfilePatchPlan,
  field: ProfileFormField,
): string | undefined {
  return showValidation ? plan.errors[field] : undefined
}

function formatRecoveryDraft(draft: ProfileFormState): string {
  return PROFILE_FORM_FIELDS.map((field) => `${field}: ${draft[field]}`).join('\n')
}
