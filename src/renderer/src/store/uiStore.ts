import { create } from 'zustand'

import type { SidePanel } from '../app/types'

export type AppView = 'changes' | 'history' | 'settings' | 'nlp'

export interface UiStoreState {
  activeView: AppView
  nlpDraft: string
  nlpRunToken: number
  activeSidePanel: SidePanel
  /** 所有侧边面板共用的拉伸宽度 */
  sidePanelWidth: number
  loading: boolean
  error: string | null
  successMessage: string | null
  setActiveView: (view: AppView) => void
  setNlpDraft: (draft: string) => void
  triggerNlpRun: (draft: string) => void
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
  nlpDraft: '',
  nlpRunToken: 0,
  activeSidePanel: null,
  sidePanelWidth: 280,
  loading: false,
  error: null,
  successMessage: null,

  setActiveView: (view) => set({ activeView: view }),
  setNlpDraft: (draft) => set({ nlpDraft: draft }),
  triggerNlpRun: (draft) =>
    set((state) => ({ activeView: 'nlp', nlpDraft: draft, nlpRunToken: state.nlpRunToken + 1 })),
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
