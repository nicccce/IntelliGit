import type { AgentResult, CommitMessageResult, LlmConfig } from '../agent'
import {
  buildCommitMessage,
  COMMIT_GROUPS_SCHEMA,
  COMMIT_MESSAGE_SCHEMA,
  fallbackCommitGroups,
  fallbackCommitMessage,
  parseStructured,
  renderCommitAnalyzePrompt,
  renderCommitMessagePrompt,
  runAgent
} from '../agent'
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

export interface SmartCommitMessageInput {
  diff: string
  stagedFileCount: number
  groupContext?: string
}

export interface SmartCommitAnalyzeInput {
  diff: string
  files: string[]
}

/**
 * 控制传给 LLM 的 diff 上下文长度，避免大变更导致请求体过大。
 * 注意：这里仅截断 AI 分析上下文，不会修改真实工作区或暂存区内容。
 */
const MAX_DIFF_CONTEXT_LENGTH = 20000
const MAX_COMMIT_SUBJECT_LENGTH = 72
const MAX_GROUP_SUMMARY_LENGTH = 60
const COMMIT_TYPES = new Set(['feat', 'fix', 'refactor', 'style', 'docs', 'test', 'chore', 'perf', 'build', 'ci'])
const SCOPE_PATTERN = /^[a-z][a-z0-9-]*$/

function truncateDiffForPrompt(diff: string): string {
  if (diff.length <= MAX_DIFF_CONTEXT_LENGTH) return diff
  return `${diff.slice(0, MAX_DIFF_CONTEXT_LENGTH)}\n\n... diff 内容过长，已截断，仅用于生成提交建议 ...`
}

function limitText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return normalized.slice(0, maxLength).trimEnd()
}

function sanitizeType(type: string | undefined): string {
  const normalized = type?.trim().toLowerCase()
  return normalized && COMMIT_TYPES.has(normalized) ? normalized : 'chore'
}

function sanitizeScope(scope: string | undefined): string | undefined {
  const normalized = scope?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  if (!normalized || !SCOPE_PATTERN.test(normalized)) return undefined
  return normalized
}

function sanitizeSubject(subject: string | undefined): string {
  const normalized = limitText(subject || '更新代码变更', MAX_COMMIT_SUBJECT_LENGTH)
  return normalized.replace(/[。.!！]+$/g, '') || '更新代码变更'
}

function formatCommitMessage(result: CommitMessageResult): string {
  return buildCommitMessage({
    type: sanitizeType(result.type),
    scope: sanitizeScope(result.scope),
    subject: sanitizeSubject(result.subject),
    body: result.body?.trim() || undefined,
    breaking: Boolean(result.breaking)
  })
}

function sanitizeGroups(
  result: SmartCommitAnalysisResult,
  inputFiles: string[]
): SmartCommitAnalysisResult | null {
  const allowedFiles = new Set(inputFiles)
  const usedFiles = new Set<string>()
  const groups = result.groups
    .map((group) => ({
      type: sanitizeType(group.type),
      scope: sanitizeScope(group.scope),
      summary: limitText(group.summary, MAX_GROUP_SUMMARY_LENGTH),
      files: group.files
        .map((file) => file.trim())
        .filter((file) => allowedFiles.has(file) && !usedFiles.has(file))
    }))
    .filter((group) => {
      group.files.forEach((file) => usedFiles.add(file))
      return group.summary && group.files.length > 0
    })
    .slice(0, 5)

  return groups.length > 0 ? { groups } : null
}

function hasUsableLlmConfig(config: LlmConfig | undefined): config is LlmConfig {
  return Boolean(config?.apiKey?.trim())
}

function toFallbackReason(config: LlmConfig | undefined): string {
  return hasUsableLlmConfig(config) ? 'AI 服务调用失败，已使用本地模板降级' : 'AI 服务未配置，已使用本地模板降级'
}

export interface SmartCommitProvider {
  analyzeChanges: (input: SmartCommitAnalyzeInput) => Promise<AgentResult<SmartCommitAnalysisResult>>
  generateMessage: (input: SmartCommitMessageInput) => Promise<AgentResult<string>>
}

export class LlmSmartCommitProvider implements SmartCommitProvider {
  async analyzeChanges(input: SmartCommitAnalyzeInput): Promise<AgentResult<SmartCommitAnalysisResult>> {
    const config = getCurrentLlmConfig()

    if (!hasUsableLlmConfig(config)) {
      const fallback = fallbackCommitGroups(input.files) as AgentResult<SmartCommitAnalysisResult>
      return { ...fallback, error: toFallbackReason(config) }
    }

    const result = await runAgent<SmartCommitAnalysisResult>(
      config,
      {
        taskType: 'commit.groupByIntent',
        systemPrompt: '你是一位专业的 Git 提交助手，请将变更按提交意图进行分组。',
        userMessage: renderCommitAnalyzePrompt(truncateDiffForPrompt(input.diff)),
        context: { files: input.files }
      },
      (rawOutput) => parseStructured<SmartCommitAnalysisResult>(rawOutput, COMMIT_GROUPS_SCHEMA)
    )

    if (result.success && result.data) {
      const sanitized = sanitizeGroups(result.data, input.files)
      if (sanitized) {
        return {
          ...result,
          data: sanitized
        }
      }
    }

    const fallback = fallbackCommitGroups(input.files) as AgentResult<SmartCommitAnalysisResult>
    return {
      ...fallback,
      error: result.error || toFallbackReason(config),
      rawOutput: result.rawOutput
    }
  }

  async generateMessage(input: SmartCommitMessageInput): Promise<AgentResult<string>> {
    const config = getCurrentLlmConfig()

    if (!hasUsableLlmConfig(config)) {
      const fallback = fallbackCommitMessage(input.stagedFileCount)
      return {
        ...fallback,
        data: fallback.data ? formatCommitMessage(fallback.data) : undefined,
        error: toFallbackReason(config)
      }
    }

    const result = await runAgent<CommitMessageResult>(
      config,
      {
        taskType: 'commit.generateMessage',
        systemPrompt: input.groupContext
          ? '你是一位专业的 Git 提交助手，请为指定变更分组生成提交信息。'
          : '你是一位专业的 Git 提交助手，请生成符合 Conventional Commits 的提交信息。',
        userMessage: renderCommitMessagePrompt(truncateDiffForPrompt(input.diff), input.groupContext),
        context: { stagedFileCount: input.stagedFileCount }
      },
      (rawOutput) => parseStructured<CommitMessageResult>(rawOutput, COMMIT_MESSAGE_SCHEMA)
    )

    if (result.success && result.data) {
      return {
        ...result,
        data: formatCommitMessage(result.data)
      }
    }

    const fallback = fallbackCommitMessage(input.stagedFileCount)
    return {
      ...fallback,
      data: fallback.data ? formatCommitMessage(fallback.data) : undefined,
      error: result.error || toFallbackReason(config),
      rawOutput: result.rawOutput
    }
  }
}

export const smartCommitProvider: SmartCommitProvider = new LlmSmartCommitProvider()
