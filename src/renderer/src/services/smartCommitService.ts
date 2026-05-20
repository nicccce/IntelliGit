import type { AgentResult } from '../agent'
import {
  buildCommitMessage,
  COMMIT_GROUPS_SCHEMA,
  COMMIT_MESSAGE_SCHEMA,
  parseStructured,
  renderCommitAnalyzePrompt,
  renderCommitMessagePrompt,
  runAgentWithFallback,
  type CommitMessageResult
} from '../agent'
import { invokeGit } from '../api/gitClient'
import { useGitStatusStore } from '../store/gitStatusStore'
import { withOperation } from '../store/operationStore'
import { useUiStore } from '../store/uiStore'
import { getCurrentLlmConfig } from './llmConfigService'

export interface CommitIntentGroup {
  type: string
  scope?: string
  summary: string
  files: string[]
}

export interface SmartCommitAnalysisResult {
  groups: CommitIntentGroup[]
}

export interface SmartCommitGroupWorkflowResult {
  group: CommitIntentGroup
  message: string
  fallback?: boolean
}

/**
 * 控制传给 LLM 的 diff 上下文长度，避免大变更导致请求体过大。
 * 注意：这里仅截断 AI 分析上下文，不会修改真实工作区或暂存区内容。
 */
const MAX_DIFF_CONTEXT_LENGTH = 20000

function truncateDiffForPrompt(diff: string): string {
  if (diff.length <= MAX_DIFF_CONTEXT_LENGTH) return diff
  return `${diff.slice(0, MAX_DIFF_CONTEXT_LENGTH)}\n\n... diff 内容过长，已截断，仅用于生成提交建议 ...`
}

function normalizeFiles(files: string[]): string[] {
  return [...new Set(files.map((file) => file.trim()).filter(Boolean))]
}

function formatCommitMessage(result: CommitMessageResult): string {
  return buildCommitMessage({
    ...result,
    scope: result.scope?.trim() || undefined,
    body: result.body?.trim() || undefined
  })
}

function buildGroupContext(group: CommitIntentGroup): string {
  const scope = group.scope ? `\n作用域：${group.scope}` : ''
  return `提交意图：${group.type}${scope}\n分组摘要：${group.summary}\n分组文件：\n${group.files.map((file) => `- ${file}`).join('\n')}`
}

/**
 * P1 智能提交分析入口：读取当前 diff，并让 Agent 按提交意图进行文件级分组。
 * 第一版先提供文件级语义分组，后续可在 P0 AST / Hunk 能力完善后升级为逻辑块级分组。
 */
export async function analyzeSmartCommitChanges(): Promise<AgentResult<SmartCommitAnalysisResult>> {
  const [workdirDiff, stagedDiff] = await Promise.all([
    invokeGit('diff.workdirRaw', {}),
    invokeGit('diff.stagedRaw', {})
  ])

  const diff = workdirDiff.diff || stagedDiff.diff
  const files = normalizeFiles(useGitStatusStore.getState().fileStatuses.map((file) => file.path))

  if (!diff.trim()) {
    return {
      success: false,
      error: '当前没有可分析的代码变更'
    }
  }

  return runAgentWithFallback<SmartCommitAnalysisResult>(
    getCurrentLlmConfig(),
    {
      taskType: 'commit.groupByIntent',
      systemPrompt: '你是一位专业的 Git 提交助手，请将变更按提交意图进行分组。',
      userMessage: renderCommitAnalyzePrompt(truncateDiffForPrompt(diff)),
      context: { files }
    },
    (rawOutput) => parseStructured<SmartCommitAnalysisResult>(rawOutput, COMMIT_GROUPS_SCHEMA)
  )
}

/**
 * P1 AI Commit 信息生成入口：基于暂存区 diff 生成 Conventional Commits 提交信息。
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

      const stagedFileCount = useGitStatusStore
        .getState()
        .fileStatuses.filter((file) => file.staging && file.staging !== 'unmodified').length

      const result = await runAgentWithFallback<CommitMessageResult>(
        getCurrentLlmConfig(),
        {
          taskType: 'commit.generateMessage',
          systemPrompt: '你是一位专业的 Git 提交助手，请生成符合 Conventional Commits 的提交信息。',
          userMessage: renderCommitMessagePrompt(truncateDiffForPrompt(stagedDiff.diff)),
          context: { stagedFileCount }
        },
        (rawOutput) => parseStructured<CommitMessageResult>(rawOutput, COMMIT_MESSAGE_SCHEMA)
      )

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
        data: formatCommitMessage(result.data)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useUiStore.getState().setError(`AI 生成提交信息失败: ${message}`)
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

      // 文件级分组暂存：逐个暂存 AI 分组中的文件，避免影响其它未选择分组。
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

      const result = await runAgentWithFallback<CommitMessageResult>(
        getCurrentLlmConfig(),
        {
          taskType: 'commit.generateMessage',
          systemPrompt: '你是一位专业的 Git 提交助手，请为指定变更分组生成提交信息。',
          userMessage: renderCommitMessagePrompt(
            truncateDiffForPrompt(groupDiff),
            buildGroupContext(group)
          ),
          context: { stagedFileCount: files.length }
        },
        (rawOutput) => parseStructured<CommitMessageResult>(rawOutput, COMMIT_MESSAGE_SCHEMA)
      )

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
          message: formatCommitMessage(result.data),
          fallback: result.fallback
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useUiStore.getState().setError(`按分组生成提交信息失败: ${message}`)
      return { success: false, error: message }
    }
  })
}
