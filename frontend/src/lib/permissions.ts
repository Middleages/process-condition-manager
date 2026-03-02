// 다중 역할 RBAC 권한 판정 유틸리티
import type { UserRole } from '@/types/user'

export type MenuCategory = 'operations' | 'system_config' | 'shared'

/** 특정 역할을 보유하는지 확인 */
export function hasRole(roles: UserRole[] | undefined, role: UserRole): boolean {
  return roles?.includes(role) ?? false
}

/** 주어진 역할 목록 중 하나라도 보유하는지 확인 */
export function hasAnyRole(roles: UserRole[] | undefined, required: UserRole[]): boolean {
  return required.some(r => roles?.includes(r) ?? false)
}

/** 관리자 섹션 접근 가능 여부 (admin 또는 developer) */
export function canAccessAdmin(roles: UserRole[] | undefined): boolean {
  return hasAnyRole(roles, ['admin', 'developer'])
}

/** 특정 관리자 탭 접근 가능 여부 */
export function canAccessTab(roles: UserRole[] | undefined, tabPath: string): boolean {
  // 사용자 관리 탭은 admin 전용
  if (tabPath === '/admin/users') return hasRole(roles, 'admin')
  // 공지사항 관리 탭은 admin 전용
  if (tabPath === '/admin/announcements') return hasRole(roles, 'admin')
  // 나머지 탭은 admin 또는 developer
  return canAccessAdmin(roles)
}

/** 메뉴 카테고리별 쓰기 권한 판정 */
export function canWrite(roles: UserRole[] | undefined, category: MenuCategory): boolean {
  if (category === 'operations') return hasRole(roles, 'admin')
  if (category === 'system_config') return hasRole(roles, 'developer')
  // shared = 읽기 전용
  return false
}

/** 탭 경로에 해당하는 메뉴 카테고리 반환 */
export function getMenuCategory(tabPath: string): MenuCategory {
  const systemConfigPaths = [
    '/admin/columns',
    '/admin/xml-mappings',
    '/admin/validations',
    '/admin/export-systems',
    '/admin/data-sources',
    '/admin/device-masters',
  ]
  if (systemConfigPaths.includes(tabPath)) return 'system_config'
  if (tabPath === '/admin/audit-logs' || tabPath === '/admin/export-histories') return 'shared'
  return 'operations'
}

/** 역할 배열을 한국어 레이블 문자열로 변환 */
export function formatRoles(roles: string[]): string {
  const labels: Record<string, string> = {
    editor: '편집자',
    reviewer: '검토자',
    admin: '관리자',
    developer: '개발자',
  }
  return roles.map(r => labels[r] ?? r).join(', ')
}
