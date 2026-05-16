import { create } from 'zustand'

import { invokeRawSidecarCommand } from './sidecarTestClient'

export interface SidecarCommandRecord {
  id: number
  command: string
  payload?: Record<string, unknown>
  response: unknown
  timestamp: number
  success: boolean
}

export interface SidecarCommandStoreState {
  loading: boolean
  history: SidecarCommandRecord[]
  error: string | null
  executeCommand: (command: string, payload?: Record<string, unknown>) => Promise<void>
  clearHistory: () => void
}

let idCounter = 0

export const useSidecarCommandStore = create<SidecarCommandStoreState>((set) => ({
  loading: false,
  history: [],
  error: null,

  executeCommand: async (command, payload) => {
    set({ loading: true, error: null })

    try {
      const response = await invokeRawSidecarCommand(command, payload)
      const record: SidecarCommandRecord = {
        id: ++idCounter,
        command,
        payload,
        response,
        timestamp: Date.now(),
        success: response.success
      }

      set((state) => ({
        loading: false,
        history: [record, ...state.history]
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const record: SidecarCommandRecord = {
        id: ++idCounter,
        command,
        payload,
        response: { error: message },
        timestamp: Date.now(),
        success: false
      }

      set((state) => ({
        loading: false,
        error: message,
        history: [record, ...state.history]
      }))
    }
  },

  clearHistory: () => set({ history: [], error: null })
}))
