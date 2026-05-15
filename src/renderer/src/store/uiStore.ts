import { create } from 'zustand'

export type AppView = 'changes' | 'history' | 'settings'

interface UiStoreState {
  activeView: AppView
  loading: boolean
  error: string | null
  successMessage: string | null
  setActiveView: (view: AppView) => void
  setLoading: (loading: boolean) => void
  setError: (message: string | null) => void
  showSuccess: (message: string, duration?: number) => void
  clearError: () => void
  clearSuccess: () => void
}

let successTimer: ReturnType<typeof setTimeout> | null = null

export const useUiStore = create<UiStoreState>((set) => ({
  activeView: 'changes',
  loading: false,
  error: null,
  successMessage: null,

  setActiveView: (view) => set({ activeView: view }),
  setLoading: (loading) => set({ loading }),
  setError: (message) => set({ error: message }),

  showSuccess: (message, duration = 3000) => {
    if (successTimer) {
      clearTimeout(successTimer)
      successTimer = null
    }

    set({ successMessage: message })

    if (duration > 0) {
      successTimer = setTimeout(() => {
        set({ successMessage: null })
        successTimer = null
      }, duration)
    }
  },

  clearError: () => set({ error: null }),
  clearSuccess: () => {
    if (successTimer) {
      clearTimeout(successTimer)
      successTimer = null
    }
    set({ successMessage: null })
  }
}))
