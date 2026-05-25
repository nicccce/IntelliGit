import type { AgentStatus, LlmConfig } from '../agent/types'
import { useLlmConfigStore } from '../store/llmConfigStore'

interface GlobalSettingsPanelModel {
  config: LlmConfig | undefined
  status: AgentStatus
  error: string | null
}

export function useGlobalSettingsPanelModel(): GlobalSettingsPanelModel {
  const config = useLlmConfigStore((state) => state.config)
  const status = useLlmConfigStore((state) => state.status)
  const error = useLlmConfigStore((state) => state.error)

  return {
    config,
    status,
    error
  }
}
