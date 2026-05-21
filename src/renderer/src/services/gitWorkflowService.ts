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
import { buildSelectionPatch, clearSelection, enqueueReset, resetEntry } from './selectionRegistry'

function cleanSetting(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 文件操作后的统一刷新行为
 * @param path - 操作的文件路径
 * @param targetSource - 操作后对应的目标视图
 * @param shouldSwitch - 是否切换视图（部分操作为 false，全选操作为 true）
 */
async function refreshAfterFileOperation(
  path: string,
  targetSource: 'staged' | 'unstaged',
  shouldSwitch: boolean = true
): Promise<void> {
  await useGitStatusStore.getState().refreshStatus()
  if (!shouldSwitch) {
    // 部分操作：不切换视图，仅刷新当前 diff
    const { selectedFilePath } = useDiffStore.getState()
    if (selectedFilePath === path) {
      await useDiffStore.getState().refreshCurrentDiff()
    }
    return
  }
  // 全选操作：切换视图
  const { selectedFilePath, diffSource } = useDiffStore.getState()
  if (selectedFilePath === path) {
    if (diffSource === targetSource) {
      await useDiffStore.getState().refreshCurrentDiff()
    } else {
      await useDiffStore.getState().selectFile(path, targetSource)
    }
  }
}

/** 根据选择状态智能暂存：全选走完整 add（切换视图），部分选走 applyPatch（保留视图） */
export async function addFile(path: string): Promise<void> {
  await withOperation('staging.add', async () => {
    try {
      const patch = buildSelectionPatch('unstaged', path)
      if (patch === null) {
        // null 表示全选或无法构建 → 退化为完整文件暂存（切换视图）
        await addFullFile(path)
      } else if (patch === '') {
        // 空字符串表示无选中行 → 不操作
        return
      } else {
        // 有部分选中行 → apply patch 到暂存区（保留当前视图）
        await invokeGit('staging.applyPatch', { patch })
        clearSelection('unstaged', path)
        // 两侧都重置为全选（发信号给 DiffPane）
        enqueueReset('unstaged::' + path)
        enqueueReset('staged::' + path)
        resetEntry('unstaged', path)
        resetEntry('staged', path)
        await refreshAfterFileOperation(path, 'staged', false)
      }
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
      const { selectedFilePath, diffSource } = useDiffStore.getState()
      if (selectedFilePath) {
        if (diffSource === 'staged') {
          await useDiffStore.getState().refreshCurrentDiff()
        } else {
          await useDiffStore.getState().selectFile(selectedFilePath, 'staged')
        }
      }
    } catch (err) {
      useUiStore.getState().setError(`Add All 失败: ${errorMessage(err)}`)
    }
  })
}

/**
 * 完整暂存一个文件（跳过选择状态检查，暂存完整文件，并切换视图）
 */
export async function addFullFile(path: string): Promise<void> {
  await invokeGit('staging.add', { path })
  // 完整文件操作后，两侧都重置为全选（发信号给 DiffPane）
  enqueueReset('unstaged::' + path)
  enqueueReset('staged::' + path)
  resetEntry('unstaged', path)
  resetEntry('staged', path)
  await refreshAfterFileOperation(path, 'staged', true)
}

/**
 * 完整取消暂存一个文件（并切换视图）
 */
export async function removeFullFile(path: string): Promise<void> {
  await invokeGit('staging.remove', { path })
  // 完整文件操作后，两侧都重置为全选（发信号给 DiffPane 清除缓存）
  enqueueReset('staged::' + path)
  enqueueReset('unstaged::' + path)
  resetEntry('staged', path)
  resetEntry('unstaged', path)
  await refreshAfterFileOperation(path, 'unstaged', true)
}

/** 根据选择状态智能取消暂存：全选走完整 remove（切换视图），部分选走 unstageHunk（保留视图） */
export async function removeFile(path: string): Promise<void> {
  await withOperation('staging.remove', async () => {
    try {
      const patch = buildSelectionPatch('staged', path)
      if (patch === null) {
        // null 表示全选或无法构建 → 退化为完整文件取消暂存（切换视图）
        await removeFullFile(path)
      } else if (patch === '') {
        // 空字符串表示无选中行 → 不操作
        return
      } else {
        // 有部分选中行 → unstage patch（保留当前视图）
        await invokeGit('staging.unstageHunk', { patch })
        clearSelection('staged', path)
        // 两侧都重置为全选
        enqueueReset('staged::' + path)
        enqueueReset('unstaged::' + path)
        resetEntry('staged', path)
        resetEntry('unstaged', path)
        await refreshAfterFileOperation(path, 'unstaged', false)
      }
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
      const { selectedFilePath } = useDiffStore.getState()
      if (selectedFilePath) {
        await useDiffStore.getState().refreshCurrentDiff()
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
      const { selectedFilePath } = useDiffStore.getState()
      if (selectedFilePath) {
        await useDiffStore.getState().refreshCurrentDiff()
      }
    })
  } catch (err) {
    useUiStore.getState().setError(`取消 Hunk 暂存失败: ${errorMessage(err)}`)
  }
}

export interface CreateCommitResult {
  success: boolean
  hash?: string
  error?: string
}

export async function createCommit(message: string): Promise<CreateCommitResult> {
  return withOperation('commit.create', async () => {
    try {
      const currentRepo = useRepositoryStore.getState().currentRepo
      const authorEmail = cleanSetting(currentRepo?.commitAuthorEmail)
      const authorName =
        cleanSetting(currentRepo?.commitAuthorName) ||
        (authorEmail ? cleanSetting(currentRepo?.authUsername) : undefined)

      const result = await invokeGit('commit.create', {
        message,
        authorName,
        authorEmail
      })

      useHistoryStore.getState().clearSelectedCommit()
      useUiStore.getState().showSuccess(`提交成功: ${result.hash.slice(0, 8)}`)
      await refreshAllLocal()
      refreshRemote().catch((err) =>
        console.error('[gitWorkflowService] createCommit 异步远程刷新失败:', err)
      )
      useHistoryStore
        .getState()
        .fetchAllHistory()
        .catch((err) => console.error('[gitWorkflowService] createCommit 异步获取全历史失败:', err))

      return { success: true, hash: result.hash }
    } catch (err) {
      const message = errorMessage(err)
      useUiStore.getState().setError(`Commit 失败: ${message}`)
      return { success: false, error: message }
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
