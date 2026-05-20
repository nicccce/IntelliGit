import { useUiStore } from '../store'
import { selectSetError, selectShowSuccess } from '../store/selectors'

interface CommitPanelModel {
  setError: (message: string | null) => void
  showSuccess: (message: string, duration?: number) => void
}

export function useCommitPanelModel(): CommitPanelModel {
  const setError = useUiStore(selectSetError)
  const showSuccess = useUiStore(selectShowSuccess)

  return {
    setError,
    showSuccess
  }
}
