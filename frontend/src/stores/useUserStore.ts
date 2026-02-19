/**
 * useUserStore - backward compatibility bridge
 *
 * This store previously managed user selection via a header dropdown.
 * With the introduction of JWT authentication (SPEC-AUTH-001), user identity
 * is now managed by useAuthStore.
 *
 * This bridge provides the same interface for any remaining components that
 * still call useUserStore, deriving currentUserId from useAuthStore.
 *
 * MIGRATION NOTE: New code should use useAuthStore directly.
 */
import { create } from 'zustand'
import { useAuthStore } from '@/stores/useAuthStore'

interface UserState {
  currentUserId: number | null
  setCurrentUserId: (id: number | null) => void
}

export const useUserStore = create<UserState>(() => ({
  // Derived from useAuthStore — no longer from localStorage
  get currentUserId() {
    return useAuthStore.getState().user?.id ?? null
  },
  // No-op: user identity is managed by useAuthStore (JWT login)
  setCurrentUserId: (_id: number | null) => {
    // Intentionally empty — use useAuthStore.login() instead
  },
}))

// Keep currentUserId in sync whenever authStore user changes
useAuthStore.subscribe((authState) => {
  useUserStore.setState({ currentUserId: authState.user?.id ?? null })
})
