import {
  selectClearError,
  selectClearSuccess,
  selectError,
  selectSuccessMessage
} from '../store/selectors'
import { useUiStore } from '../store'

interface NotificationModel {
  error: string | null
  successMessage: string | null
  clearError: () => void
  clearSuccess: () => void
}

export function useNotificationModel(): NotificationModel {
  const error = useUiStore(selectError)
  const successMessage = useUiStore(selectSuccessMessage)
  const clearError = useUiStore(selectClearError)
  const clearSuccess = useUiStore(selectClearSuccess)

  return {
    error,
    successMessage,
    clearError,
    clearSuccess
  }
}
