import type { ResetMode } from '../../../shared/types'
import { invokeGit } from '../api/gitClient'
import { useDiffStore } from '../store/diffStore'
import { useGitStatusStore } from '../store/gitStatusStore'
import { useHistoryStore } from '../store/historyStore'
import { withOperation } from '../store/operationStore'
import { useRepositoryStore } from '../store/repositoryStore'
import { useUiStore } from '../store/uiStore'
import { findRemoteBranch, hasLocalBranch } from '../utils/branchOptions'
import { buildRemotePayload } from './remoteService'
import { refreshAllLocal, refreshRemote } from './refreshCoordinator'

function cleanSetting(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function addFile(path: string): Promise<void> {
  await withOperation('staging.add', async () => {
    try {
      await invokeGit('staging.add', { path })
      await useGitStatusStore.getState().refreshStatus()
    } catch (err) {
      useUiStore.getState().setError(`Add 失败: ${errorMessage(err)}`)
    }
  })
}

export async function addAll(): Promise<void> {
  await withOperation('staging.addAll', async () => {
    try {
      await invokeGit('staging.addAll')
      await useGitStatusStore.getState().refreshStatus()
    } catch (err) {
      useUiStore.getState().setError(`Add All 失败: ${errorMessage(err)}`)
    }
  })
}

export async function removeFile(path: string): Promise<void> {
  await withOperation('staging.remove', async () => {
    try {
      await invokeGit('staging.remove', { path })
      await useGitStatusStore.getState().refreshStatus()
    } catch (err) {
      useUiStore.getState().setError(`Remove 失败: ${errorMessage(err)}`)
    }
  })
}

export async function applyPatch(patch: string): Promise<void> {
  try {
    await withOperation('staging.applyPatch', async () => {
      await invokeGit('staging.applyPatch', { patch })
      await useGitStatusStore.getState().refreshStatus()
      const { selectedFilePath, selectFile } = useDiffStore.getState()
      if (selectedFilePath) {
        await selectFile(selectedFilePath)
      }
    })
  } catch (err) {
    useUiStore.getState().setError(`Hunk 暂存失败: ${errorMessage(err)}`)
  }
}

export async function unstageHunk(patch: string): Promise<void> {
  try {
    await withOperation('staging.unstageHunk', async () => {
      await invokeGit('staging.unstageHunk', { patch })
      await useGitStatusStore.getState().refreshStatus()
      const { selectedFilePath, selectFile } = useDiffStore.getState()
      if (selectedFilePath) {
        await selectFile(selectedFilePath)
      }
    })
  } catch (err) {
    useUiStore.getState().setError(`取消 Hunk 暂存失败: ${errorMessage(err)}`)
  }
}

export async function createCommit(message: string): Promise<void> {
  await withOperation('commit.create', async () => {
    try {
      const currentRepo = useRepositoryStore.getState().currentRepo
      const authorEmail = cleanSetting(currentRepo?.commitAuthorEmail)
      const authorName =
        cleanSetting(currentRepo?.commitAuthorName) ||
        (authorEmail ? cleanSetting(currentRepo?.authUsername) : undefined)

      await invokeGit('commit.create', {
        message,
        authorName,
        authorEmail
      })

      useHistoryStore.getState().clearSelectedCommit()
      useUiStore.getState().showSuccess('提交成功')
      await refreshAllLocal()
      refreshRemote().catch((err) =>
        console.error('[gitWorkflowService] createCommit 异步远程刷新失败:', err)
      )
      useHistoryStore
        .getState()
        .fetchAllHistory()
        .catch((err) => console.error('[gitWorkflowService] createCommit 异步获取全历史失败:', err))
    } catch (err) {
      useUiStore.getState().setError(`Commit 失败: ${errorMessage(err)}`)
    }
  })
}

export async function push(): Promise<void> {
  await withOperation('remote.push', async () => {
    try {
      const currentRepo = useRepositoryStore.getState().currentRepo
      await invokeGit('remote.push', buildRemotePayload(currentRepo))
      useUiStore.getState().showSuccess('Push 成功')
      await refreshAllLocal()
      refreshRemote().catch((err) =>
        console.error('[gitWorkflowService] push 异步远程刷新失败:', err)
      )
    } catch (err) {
      useUiStore.getState().setError(`Push 失败: ${errorMessage(err)}`)
    }
  })
}

export async function pull(): Promise<void> {
  await withOperation('remote.pull', async () => {
    try {
      const currentRepo = useRepositoryStore.getState().currentRepo
      await invokeGit('remote.pull', buildRemotePayload(currentRepo))
      useUiStore.getState().showSuccess('Pull 成功')
      await refreshAllLocal()
      refreshRemote().catch((err) =>
        console.error('[gitWorkflowService] pull 异步远程刷新失败:', err)
      )
    } catch (err) {
      useUiStore.getState().setError(`Pull 失败: ${errorMessage(err)}`)
    }
  })
}

export async function checkoutBranch(branch: string): Promise<void> {
  await withOperation('branch.checkout', async () => {
    try {
      const { branches, remoteBranches } = useGitStatusStore.getState()

      if (hasLocalBranch(branches, branch)) {
        await invokeGit('branch.checkout', { branch })
        useUiStore.getState().showSuccess(`已切换到分支 ${branch}`)
      } else {
        const remoteBranch = findRemoteBranch(remoteBranches, branch)
        if (!remoteBranch) {
          useUiStore.getState().setError(`本地不存在分支 ${branch}，且远程也无对应跟踪分支`)
          return
        }

        await invokeGit('branch.checkoutNew', {
          branch,
          startFrom: remoteBranch.hash
        })
        useUiStore.getState().showSuccess(`已创建并切换到分支 ${branch}`)
      }

      useDiffStore.getState().clearDiffState()
      useHistoryStore.getState().clearSelectedCommit()
      await refreshAllLocal()
      useHistoryStore
        .getState()
        .fetchAllHistory()
        .catch((err) =>
          console.error('[gitWorkflowService] checkoutBranch 异步获取全历史失败:', err)
        )
      refreshRemote().catch((err) =>
        console.error('[gitWorkflowService] checkoutBranch 异步远程刷新失败:', err)
      )
    } catch (err) {
      useUiStore.getState().setError(`切换分支失败: ${errorMessage(err)}`)
    }
  })
}

export async function checkoutCommit(hash: string): Promise<void> {
  await withOperation('commit.checkoutCommit', async () => {
    try {
      await invokeGit('commit.checkoutCommit', { hash })
      useHistoryStore.getState().clearSelectedCommit()
      useUiStore.getState().showSuccess(`已切换到 commit ${hash.slice(0, 8)}`)
      await refreshAllLocal()
      useHistoryStore
        .getState()
        .fetchAllHistory()
        .catch((err) =>
          console.error('[gitWorkflowService] checkoutCommit 异步获取全历史失败:', err)
        )
    } catch (err) {
      useUiStore.getState().setError(`Checkout 失败: ${errorMessage(err)}`)
    }
  })
}

export async function resetToCommit(hash: string, mode: ResetMode | string): Promise<void> {
  await withOperation('commit.reset', async () => {
    try {
      await invokeGit('commit.reset', { hash, mode })
      useHistoryStore.getState().clearSelectedCommit()
      useUiStore.getState().showSuccess(`已 Reset 到 ${hash.slice(0, 8)} (--${mode})`)
      await refreshAllLocal()
      useHistoryStore
        .getState()
        .fetchAllHistory()
        .catch((err) =>
          console.error('[gitWorkflowService] resetToCommit 异步获取全历史失败:', err)
        )
    } catch (err) {
      useUiStore.getState().setError(`Reset 失败: ${errorMessage(err)}`)
    }
  })
}
