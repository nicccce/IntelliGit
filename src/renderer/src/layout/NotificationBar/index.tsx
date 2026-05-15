import type { JSX } from 'react'
import { Alert } from 'antd'

import { useUiStore } from '../../store'

function NotificationBar(): JSX.Element | null {
  const error = useUiStore((state) => state.error)
  const successMessage = useUiStore((state) => state.successMessage)
  const clearError = useUiStore((state) => state.clearError)
  const clearSuccess = useUiStore((state) => state.clearSuccess)

  if (error) {
    return (
      <Alert
        className="ig-notification"
        type="error"
        showIcon
        closable
        message={error}
        onClose={clearError}
      />
    )
  }

  if (successMessage) {
    return (
      <Alert
        className="ig-notification"
        type="success"
        showIcon
        closable
        message={successMessage}
        onClose={clearSuccess}
      />
    )
  }

  return null
}

export default NotificationBar
