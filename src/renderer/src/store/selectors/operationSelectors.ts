import type { OperationKey, OperationStoreState } from '../operationStore'

export const OPERATION_LABELS: Partial<Record<OperationKey, string>> = {
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

export const selectOperationLoading = (
  state: OperationStoreState
): OperationStoreState['operationLoading'] => state.operationLoading

export const selectOperationLabel = (state: OperationStoreState): string | null => {
  const operation = state.operationLoading
  return operation ? OPERATION_LABELS[operation] || operation : null
}

export const selectIsAnyOperationRunning = (state: OperationStoreState): boolean =>
  state.runningOperations.length > 0
