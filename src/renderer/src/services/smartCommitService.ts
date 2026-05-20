import type { AgentResult } from '../agent'
import { invokeGit } from '../api/gitClient'
import { useGitStatusStore } from '../store/gitStatusStore'
import { withOperation } from '../store/operationStore'
import { useUiStore } from '../store/uiStore'
import {
  smartCommitProvider,
  type CommitIntentGroup,
  type SmartCommitAnalysisResult
} from './smartCommitProvider'

export type { CommitIntentGroup, SmartCommitAnalysisResult }

export interface SmartCommitGroupWorkflowResult {
  group: CommitIntentGroup
  message: string
  fallback?: boolean
  fallbackReason?: string
}

function normalizeFiles(files: string[]): string[] {
  return [...new Set(files.map((file) => file.trim()).filter(Boolean))]
}

function buildGroupContext(group: CommitIntentGroup): string {
  const scope = group.scope ? `\n作用域：${group.scope}` : ''
  return `提交意图：${group.type}${scope}\n分组摘要：${group.summary}\n分组文件：\n${group.files.map((file) => `- ${file}`).join('\n')}`
}

function getChangedFiles(): string[] {
  return normalizeFiles(useGitStatusStore.getState().fileStatuses.map((file) => file.path))
}

function getStagedFileCount(): number {
  return useGitStatusStore
    .getState()
    .fileStatuses.filter((file) => file.staging && file.staging !== 'unmodified').length
}

/**
 * 智能提交分析入口：读取当前 diff，并交给 SmartCommitProvider 进行意图分组。
 * Provider 内部会优先使用 AI；未配置或调用失败时自动使用本地 fallback，保证流程闭环可用。
 */
export async function analyzeSmartCommitChanges(): Promise<AgentResult<SmartCommitAnalysisResult>> {
  const [workdirDiff, stagedDiff] = await Promise.all([
    invokeGit('diff.workdirRaw', {}),
    invokeGit('diff.stagedRaw', {})
  ])

  const diff = workdirDiff.diff || stagedDiff.diff
  const files = getChangedFiles()

  if (!diff.trim()) {
    return {
      success: false,
      error: '当前没有可分析的代码变更'
    }
  }

  return smartCommitProvider.analyzeChanges({ diff, files })
}

/**
 * Commit 信息生成入口：基于暂存区 diff 生成 Conventional Commits 提交信息。
 * 若暂存区为空，会自动暂存全部变更，以保证按钮点击后能形成“分析 -> 生成 -> 填入”的最小闭环。
 */
export async function generateSmartCommitMessage(): Promise<AgentResult<string>> {
  return withOperation('commit.generateMessage', async () => {
    try {
      let stagedDiff = await invokeGit('diff.stagedRaw', {})

      // 第一版以快速完成 AI Commit 链路为目标：无暂存内容时自动暂存全部变更。
      if (!stagedDiff.diff.trim()) {
        await invokeGit('staging.addAll')
        await useGitStatusStore.getState().refreshStatus()
        stagedDiff = await invokeGit('diff.stagedRaw', {})
      }

      if (!stagedDiff.diff.trim()) {
        return { success: false, error: '当前没有可用于生成提交信息的暂存变更' }
      }

      return smartCommitProvider.generateMessage({
        diff: stagedDiff.diff,
        stagedFileCount: getStagedFileCount()
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useUiStore.getState().setError(`生成提交信息失败: ${message}`)
      return { success: false, error: message }
    }
  })
}

/**
 * 按用户选择的意图分组暂存文件，并只基于该分组的暂存 diff 生成提交信息。
 * 当前阶段使用文件级暂存；hunk / AST 级语义分组会在底层能力完善后继续演进。
 */
export async function stageGroupAndGenerateMessage(
  group: CommitIntentGroup
): Promise<AgentResult<SmartCommitGroupWorkflowResult>> {
  return withOperation('commit.generateMessage', async () => {
    try {
      const files = normalizeFiles(group.files)
      if (files.length === 0) return { success: false, error: '该分组没有可暂存的文件' }

      // 文件级分组暂存：逐个暂存分组中的文件，避免影响其它未选择分组。
      for (const filePath of files) {
        await invokeGit('staging.add', { path: filePath })
      }
      await useGitStatusStore.getState().refreshStatus()

      const groupDiffParts = await Promise.all(
        files.map(async (filePath) => {
          const result = await invokeGit('diff.stagedRaw', { path: filePath })
          return result.diff
        })
      )
      const groupDiff = groupDiffParts.filter(Boolean).join('\n')

      if (!groupDiff.trim()) {
        return { success: false, error: '该分组暂存后没有可用于生成提交信息的 diff' }
      }

      const result = await smartCommitProvider.generateMessage({
        diff: groupDiff,
        stagedFileCount: files.length,
        groupContext: buildGroupContext(group)
      })

      if (!result.success || !result.data) {
        return {
          success: false,
          error: result.error,
          fallback: result.fallback,
          rawOutput: result.rawOutput
        }
      }

      return {
        ...result,
        data: {
          group,
          message: result.data,
          fallback: result.fallback,
          fallbackReason: result.fallback ? result.error : undefined
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useUiStore.getState().setError(`按分组生成提交信息失败: ${message}`)
      return { success: false, error: message }
    }
  })
}
