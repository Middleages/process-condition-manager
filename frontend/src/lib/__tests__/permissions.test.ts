import { describe, it, expect } from 'vitest'
import {
  hasRole,
  hasAnyRole,
  canAccessAdmin,
  canAccessTab,
  canWrite,
  getMenuCategory,
  formatRoles,
} from '../permissions'
import type { UserRole } from '@/types/user'

describe('permissions', () => {
  describe('hasRole', () => {
    it('returns true when roles array includes the target role', () => {
      expect(hasRole(['admin', 'editor'], 'admin')).toBe(true)
    })

    it('returns false when roles array does not include the target role', () => {
      expect(hasRole(['editor'], 'admin')).toBe(false)
    })

    it('returns false when roles is undefined', () => {
      expect(hasRole(undefined, 'admin')).toBe(false)
    })

    it('returns false when roles is empty', () => {
      expect(hasRole([], 'admin')).toBe(false)
    })
  })

  describe('hasAnyRole', () => {
    it('returns true when at least one required role is present', () => {
      expect(hasAnyRole(['editor', 'reviewer'], ['reviewer', 'admin'])).toBe(true)
    })

    it('returns false when no required roles are present', () => {
      expect(hasAnyRole(['editor'], ['reviewer', 'admin'])).toBe(false)
    })

    it('returns false when roles is undefined', () => {
      expect(hasAnyRole(undefined, ['admin'])).toBe(false)
    })

    it('handles developer role correctly', () => {
      expect(hasAnyRole(['developer'], ['admin', 'developer'])).toBe(true)
    })
  })

  describe('canAccessAdmin', () => {
    it('returns true for admin role', () => {
      expect(canAccessAdmin(['admin'])).toBe(true)
    })

    it('returns true for developer role', () => {
      expect(canAccessAdmin(['developer'])).toBe(true)
    })

    it('returns true when user has both admin and developer roles', () => {
      expect(canAccessAdmin(['admin', 'developer'])).toBe(true)
    })

    it('returns false for editor-only role', () => {
      expect(canAccessAdmin(['editor'])).toBe(false)
    })

    it('returns false for reviewer-only role', () => {
      expect(canAccessAdmin(['reviewer'])).toBe(false)
    })

    it('returns false for undefined roles', () => {
      expect(canAccessAdmin(undefined)).toBe(false)
    })
  })

  describe('canAccessTab', () => {
    it('allows admin to access /admin/users', () => {
      expect(canAccessTab(['admin'], '/admin/users')).toBe(true)
    })

    it('denies developer from accessing /admin/users', () => {
      expect(canAccessTab(['developer'], '/admin/users')).toBe(false)
    })

    it('allows developer to access /admin/master-data', () => {
      expect(canAccessTab(['developer'], '/admin/master-data')).toBe(true)
    })

    it('allows admin to access /admin/xml-mappings', () => {
      expect(canAccessTab(['admin'], '/admin/xml-mappings')).toBe(true)
    })

    it('denies editor from accessing any admin tab', () => {
      expect(canAccessTab(['editor'], '/admin/users')).toBe(false)
      expect(canAccessTab(['editor'], '/admin/master-data')).toBe(false)
    })
  })

  describe('canWrite', () => {
    it('allows admin to write operations category', () => {
      expect(canWrite(['admin'], 'operations')).toBe(true)
    })

    it('denies developer from writing operations category', () => {
      expect(canWrite(['developer'], 'operations')).toBe(false)
    })

    it('allows developer to write system_config category', () => {
      expect(canWrite(['developer'], 'system_config')).toBe(true)
    })

    it('denies admin from writing system_config category', () => {
      expect(canWrite(['admin'], 'system_config')).toBe(false)
    })

    it('denies all from writing shared category', () => {
      expect(canWrite(['admin'], 'shared')).toBe(false)
      expect(canWrite(['developer'], 'shared')).toBe(false)
    })

    it('denies editor from writing any category', () => {
      expect(canWrite(['editor'], 'operations')).toBe(false)
      expect(canWrite(['editor'], 'system_config')).toBe(false)
      expect(canWrite(['editor'], 'shared')).toBe(false)
    })

    it('handles user with both admin and developer roles', () => {
      const roles: UserRole[] = ['admin', 'developer']
      expect(canWrite(roles, 'operations')).toBe(true)
      expect(canWrite(roles, 'system_config')).toBe(true)
    })
  })

  describe('getMenuCategory', () => {
    it('returns system_config for xml-mappings', () => {
      expect(getMenuCategory('/admin/xml-mappings')).toBe('system_config')
    })

    it('returns system_config for validations', () => {
      expect(getMenuCategory('/admin/validations')).toBe('system_config')
    })

    it('returns system_config for export-systems', () => {
      expect(getMenuCategory('/admin/export-systems')).toBe('system_config')
    })

    it('returns system_config for data-sources', () => {
      expect(getMenuCategory('/admin/data-sources')).toBe('system_config')
    })

    it('returns system_config for columns', () => {
      expect(getMenuCategory('/admin/columns')).toBe('system_config')
    })

    it('returns shared for audit-logs', () => {
      expect(getMenuCategory('/admin/audit-logs')).toBe('shared')
    })

    it('returns shared for export-histories', () => {
      expect(getMenuCategory('/admin/export-histories')).toBe('shared')
    })

    it('returns operations for master-data', () => {
      expect(getMenuCategory('/admin/master-data')).toBe('operations')
    })

    it('returns operations for users', () => {
      expect(getMenuCategory('/admin/users')).toBe('operations')
    })

    it('returns operations for enum-options', () => {
      expect(getMenuCategory('/admin/enum-options')).toBe('operations')
    })
  })

  describe('formatRoles', () => {
    it('formats single role to Korean label', () => {
      expect(formatRoles(['admin'])).toBe('관리자')
    })

    it('formats multiple roles comma-separated', () => {
      expect(formatRoles(['admin', 'developer'])).toBe('관리자, 개발자')
    })

    it('formats all 4 roles', () => {
      expect(formatRoles(['editor', 'reviewer', 'admin', 'developer'])).toBe(
        '편집자, 검토자, 관리자, 개발자'
      )
    })

    it('returns unknown role as-is', () => {
      expect(formatRoles(['unknown_role'])).toBe('unknown_role')
    })

    it('returns empty string for empty array', () => {
      expect(formatRoles([])).toBe('')
    })
  })
})
