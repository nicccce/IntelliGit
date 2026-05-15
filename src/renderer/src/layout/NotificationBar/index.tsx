import type { JSX } from 'react'
import { Alert } from 'antd'

import { useNotificationModel } from '../../viewModels'
import styles from './NotificationBar.module.css'

function NotificationBar(): JSX.Element | null {
  const { error, successMessage, clearError, clearSuccess } = useNotificationModel()

  if (error) {
    return (
      <Alert
        className={styles['ig-notification']}
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
        className={styles['ig-notification']}
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
