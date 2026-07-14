import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { ProjectProfileOut } from '@/api/types'
import type { ChoiceSetOptionsResource } from '@/features/choiceSets/useChoiceSetOptions'

import {
  PROFILE_DIRTY_CONFIRM_MESSAGE,
  ProjectProfileDrawerView,
  type ProjectProfileDrawerChoiceResources,
} from './ProjectProfileDrawer'
import { hydrateProfileForm } from './profileForm'
import type { ProjectProfileLockState } from './profileLockState'

const profile: ProjectProfileOut = {
  project_id: 42,
  process_name: 'Coat Process',
  device_type: { code: 'LEGACY_DEVICE', label: 'Legacy device', is_active: false },
  project_category: { code: 'LOGIC', label: 'Logic', is_active: true },
  comment: 'Baseline',
  active_direction: { code: 'VERTICAL', label: 'Vertical', is_active: false },
  gate_direction: { code: 'NORTH', label: 'North', is_active: true },
  gross_die: '100',
  pitch_x: '1.5',
  pitch_y: '2.5',
  shot_x: '3.5',
  shot_y: '4.5',
  slit_occupancy: '5.5',
  lens_occupancy: '6.5',
  map_offset_x: '7.5',
  map_offset_y: '8.5',
  scribe_lane_x: '9.5',
  scribe_lane_y: '10.5',
  shot_count: '80',
  full_shot: '60',
  layer_total: '24',
  euv: '3',
  imm: '4',
  arf: '5',
  krf: '6',
  iline: '7',
  soh: '8',
  pspi: '9',
  metal_layer_count: '10',
  created_at: '2026-07-14T00:00:00Z',
  updated_at: '2026-07-14T00:00:00Z',
}

function resource(
  setCode: string,
  items: ChoiceSetOptionsResource['displayOptions'],
  overrides: Partial<ChoiceSetOptionsResource> = {},
): ChoiceSetOptionsResource {
  return {
    setCode,
    version: 1,
    setIsActive: true,
    displayOptions: items,
    selectableOptions: items,
    selectionReady: true,
    loading: false,
    refreshing: false,
    error: null,
    prepareToOpen: vi.fn().mockResolvedValue(undefined),
    refetchSummary: vi.fn().mockResolvedValue(undefined),
    retryOptions: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function resources(
  overrides: Partial<ProjectProfileDrawerChoiceResources> = {},
): ProjectProfileDrawerChoiceResources {
  return {
    device_type_code: resource('device_type', [
      { code: 'LEGACY_DEVICE', label: 'Legacy device', sort_order: 0, is_active: false },
      { code: 'FOUNDRY', label: 'Foundry', sort_order: 1, is_active: true },
    ]),
    project_category_code: resource('project_category', [
      { code: 'LOGIC', label: 'Logic', sort_order: 0, is_active: true },
    ]),
    active_direction_code: resource('active_direction', [
      { code: 'VERTICAL', label: 'Vertical', sort_order: 0, is_active: false },
      { code: 'HORIZONTAL', label: 'Horizontal', sort_order: 1, is_active: true },
    ]),
    gate_direction_code: resource('gate_direction', [
      { code: 'NORTH', label: 'North', sort_order: 0, is_active: true },
    ]),
    ...overrides,
  }
}

function state(
  overrides: Partial<ProjectProfileLockState> = {},
): ProjectProfileLockState {
  const form = hydrateProfileForm(profile)
  return {
    phase: 'editable',
    generation: 1,
    token: 'token-1',
    holder: null,
    profile,
    originalDraft: form,
    draft: form,
    recoveryDraft: null,
    error: null,
    ...overrides,
  }
}

function renderDrawer(
  lockState = state(),
  choiceResources = resources(),
  showValidation = false,
): string {
  return renderToStaticMarkup(
    <ProjectProfileDrawerView
      state={lockState}
      resources={choiceResources}
      showValidation={showValidation}
      fallbackFocusRef={{ current: null }}
      onDraftChange={vi.fn()}
      onRequestClose={vi.fn()}
      onRetryLoad={vi.fn()}
      onReacquire={vi.fn()}
      onSave={vi.fn()}
    />,
  )
}

describe('ProjectProfileDrawerView', () => {
  it('renders the complete grouped string-only form with accessible choice diagnostics', () => {
    const html = renderDrawer()

    expect(html).toContain('aria-modal="true"')
    for (const legend of ['Product', 'Direction', 'Die/Shot', 'Wafer Position', 'Layer Summary']) {
      expect(html, legend).toContain(`<legend`)
      expect(html, legend).toContain(`>${legend}</legend>`)
    }
    for (const label of [
      'Process Name', 'Device Type', 'Category', 'Comment',
      'Active Direction', 'Gate Direction', 'Gross Die',
      'Pitch X', 'Pitch Y', 'Shot X', 'Shot Y',
      'Slit Occupancy', 'Lens Occupancy', 'Shot Count', 'Full Shot',
      'Map Offset X', 'Map Offset Y', 'Scribe Lane X', 'Scribe Lane Y',
      'Layer Total', 'EUV', 'IMM', 'ARF', 'KRF', 'I-line', 'SOH', 'PSPI',
      'Metal Layer Count',
    ]) {
      expect(html, label).toContain(label)
    }
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-required="true"')
    expect(html).toMatch(/<form[^>]*id="profile-editor-form"[^>]*novalidate=""/)
    expect(html).toContain('LEGACY_DEVICE · Legacy device')
    expect(html).toContain('VERTICAL · Vertical')
    expect(html).toContain('사용 중지됨')
    expect(html).toContain('inputMode="decimal"')
    expect(html).not.toContain('type="number"')
    expect(html).not.toMatch(/device[_ ]?ref/i)
  })

  it('preserves a raw choice on resource failure and disables changing it until retry', () => {
    const failed = resource('active_direction', [], {
      selectionReady: false,
      error: '선택지를 불러오지 못했습니다.',
    })
    const html = renderDrawer(
      state({
        draft: { ...hydrateProfileForm(profile), active_direction_code: 'RAW_CODE' },
      }),
      resources({ active_direction_code: failed }),
    )

    expect(html).toContain('RAW_CODE')
    expect(html).toContain('선택지를 불러오지 못했습니다.')
    expect(html).toContain('다시 시도')
    expect(html).not.toContain('RAW_CODE ·')
    expect(html).not.toMatch(/RAW_CODE[\s\S]{0,100}사용 중지됨/)
    expect(html).toMatch(/id="profile-active-direction-code"[^>]*disabled=""/)
  })

  it('names the conflicting holder and offers retry without an editable draft', () => {
    const html = renderDrawer(
      state({
        phase: 'conflict',
        token: null,
        holder: 'park-admin',
        profile: null,
        originalDraft: null,
        draft: null,
      }),
    )

    expect(html).toContain('park-admin')
    expect(html).toContain('잠금을 획득하지 못했습니다')
    expect(html).toContain('다시 시도')
    expect(html).not.toContain('profile-editor-form')
  })

  it('exposes one dirty-close copy and disables the shared close controls only while pending', () => {
    const dirtyDraft = { ...hydrateProfileForm(profile), comment: 'unsaved' }
    const editable = renderDrawer(state({ draft: dirtyDraft }))
    const saving = renderDrawer(state({ phase: 'saving', draft: dirtyDraft }))

    expect(editable).toContain(PROFILE_DIRTY_CONFIRM_MESSAGE)
    expect(editable).toContain('저장하지 않은 변경이 있습니다')
    expect(saving).toMatch(/aria-label="닫기"[^>]*disabled=""/)
    expect(saving).toMatch(
      /<button[^>]*disabled=""[^>]*>[\s\S]*?취소[\s\S]*?<\/button>/,
    )
  })

  it('keeps the submit action operable so invalid drafts can reveal local errors', () => {
    const invalidDraft = { ...hydrateProfileForm(profile), process_name: '' }
    const html = renderDrawer(state({ draft: invalidDraft }), resources(), true)
    const saveButton = html.match(
      /<button[^>]*form="profile-editor-form"[^>]*>[\s\S]*?<\/button>/,
    )?.[0]

    expect(html).toContain('Process Name은 필수입니다.')
    expect(saveButton).toBeDefined()
    expect(saveButton).not.toContain('disabled=""')
    expect(saveButton).not.toContain('aria-disabled="true"')
  })

  it('freezes a lock-lost draft read-only and preserves explicit recovery copy', () => {
    const recoveryDraft = { ...hydrateProfileForm(profile), comment: 'copy this recovery' }
    const html = renderDrawer(
      state({
        phase: 'lock-lost',
        holder: 'new-owner',
        token: 'old-token',
        draft: recoveryDraft,
        recoveryDraft,
      }),
    )

    expect(html).toContain('편집 잠금을 잃었습니다')
    expect(html).toContain('copy this recovery')
    expect(html).toContain('복구용 초안')
    expect(html).toContain('최신 정보로 다시 편집')
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*id="profile-process-name"/)
  })

  it('keeps the lost draft visibly separate after a fresh reacquire', () => {
    const recoveryDraft = { ...hydrateProfileForm(profile), comment: 'old unsaved copy' }
    const freshProfile = { ...profile, comment: 'fresh server value' }
    const freshDraft = hydrateProfileForm(freshProfile)
    const html = renderDrawer(
      state({
        profile: freshProfile,
        originalDraft: freshDraft,
        draft: freshDraft,
        recoveryDraft,
      }),
    )

    expect(html).toContain('fresh server value')
    expect(html).toContain('복구용 초안')
    expect(html).toContain('old unsaved copy')
    expect(html).toContain('서버 값에 자동으로 합쳐지지 않았습니다')
  })
})
