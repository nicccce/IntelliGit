import type { SidecarCommandStoreState } from './sidecarCommandStore'

export const selectSidecarCommandLoading = (state: SidecarCommandStoreState): boolean =>
  state.loading

export const selectSidecarCommandHistory = (
  state: SidecarCommandStoreState
): SidecarCommandStoreState['history'] => state.history

export const selectSidecarCommandError = (state: SidecarCommandStoreState): string | null =>
  state.error

export const selectExecuteSidecarCommand = (
  state: SidecarCommandStoreState
): SidecarCommandStoreState['executeCommand'] => state.executeCommand

export const selectClearSidecarCommandHistory = (
  state: SidecarCommandStoreState
): SidecarCommandStoreState['clearHistory'] => state.clearHistory
