import { apiClient } from './client'

export interface MeOut {
  id: string
  display_name: string | null
  email: string | null
  roles: string[]
  permissions: string[]
}

export async function getCurrentUser(): Promise<MeOut> {
  const response = await apiClient.get<MeOut>('/auth/me')
  return response.data
}

export interface AuthPermissions {
  canEditDraft: boolean
  canRequestReview: boolean
  canApprove: boolean
  canReject: boolean
  canReturnToDraft: boolean
  canCreateRevision: boolean
  canComment: boolean
}

export interface AuthState {
  user: MeOut | null
  ready: boolean
  permissions: AuthPermissions
}

export const defaultAuthState: AuthState = {
  user: null,
  ready: false,
  permissions: {
    canEditDraft: false,
    canRequestReview: false,
    canApprove: false,
    canReject: false,
    canReturnToDraft: false,
    canCreateRevision: false,
    canComment: false,
  },
}

function asPermissions(user: MeOut | null): string[] {
  if (!Array.isArray(user?.permissions)) return []
  return user.permissions.filter((permission) => typeof permission === 'string')
}

export function resolveAuthPermissions(user: MeOut | null): AuthPermissions {
  const permissionSet = new Set(asPermissions(user))

  return {
    canEditDraft: permissionSet.has('project.edit'),
    canRequestReview: permissionSet.has('project.review.request'),
    canApprove: permissionSet.has('project.review.decide'),
    canReject: permissionSet.has('project.review.decide'),
    canReturnToDraft: permissionSet.has('project.review.request'),
    canCreateRevision: permissionSet.has('project.revision.create'),
    canComment: permissionSet.has('project.comment'),
  }
}
