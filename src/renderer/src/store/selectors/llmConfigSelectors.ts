import type { LlmConfig, AgentStatus } from '../../agent/types'
import type { LlmConfigStoreState } from '../llmConfigStore'

export interface LlmConfigSnapshot {
  config: LlmConfig | undefined
  status: AgentStatus
  error: string | null
}

export const selectLlmConfigSnapshot = (state: LlmConfigStoreState): LlmConfigSnapshot => ({
  config: state.config,
  status: state.status,
  error: state.error
})
