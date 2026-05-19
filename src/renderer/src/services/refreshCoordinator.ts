import { splitFileStatuses } from '../utils/fileStatus'
import { useDiffStore } from '../store/diffStore'
import { useGitStatusStore } from '../store/gitStatusStore'
import { useHistoryStore } from '../store/historyStore'
import { useRepositoryStore } from '../store/repositoryStore'
import { useUiStore } from '../store/uiStore'

let refreshSequence = 0

function isCurrentRefresh(sequence: number, repoPath: string | null): boolean {
  const currentRepoPath = useRepositoryStore.getState().currentRepo?.path || null
  return sequence === refreshSequence && currentRepoPath === repoPath
}

export function clearRepositoryScopedState(): void {
  useGitStatusStore.getState().clearGitStatus()
  useDiffStore.getState().clearDiffState()
  useHistoryStore.getState().clearHistoryState()
  useUiStore.getState().clearSuccess()
}

/**
 * 刷新文件状态和分支信息后，自动同步当前选中文件的 diff。
 * 如果选中的文件已不在对应列表中，则回到空白界面。
 */
async function syncSelectedFileDiff(
  staged: { path: string }[],
  unstaged: { path: string }[]
): Promise<void> {
  const { selectedFilePath, diffSource, clearDiffState, refreshCurrentDiff, selectFile } =
    useDiffStore.getState()

  if (!selectedFilePath || !diffSource) return

  if (diffSource === 'unstaged') {
    const stillUnstaged = unstaged.some((f) => f.path === selectedFilePath)
    if (stillUnstaged) {
      await refreshCurrentDiff()
    } else {
      // 选中的文件已不在未暂存列表，尝试切换到已暂存视图
      const isNowStaged = staged.some((f) => f.path === selectedFilePath)
      if (isNowStaged) {
        await selectFile(selectedFilePath, 'staged')
      } else {
        clearDiffState()
      }
    }
  } else {
    // diffSource === 'staged'
    const stillStaged = staged.some((f) => f.path === selectedFilePath)
    if (stillStaged) {
      await refreshCurrentDiff()
    } else {
      // 选中的文件已不在已暂存列表，尝试切换到未暂存视图
      const isNowUnstaged = unstaged.some((f) => f.path === selectedFilePath)
      if (isNowUnstaged) {
        await selectFile(selectedFilePath, 'unstaged')
      } else {
        clearDiffState()
      }
    }
  }
}

export async function refreshAllLocal(): Promise<void> {
  const sequence = ++refreshSequence
  const repoPath = useRepositoryStore.getState().currentRepo?.path || null
  if (!repoPath) return

  try {
    await Promise.all([
      useGitStatusStore.getState().refreshStatus(),
      useHistoryStore.getState().refreshHistory(),
      useGitStatusStore.getState().refreshBranchState()
    ])

    if (!isCurrentRefresh(sequence, repoPath)) return

    // 刷新文件状态后自动同步当前选中文件的 diff
    const fileStatuses = useGitStatusStore.getState().fileStatuses
    const { staged, unstaged } = splitFileStatuses(fileStatuses)
    await syncSelectedFileDiff(staged, unstaged)
  } catch (err) {
    console.error('[refreshCoordinator] refreshAllLocal 失败:', err)
  }
}

export async function refreshRemote(): Promise<void> {
  const repo = useRepositoryStore.getState().currentRepo
  if (!repo) return

  await useGitStatusStore.getState().refreshRemote(repo)
}

export async function refreshAll(): Promise<void> {
  const repoPath = useRepositoryStore.getState().currentRepo?.path || null
  if (!repoPath) return

  useUiStore.getState().setLoading(true)
  try {
    await Promise.all([
      refreshRemote(),
      useGitStatusStore.getState().refreshStatus(),
      useHistoryStore.getState().refreshHistory()
    ])

    const fileStatuses = useGitStatusStore.getState().fileStatuses
    const { staged, unstaged } = splitFileStatuses(fileStatuses)
    await syncSelectedFileDiff(staged, unstaged)
  } finally {
    useUiStore.getState().setLoading(false)
  }
}
