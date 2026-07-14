import { describe, expect, it } from 'vitest'

import type { ProjectProfileOut } from '@/api/types'

import {
  DECIMAL_PROFILE_FIELDS,
  NULLABLE_TEXT_PROFILE_FIELDS,
  PROFILE_FORM_FIELDS,
  hydrateProfileForm,
  toProfilePatch,
  type ProfileChoiceAuthorization,
  type ProfileFormState,
} from './profileForm'

const profile: ProjectProfileOut = {
  project_id: 42,
  process_name: 'Coat Process',
  device_type: { code: 'FOUNDRY', label: 'Foundry', is_active: false },
  project_category: { code: 'LOGIC', label: 'Logic', is_active: true },
  comment: 'baseline',
  active_direction: { code: 'VERTICAL', label: 'Vertical', is_active: false },
  gate_direction: null,
  gross_die: '100',
  pitch_x: '1.5',
  pitch_y: null,
  shot_x: null,
  shot_y: null,
  slit_occupancy: null,
  lens_occupancy: null,
  map_offset_x: null,
  map_offset_y: null,
  scribe_lane_x: null,
  scribe_lane_y: null,
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

function authorization(
  overrides: Partial<ProfileChoiceAuthorization> = {},
): ProfileChoiceAuthorization {
  return {
    device_type_code: { ready: true, activeCodes: new Set(['FOUNDRY', 'MEMORY']) },
    project_category_code: { ready: true, activeCodes: new Set(['LOGIC', 'MEMORY']) },
    active_direction_code: { ready: true, activeCodes: new Set(['HORIZONTAL']) },
    gate_direction_code: { ready: true, activeCodes: new Set(['NORTH', 'SOUTH']) },
    ...overrides,
  }
}

function plan(changes: Partial<ProfileFormState> = {}, auth = authorization()) {
  const original = hydrateProfileForm(profile)
  return toProfilePatch(original, { ...original, ...changes }, auth)
}

describe('Profile form hydration', () => {
  it('uses only the approved 28 string fields and hydrates resolved choices to codes', () => {
    const state = hydrateProfileForm(profile)

    expect(PROFILE_FORM_FIELDS).toHaveLength(28)
    expect(Object.keys(state)).toEqual(PROFILE_FORM_FIELDS)
    expect(Object.values(state).every((value) => typeof value === 'string')).toBe(true)
    expect(state).toMatchObject({
      process_name: 'Coat Process',
      device_type_code: 'FOUNDRY',
      project_category_code: 'LOGIC',
      active_direction_code: 'VERTICAL',
      gate_direction_code: '',
      pitch_x: '1.5',
      pitch_y: '',
    })
    expect(state).not.toHaveProperty('project_id')
    expect(state).not.toHaveProperty('device_type')
    expect(state).not.toHaveProperty('device_ref')
  })

  it('enumerates the shared ten decimal and thirteen nullable text fields', () => {
    expect(DECIMAL_PROFILE_FIELDS).toEqual([
      'pitch_x',
      'pitch_y',
      'shot_x',
      'shot_y',
      'slit_occupancy',
      'lens_occupancy',
      'map_offset_x',
      'map_offset_y',
      'scribe_lane_x',
      'scribe_lane_y',
    ])
    expect(NULLABLE_TEXT_PROFILE_FIELDS).toEqual([
      'comment',
      'gross_die',
      'shot_count',
      'full_shot',
      'layer_total',
      'euv',
      'imm',
      'arf',
      'krf',
      'iline',
      'soh',
      'pspi',
      'metal_layer_count',
    ])
  })
})

describe('Profile form exact diff', () => {
  it('omits every unchanged field, including inactive current choices', () => {
    const original = hydrateProfileForm(profile)
    const result = toProfilePatch(original, { ...original }, authorization({
      device_type_code: { ready: false, activeCodes: new Set() },
      active_direction_code: { ready: true, activeCodes: new Set() },
    }))

    expect(result).toEqual({ payload: {}, errors: {}, dirty: false })
  })

  it('emits null only for changed optional blanks and trims changed text', () => {
    expect(
      plan({
        comment: '   ',
        active_direction_code: ' ',
        pitch_x: '',
        gross_die: '  120 dies  ',
      }),
    ).toEqual({
      payload: {
        comment: null,
        active_direction_code: null,
        pitch_x: null,
        gross_die: '120 dies',
      },
      errors: {},
      dirty: true,
    })
  })

  it('rejects blank required Process Name, Device Type, and Category atomically', () => {
    const result = plan({
      process_name: ' ',
      device_type_code: '',
      project_category_code: '   ',
      comment: 'changed',
    })

    expect(result.payload).toBeNull()
    expect(result.dirty).toBe(true)
    expect(result.errors.process_name).toContain('필수')
    expect(result.errors.device_type_code).toContain('필수')
    expect(result.errors.project_category_code).toContain('필수')
  })

  it.each(DECIMAL_PROFILE_FIELDS)(
    'canonicalizes %s with the shared string-only decimal contract',
    (field) => {
      const raw = field === 'pitch_x' ? '001.6000' : '001.5000'
      const expected = field === 'pitch_x' ? '1.6' : '1.5'
      const result = plan({ [field]: raw })

      expect(result.payload).toEqual({ [field]: expected })
      expect(result.errors).toEqual({})
    },
  )

  it('keeps invalid decimal text in the draft and emits no request payload', () => {
    const original = hydrateProfileForm(profile)
    const draft = { ...original, pitch_y: '1e3', comment: 'changed' }

    const result = toProfilePatch(original, draft, authorization())

    expect(draft.pitch_y).toBe('1e3')
    expect(result.payload).toBeNull()
    expect(result.errors.pitch_y).toContain('10진수')
    expect(result.dirty).toBe(true)
  })

  it('treats canonical-equivalent decimal spelling as unchanged', () => {
    expect(plan({ pitch_x: '001.5000' })).toEqual({
      payload: {},
      errors: {},
      dirty: false,
    })
  })

  it('allows unchanged inactive choices but rejects changed inactive, unknown, or unverified codes', () => {
    expect(plan().errors).toEqual({})

    const inactive = plan({ active_direction_code: 'VERTICAL_2' })
    expect(inactive.payload).toBeNull()
    expect(inactive.errors.active_direction_code).toContain('활성')

    const unknown = plan({ gate_direction_code: 'UNKNOWN' })
    expect(unknown.payload).toBeNull()
    expect(unknown.errors.gate_direction_code).toContain('활성')

    const unverified = plan(
      { project_category_code: 'MEMORY' },
      authorization({
        project_category_code: { ready: false, activeCodes: new Set(['MEMORY']) },
      }),
    )
    expect(unverified.payload).toBeNull()
    expect(unverified.errors.project_category_code).toContain('최신')
  })

  it('does not let unavailable unchanged choices block an unrelated text edit', () => {
    const result = plan(
      { comment: ' unrelated edit ' },
      authorization({
        device_type_code: { ready: false, activeCodes: new Set() },
        project_category_code: { ready: false, activeCodes: new Set() },
        active_direction_code: { ready: false, activeCodes: new Set() },
        gate_direction_code: { ready: false, activeCodes: new Set() },
      }),
    )

    expect(result).toEqual({
      payload: { comment: 'unrelated edit' },
      errors: {},
      dirty: true,
    })
  })

  it('round-trips every remaining text field after outer trim without parsing it', () => {
    const changes = Object.fromEntries(
      NULLABLE_TEXT_PROFILE_FIELDS.map((field, index) => [
        field,
        `  ${index + 1} / keep inner text  `,
      ]),
    ) as Partial<ProfileFormState>
    const result = plan(changes)

    expect(result.errors).toEqual({})
    expect(result.payload).not.toBeNull()
    for (const [field, value] of Object.entries(changes)) {
      expect(result.payload?.[field as keyof NonNullable<typeof result.payload>]).toBe(
        value?.trim(),
      )
    }
  })
})
