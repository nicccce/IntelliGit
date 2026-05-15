import { selectActiveView, selectChangeCount, selectSetActiveView } from '../store/selectors'
import { useGitStatusStore, useUiStore, type AppView } from '../store'

interface ActivityRailModel {
  activeView: AppView
  setActiveView: (view: AppView) => void
  changeCount: number
}

export function useActivityRailModel(): ActivityRailModel {
  const activeView = useUiStore(selectActiveView)
  const setActiveView = useUiStore(selectSetActiveView)
  const changeCount = useGitStatusStore(selectChangeCount)

  return {
    activeView,
    setActiveView,
    changeCount
  }
}
