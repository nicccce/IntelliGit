import { useCallback } from 'react'

import { useUiStore } from '../store'
import { selectSetSidePanelWidth, selectSidePanelWidth } from '../store/selectors'

interface SidePanelShellModel {
  panelWidth: number
  resizePanel: (clientX: number, minWidth: number, maxWidth: number) => void
}

export function useSidePanelShellModel(): SidePanelShellModel {
  const panelWidth = useUiStore(selectSidePanelWidth)
  const setPanelWidth = useUiStore(selectSetSidePanelWidth)

  const resizePanel = useCallback(
    (clientX: number, minWidth: number, maxWidth: number): void => {
      const newWidth = Math.max(minWidth, Math.min(maxWidth, clientX - 52))
      setPanelWidth(newWidth)
    },
    [setPanelWidth]
  )

  return {
    panelWidth,
    resizePanel
  }
}
