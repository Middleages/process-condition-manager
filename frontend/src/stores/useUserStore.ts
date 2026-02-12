import { create } from 'zustand'

const STORAGE_KEY = 'pcm-current-user-id'

function loadUserId(): number | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const id = Number(stored)
      return isNaN(id) ? null : id
    }
  } catch {
    // localStorage not available
  }
  return null
}

interface UserState {
  currentUserId: number | null
  setCurrentUserId: (id: number | null) => void
}

export const useUserStore = create<UserState>((set) => ({
  currentUserId: loadUserId(),
  setCurrentUserId: (id) => {
    try {
      if (id !== null) {
        localStorage.setItem(STORAGE_KEY, String(id))
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // localStorage not available
    }
    set({ currentUserId: id })
  },
}))
