import type { JSX } from 'react'

import { statusColor, statusLabel } from '../../utils/fileStatus'

interface FileStatusBadgeProps {
  code: string
  className?: string
}

function FileStatusBadge({
  code,
  className = 'ig-file-status-badge'
}: FileStatusBadgeProps): JSX.Element {
  return (
    <span className={className} style={{ color: statusColor(code) }}>
      {statusLabel(code)}
    </span>
  )
}

export default FileStatusBadge
