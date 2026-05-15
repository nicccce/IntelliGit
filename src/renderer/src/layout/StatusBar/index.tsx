import type { JSX } from 'react'

import {
  useGitStatusStore,
  useOperationStore,
  useRepositoryStore,
  type OperationKey
} from '../../store'

const OPERATION_LABELS: Partial<Record<OperationKey, string>> = {
  'repo.load': '加载配置',
  'repo.add': '添加仓库',
  'repo.create': '创建仓库',
  'repo.clone': '克隆仓库',
  'repo.switch': '切换仓库',
  'repo.settings': '保存设置',
  'staging.add': '暂存文件',
  'staging.addAll': '全部暂存',
  'staging.remove': '取消暂存',
  'staging.applyPatch': '暂存 Hunk',
  'staging.unstageHunk': '取消 Hunk',
  'commit.create': '提交',
  'commit.checkoutCommit': 'Checkout',
  'commit.reset': 'Reset',
  'branch.checkout': '切换分支',
  'remote.push': 'Push',
  'remote.pull': 'Pull'
}

function StatusBar(): JSX.Element {
  const currentRepo = useRepositoryStore((state) => state.currentRepo)
  const currentBranch = useGitStatusStore((state) => state.currentBranch)
  const commitsAhead = useGitStatusStore((state) => state.commitsAhead)
  const commitsBehind = useGitStatusStore((state) => state.commitsBehind)
  const operationLoading = useOperationStore((state) => state.operationLoading)
  const operationLabel = operationLoading
    ? OPERATION_LABELS[operationLoading] || operationLoading
    : null

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
