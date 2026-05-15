import type { JSX } from 'react'

import { useStatusBarModel } from '../../viewModels'

function StatusBar(): JSX.Element {
  const { currentRepo, currentBranch, commitsAhead, commitsBehind, operationLabel } =
    useStatusBarModel()

  return (
    <footer className="ig-statusbar">
      <span className="ig-status-item">
        <span className="ig-status-dot green" />
        引擎就绪
      </span>
      <span className="ig-status-item">
        <span className="ig-status-dot blue" />
        API 已连接
      </span>
      <span className="ig-status-path">{currentRepo ? currentRepo.path : '未选择仓库'}</span>
      <span className="ig-status-tail">
        {operationLabel ? `正在执行 ${operationLabel}` : `${commitsAhead}↑ ${commitsBehind}↓`}
        {currentBranch ? ` · ${currentBranch}` : ''}
      </span>
    </footer>
  )
}

export default StatusBar
