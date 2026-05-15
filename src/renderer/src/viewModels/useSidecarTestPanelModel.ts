import type { CommandRecord } from '../store'
import {
  selectClearGitCommandHistory,
  selectExecuteGitCommand,
  selectGitCommandError,
  selectGitCommandHistory,
  selectGitCommandLoading
} from '../store/selectors'
import { useGitStore } from '../store'

interface SidecarTestPanelModel {
  loading: boolean
  history: CommandRecord[]
  error: string | null
  executeCommand: (command: string, payload?: Record<string, unknown>) => Promise<void>
  clearHistory: () => void
}

export function useSidecarTestPanelModel(): SidecarTestPanelModel {
  const loading = useGitStore(selectGitCommandLoading)
  const history = useGitStore(selectGitCommandHistory)
  const error = useGitStore(selectGitCommandError)
  const executeCommand = useGitStore(selectExecuteGitCommand)
  const clearHistory = useGitStore(selectClearGitCommandHistory)

  return {
    loading,
    history,
    error,
    executeCommand,
    clearHistory
  }
}
