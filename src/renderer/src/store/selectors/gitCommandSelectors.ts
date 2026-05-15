import type { GitStoreState } from '../useGitStore'

export const selectGitCommandLoading = (state: GitStoreState): boolean => state.loading

export const selectGitCommandHistory = (state: GitStoreState): GitStoreState['history'] =>
  state.history

export const selectGitCommandError = (state: GitStoreState): string | null => state.error

export const selectExecuteGitCommand = (state: GitStoreState): GitStoreState['executeCommand'] =>
  state.executeCommand

export const selectClearGitCommandHistory = (state: GitStoreState): GitStoreState['clearHistory'] =>
  state.clearHistory
