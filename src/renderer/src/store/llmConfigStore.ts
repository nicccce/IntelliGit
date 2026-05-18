import { create } from 'zustand'
import type { LlmConfig, AgentStatus } from '../agent/types'

export interface LlmConfigStoreState {
  config: LlmConfig | undefined
  status: AgentStatus
  error: string | null
  checkedAt: number | null

  setLlmConfig: (config: LlmConfig | undefined) => void
  setStatus: (status: AgentStatus, error?: string) => void
  clearLlmConfig: () => void
}

export const useLlmConfigStore = create<LlmConfigStoreState>((set) => ({
  config: undefined,
  status: 'unconfigured',
  error: null,
  checkedAt: null,

  setLlmConfig: (config) =>
    set({
      config,
      status: config ? 'ready' : 'unconfigured',
      error: null
    }),

  setStatus: (status, error) =>
    set({
      status,
      error: error ?? null,
      checkedAt: Date.now()
    }),

  clearLlmConfig: () =>
    set({
      config: undefined,
      status: 'unconfigured',
      error: null,
      checkedAt: null
    })
}))
