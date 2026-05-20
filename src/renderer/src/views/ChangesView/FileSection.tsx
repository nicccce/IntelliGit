import type { JSX, ReactNode } from 'react'
import { Button, Empty, Tooltip } from 'antd'
import { CheckSquareFilled, MinusSquareOutlined } from '@ant-design/icons'

import type { FileStatusInfo } from '../../../../shared/types'
import FileStatusBadge from '../../components/FileStatusBadge'
import { classNames } from '../../utils/classNames'
import styles from './FileSection.module.css'

/** 文件选择状态 */
export type FileSelectionState = 'all' | 'partial' | 'none'

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
  /** 当前列表中的文件是否属于选中的 diff 来源 */
  isSelectedSource?: boolean
  /** 获取每个文件的选择状态 */
  getSelectionState: (filePath: string) => FileSelectionState
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
  headerAction,
  isSelectedSource,
  getSelectionState
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
          files.map((file) => {
            const isActive = selectedFilePath === file.path && isSelectedSource
            const isCrossList = selectedFilePath === file.path && !isSelectedSource
            const selState = getSelectionState(file.path)
            const isActionDisabled = selState === 'none'
            return (
              <div
                key={file.path}
                className={classNames(
                  styles['ig-file-item'],
                  isActive && styles.active,
                  isCrossList && styles['cross-reference'],
                  selState === 'none' && styles['ig-file-item-none'],
                  selState === 'partial' && styles['ig-file-item-partial']
                )}
                onClick={() => onSelectFile(file.path)}
              >
                <span className={styles['ig-file-sel-indicator']}>
                  {selState === 'all' ? (
                    <CheckSquareFilled />
                  ) : selState === 'partial' ? (
                    <MinusSquareOutlined />
                  ) : null}
                </span>
                <FileStatusBadge code={statusCode(file)} />
                <span className={styles['ig-file-path']}>{file.path}</span>
                <Tooltip title={isActionDisabled ? '未选择变更行' : actionTitle}>
                  <Button
                    type="text"
                    size="small"
                    icon={actionIcon}
                    disabled={isActionDisabled}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (!isActionDisabled) onFileAction(file.path)
                    }}
                  />
                </Tooltip>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default FileSection
