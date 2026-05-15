import type { JSX } from 'react'

import { useAppStore } from '../../store'

function StatusBar(): JSX.Element {
  const currentRepo = useAppStore((state) => state.currentRepo)
  const currentBranch = useAppStore((state) => state.currentBranch)
  const commitsAhead = useAppStore((state) => state.commitsAhead)
  const commitsBehind = useAppStore((state) => state.commitsBehind)
  const operationLoading = useAppStore((state) => state.operationLoading)

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
        {operationLoading ? `正在执行 ${operationLoading}` : `${commitsAhead}↑ ${commitsBehind}↓`}
        {currentBranch ? ` · ${currentBranch}` : ''}
      </span>
    </footer>
  )
}

export default StatusBar
