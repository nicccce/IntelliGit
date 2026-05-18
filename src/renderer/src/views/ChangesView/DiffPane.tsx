import type { JSX } from 'react'

import type { DiffSource } from '../../store/diffStore'
import DiffView from '../../components/DiffView'
import styles from './DiffPane.module.css'

interface DiffPaneProps {
  selectedFilePath: string | null
  diffSource: DiffSource | null
}

function DiffPane({ selectedFilePath, diffSource }: DiffPaneProps): JSX.Element {
  const sourceLabel = diffSource === 'staged' ? '（已暂存）' : '（未暂存）'
  return (
    <div className={styles['ig-diff-view']}>
      <div className={styles['ig-diff-header']}>
        <span className={styles['ig-diff-title']}>
          {selectedFilePath ? `${selectedFilePath} ${sourceLabel}` : '选择文件查看差异'}
        </span>
      </div>
      <DiffView />
    </div>
  )
}

export default DiffPane
