import type { JSX } from 'react'

import DiffView from '../../components/DiffView'
import styles from './DiffPane.module.css'

interface DiffPaneProps {
  selectedFilePath: string | null
}

function DiffPane({ selectedFilePath }: DiffPaneProps): JSX.Element {
  return (
    <div className={styles['ig-diff-view']}>
      <div className={styles['ig-diff-header']}>
        <span className={styles['ig-diff-title']}>{selectedFilePath || '选择文件查看差异'}</span>
      </div>
      <DiffView />
    </div>
  )
}

export default DiffPane
