import type { JSX } from 'react'

import DiffView from '../../components/DiffView'

interface DiffPaneProps {
  selectedFilePath: string | null
}

function DiffPane({ selectedFilePath }: DiffPaneProps): JSX.Element {
  return (
    <div className="ig-diff-view">
      <div className="ig-diff-header">
        <span className="ig-diff-title">{selectedFilePath || '选择文件查看差异'}</span>
      </div>
      <DiffView />
    </div>
  )
}

export default DiffPane
