import { useLlmConfigStore } from '../store/llmConfigStore'
import { selectLlmConfigSnapshot } from '../store/selectors'

interface GlobalSettingsPanelModel {
  config: ReturnType<typeof selectLlmConfigSnapshot>['config']
  status: ReturnType<typeof selectLlmConfigSnapshot>['status']
  error: ReturnType<typeof selectLlmConfigSnapshot>['error']
}

export function useGlobalSettingsPanelModel(): GlobalSettingsPanelModel {
  return useLlmConfigStore(selectLlmConfigSnapshot)
}
