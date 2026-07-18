import { describe, expect, it } from 'vitest'

import {
  backboneDiffBranchPath,
  backboneDiffBranchQueryKey,
  backboneDiffCellPath,
  backboneDiffCellQueryKey,
  backboneDiffProjectQueryKey,
  backboneDiffRootQueryKey,
  buildBackboneDiffBranchQueryString,
  buildBackboneDiffCellQueryString,
  buildBackboneDiffRootQueryString,
  createBackboneDiffBranchQueryOptions,
  createBackboneDiffCellQueryOptions,
  createBackboneDiffRootQueryOptions,
} from './backboneDiffQuery'

describe('backboneDiffQuery', () => {
  it('normalizes root filters with sorted deduplicated classifications', () => {
    const normalized = createBackboneDiffRootQueryOptions({
      classification: ['removed', 'added', 'added', 'changed'],
      includeUnchanged: true,
      layerKey: ' L1::PROC_A::010::ETCH ',
      categoryCode: 'photo',
      parameterCode: 'ETCH_P001',
      previewLimit: 10,
    })

    expect(normalized.classification).toEqual(['added', 'changed', 'removed'])
    expect(normalized.layerKey).toBe('L1::PROC_A::010::ETCH')
    expect(normalized.categoryCode).toBe('photo')
    expect(normalized.parameterCode).toBe('ETCH_P001')
    expect(normalized.previewLimit).toBe(10)
  })

  it('enforces invariant unchanged classification requires include_unchanged', () => {
    expect(() =>
      createBackboneDiffRootQueryOptions({
        classification: ['unchanged'],
        includeUnchanged: false,
      }),
    ).toThrow(TypeError)
  })

  it('builds stable root query strings with repeated classifications and defaults', () => {
    expect(
      buildBackboneDiffRootQueryString({
        classification: ['changed', 'added', 'changed'],
        includeUnchanged: true,
        previewLimit: 10,
      }),
    ).toBe('classification=added&classification=changed&include_unchanged=true&preview_limit=10')

    expect(buildBackboneDiffRootQueryString({})).toBe('preview_limit=20')
  })

  it('normalizes branch options and enforces bounds', () => {
    const normalized = createBackboneDiffBranchQueryOptions({
      scope: 'scope-token_1',
      limit: 1,
      cursor: 'next_cursor-2',
    })

    expect(normalized).toEqual({ scope: 'scope-token_1', cursor: 'next_cursor-2', limit: 1 })

    expect(() =>
      createBackboneDiffBranchQueryOptions({
        scope: 'scope-token',
        limit: 0,
      }),
    ).toThrow(TypeError)
    expect(() =>
      createBackboneDiffBranchQueryOptions({
        scope: ' scope-token',
        limit: 1,
      }),
    ).toThrow(TypeError)
    expect(() =>
      createBackboneDiffBranchQueryOptions({
        scope: 'scope-token',
        cursor: 'next\n',
        limit: 1,
      }),
    ).toThrow(TypeError)

    expect(
      createBackboneDiffBranchQueryOptions({
        scope: 'scope-token',
        cursor: null,
        limit: 1,
      }),
    ).toEqual({
      scope: 'scope-token',
      cursor: null,
      limit: 1,
    })

    expect(() =>
      createBackboneDiffBranchQueryOptions({
        scope: 'a'.repeat(4097),
      }),
    ).toThrow(TypeError)

    expect(
      buildBackboneDiffBranchQueryString({
        scope: 'scope-token_1',
        cursor: 'next_cursor-2',
        limit: 20,
      }),
    ).toBe('scope=scope-token_1&cursor=next_cursor-2&limit=20')
  })

  it('normalizes cell options and enforces bounds', () => {
    expect(createBackboneDiffCellQueryOptions({ scope: 'scope-token_1', limit: 100 }).limit).toBe(100)

    expect(
      buildBackboneDiffCellQueryString({
        scope: 'scope-token_1',
        limit: 200,
      }),
    ).toBe('scope=scope-token_1&limit=200')

    expect(() =>
      createBackboneDiffCellQueryOptions({
        scope: 'scope-token_1',
        limit: 201,
      }),
    ).toThrow(TypeError)

    expect(() =>
      createBackboneDiffCellQueryOptions({
        scope: 'scope-token 1',
        limit: 1,
      }),
    ).toThrow(TypeError)

    expect(
      buildBackboneDiffCellQueryString({
        scope: 'scope-token_1',
        cursor: 'cursor_cell_2',
        limit: 100,
      }),
    ).toBe('scope=scope-token_1&cursor=cursor_cell_2&limit=100')
  })

  it('builds encoded layer/row paths using encoded path tokens', () => {
    expect(backboneDiffBranchPath(7, 'L1::PROC A::010::ETCH')).toBe(
      '/projects/7/backbone-diff/layers/L1%3A%3APROC%20A%3A%3A010%3A%3AETCH/conditions',
    )
    expect(backboneDiffCellPath(7, 'L1::PROC_A::010::ETCH', 'cmVfcm93X3JlZg')).toBe(
      '/projects/7/backbone-diff/layers/L1%3A%3APROC_A%3A%3A010%3A%3AETCH/conditions/cmVfcm93X3JlZg/cells',
    )
  })

  it('normalizes query-key fields to stable equality', () => {
    const keyA = backboneDiffRootQueryKey(7, {
      classification: ['removed', 'added'],
      includeUnchanged: true,
      previewLimit: 10,
    })
    const keyB = backboneDiffRootQueryKey(7, {
      classification: ['added', 'removed'],
      includeUnchanged: true,
      previewLimit: 10,
    })

    expect(keyA).toEqual(keyB)
    expect(backboneDiffBranchQueryKey(7, 'L1::PROC_A::010::ETCH', {
      scope: 'scope-1',
      cursor: 'c',
      limit: 10,
    })).toEqual([
      ...backboneDiffProjectQueryKey(7),
      'branch',
      'L1::PROC_A::010::ETCH',
      {
        scope: 'scope-1',
        cursor: 'c',
        limit: 10,
      },
    ])
    expect(backboneDiffCellQueryKey(7, 'L1::PROC_A::010::ETCH', 'cmVfcm93X3JlZg', {
      scope: 'scope-1',
      cursor: null,
      limit: 10,
    })).toEqual([
      ...backboneDiffProjectQueryKey(7),
      'cell',
      'L1::PROC_A::010::ETCH',
      'cmVfcm93X3JlZg',
      {
        scope: 'scope-1',
        cursor: null,
        limit: 10,
      },
    ])
  })
})
