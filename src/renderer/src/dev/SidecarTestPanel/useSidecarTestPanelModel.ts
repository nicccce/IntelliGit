import type { SidecarCommandRecord } from './sidecarCommandStore'
import {
  selectClearSidecarCommandHistory,
  selectExecuteSidecarCommand,
  selectSidecarCommandError,
  selectSidecarCommandHistory,
  selectSidecarCommandLoading
} from './sidecarCommandSelectors'
import { useSidecarCommandStore } from './sidecarCommandStore'

interface SidecarTestPanelModel {
  loading: boolean
  history: SidecarCommandRecord[]
  error: string | null
  executeCommand: (command: string, payload?: Record<string, unknown>) => Promise<void>
  clearHistory: () => void
}

export function useSidecarTestPanelModel(): SidecarTestPanelModel {
  const loading = useSidecarCommandStore(selectSidecarCommandLoading)
  const history = useSidecarCommandStore(selectSidecarCommandHistory)
  const error = useSidecarCommandStore(selectSidecarCommandError)
  const executeCommand = useSidecarCommandStore(selectExecuteSidecarCommand)
  const clearHistory = useSidecarCommandStore(selectClearSidecarCommandHistory)

  return {
    loading,
    history,
    error,
    executeCommand,
    clearHistory
  }
}
