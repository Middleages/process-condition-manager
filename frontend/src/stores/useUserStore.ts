import { create } from 'zustand'

interface UserState {
  currentUserId: number | null
  setCurrentUserId: (id: number | null) => void
}

export const useUserStore = create<UserState>((set) => ({
  currentUserId: null,
  setCurrentUserId: (id) => set({ currentUserId: id }),
}))
