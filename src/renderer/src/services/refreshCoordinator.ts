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
  } finally {
    useUiStore.getState().setLoading(false)
  }
}
