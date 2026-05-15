import type { JSX, ReactNode } from 'react'
import { Button, Empty, Tooltip } from 'antd'

import type { FileStatusInfo } from '../../../../shared/types'
import FileStatusBadge from '../../components/FileStatusBadge'
import { classNames } from '../../utils/classNames'
import styles from './FileSection.module.css'

interface FileSectionProps {
  title: string
  emptyDescription: string
  files: FileStatusInfo[]
  selectedFilePath: string | null
  actionTitle: string
  actionIcon: ReactNode
  statusCode: (file: FileStatusInfo) => string
  onSelectFile: (path: string) => void
  onFileAction: (path: string) => void
  headerAction?: JSX.Element
}

function FileSection({
  title,
  emptyDescription,
  files,
  selectedFilePath,
  actionTitle,
  actionIcon,
  statusCode,
  onSelectFile,
  onFileAction,
  headerAction
}: FileSectionProps): JSX.Element {
  return (
    <div className={styles['ig-file-section']}>
      <div className={styles['ig-file-section-header']}>
        <h3>
          {title} ({files.length})
        </h3>
        {headerAction}
      </div>
      <div className={styles['ig-file-list']}>
        {files.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />
        ) : (
          files.map((file) => (
            <div
              key={file.path}
              className={classNames(
                styles['ig-file-item'],
                selectedFilePath === file.path && styles.active
              )}
              onClick={() => onSelectFile(file.path)}
            >
              <FileStatusBadge code={statusCode(file)} />
              <span className={styles['ig-file-path']}>{file.path}</span>
              <Tooltip title={actionTitle}>
                <Button
                  type="text"
                  size="small"
                  icon={actionIcon}
                  onClick={(event) => {
                    event.stopPropagation()
                    onFileAction(file.path)
                  }}
                />
              </Tooltip>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default FileSection
