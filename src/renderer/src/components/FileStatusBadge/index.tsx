import type { JSX } from 'react'

import { statusColor, statusLabel } from '../../utils/fileStatus'
import styles from './FileStatusBadge.module.css'

interface FileStatusBadgeProps {
  code: string
  className?: string
}

function FileStatusBadge({
  code,
  className = styles['ig-file-status-badge']
}: FileStatusBadgeProps): JSX.Element {
  return (
    <span className={className} style={{ color: statusColor(code) }}>
      {statusLabel(code)}
    </span>
  )
}

export default FileStatusBadge
