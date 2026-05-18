import type { AgentResult } from './types'
import type { CommitMessageResult } from './prompts/commit'

// ─── Fallback：LLM 不可用时的降级结果 ────────────────────────────────────────

/**
 * 提交信息降级：根据暂存文件数量生成基础模板提交信息。
 */
export function fallbackCommitMessage(stagedFileCount: number): AgentResult<CommitMessageResult> {
  return {
    success: true,
    fallback: true,
    data: {
      type: 'chore',
      subject: stagedFileCount > 0 ? `更新 ${stagedFileCount} 个文件` : '更新代码',
      breaking: false
    }
  }
}

/**
 * 提交意图分组降级：将所有文件归入同一组。
 */
export function fallbackCommitGroups(
  files: string[]
): AgentResult<{ groups: Array<{ type: string; summary: string; files: string[] }> }> {
  return {
    success: true,
    fallback: true,
    data: {
      groups: [
        {
          type: 'chore',
          summary: 'AI 不可用，所有变更归为一组',
          files
        }
      ]
    }
  }
}

/**
 * 冲突风险评估降级：返回中风险提示，提醒用户手动审查。
 */
export function fallbackConflictRisk(): AgentResult<{
  risks: Array<{ level: string; type: string; description: string }>
  summary: string
}> {
  return {
    success: true,
    fallback: true,
    data: {
      risks: [
        {
          level: 'medium',
          type: '无法自动分析',
          description: 'AI 不可用，请手动审查分支差异后再进行合并'
        }
      ],
      summary: 'AI 服务不可用，无法进行语义冲突分析，建议手动审查'
    }
  }
}

/**
 * 冲突解决建议降级：展示三方内容，建议手动解决。
 */
export function fallbackConflictResolve(): AgentResult<{
  strategy: string
  explanation: string
}> {
  return {
    success: true,
    fallback: true,
    data: {
      strategy: 'manual',
      explanation: 'AI 不可用，请参考上方三方内容手动解决冲突'
    }
  }
}

/**
 * 自然语言意图解析降级：提示用户 AI 不可用，仅保留基础 Git 操作入口。
 */
export function fallbackNlIntent(userInput: string): AgentResult<null> {
  return {
    success: false,
    fallback: true,
    error: `AI 服务当前不可用，无法解析"${userInput}"。\n请直接使用左侧功能区执行 Git 操作，或配置 AI 服务后重试。`
  }
}

/**
 * 通用降级：根据 taskType 分派到对应 fallback。
 */
export function getFallbackResult(
  taskType: string,
  context?: Record<string, unknown>
): AgentResult {
  switch (taskType) {
    case 'commit.generateMessage':
      return fallbackCommitMessage((context?.stagedFileCount as number) ?? 0)
    case 'commit.groupByIntent':
      return fallbackCommitGroups((context?.files as string[]) ?? [])
    case 'conflict.detectSemanticRisks':
      return fallbackConflictRisk()
    case 'conflict.suggestResolution':
      return fallbackConflictResolve()
    case 'nl_assistant':
      return fallbackNlIntent((context?.userInput as string) ?? '')
    default:
      return {
        success: false,
        fallback: true,
        error: 'AI 服务不可用，请稍后重试或检查 AI 配置'
      }
  }
}
