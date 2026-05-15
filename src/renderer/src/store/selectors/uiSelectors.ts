import type { UiStoreState } from '../uiStore'

export const selectActiveView = (state: UiStoreState): UiStoreState['activeView'] =>
  state.activeView

export const selectGlobalLoading = (state: UiStoreState): boolean => state.loading

export const selectError = (state: UiStoreState): string | null => state.error

export const selectSuccessMessage = (state: UiStoreState): string | null => state.successMessage

export const selectSetActiveView = (state: UiStoreState): UiStoreState['setActiveView'] =>
  state.setActiveView

export const selectClearError = (state: UiStoreState): UiStoreState['clearError'] =>
  state.clearError

export const selectClearSuccess = (state: UiStoreState): UiStoreState['clearSuccess'] =>
  state.clearSuccess
