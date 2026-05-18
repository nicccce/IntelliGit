import { create } from 'zustand'

import type { SidePanel } from '../app/types'

export type AppView = 'changes' | 'history' | 'settings'

export interface UiStoreState {
  activeView: AppView
  activeSidePanel: SidePanel
  /** 所有侧边面板共用的拉伸宽度 */
  sidePanelWidth: number
  loading: boolean
  error: string | null
  successMessage: string | null
  setActiveView: (view: AppView) => void
  setActiveSidePanel: (panel: SidePanel) => void
  toggleSidePanel: (panel: SidePanel) => void
  setSidePanelWidth: (width: number) => void
  setLoading: (loading: boolean) => void
  setError: (message: string | null) => void
  showSuccess: (message: string, duration?: number) => void
  clearError: () => void
  clearSuccess: () => void
}

let successTimer: ReturnType<typeof setTimeout> | null = null

export const useUiStore = create<UiStoreState>((set) => ({
  activeView: 'changes',
  activeSidePanel: null,
  sidePanelWidth: 280,
  loading: false,
  error: null,
  successMessage: null,

  setActiveView: (view) => set({ activeView: view }),
  setActiveSidePanel: (panel) => set({ activeSidePanel: panel }),
  toggleSidePanel: (panel) =>
    set((state) => ({ activeSidePanel: state.activeSidePanel === panel ? null : panel })),
  setSidePanelWidth: (width) => set({ sidePanelWidth: width }),
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
