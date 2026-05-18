import type { SidePanel } from '../../app/types'
import type { UiStoreState } from '../uiStore'

export const selectActiveView = (state: UiStoreState): UiStoreState['activeView'] =>
  state.activeView

export const selectActiveSidePanel = (state: UiStoreState): SidePanel => state.activeSidePanel

export const selectSetActiveSidePanel = (state: UiStoreState): UiStoreState['setActiveSidePanel'] =>
  state.setActiveSidePanel

export const selectToggleSidePanel = (state: UiStoreState): UiStoreState['toggleSidePanel'] =>
  state.toggleSidePanel

export const selectGlobalLoading = (state: UiStoreState): boolean => state.loading

export const selectError = (state: UiStoreState): string | null => state.error

export const selectSuccessMessage = (state: UiStoreState): string | null => state.successMessage

export const selectSetActiveView = (state: UiStoreState): UiStoreState['setActiveView'] =>
  state.setActiveView

export const selectClearError = (state: UiStoreState): UiStoreState['clearError'] =>
  state.clearError

export const selectClearSuccess = (state: UiStoreState): UiStoreState['clearSuccess'] =>
  state.clearSuccess

/** 所有侧边面板共用的拉伸宽度 */
export const selectSidePanelWidth = (state: UiStoreState): number => state.sidePanelWidth

/** 设置侧边面板宽度的 action */
export const selectSetSidePanelWidth = (state: UiStoreState): UiStoreState['setSidePanelWidth'] =>
  state.setSidePanelWidth
