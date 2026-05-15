import type { JSX } from 'react'
import { Alert } from 'antd'

import { useAppStore } from '../../store'

function NotificationBar(): JSX.Element | null {
  const error = useAppStore((state) => state.error)
  const successMessage = useAppStore((state) => state.successMessage)
  const clearError = useAppStore((state) => state.clearError)
  const clearSuccess = useAppStore((state) => state.clearSuccess)

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
