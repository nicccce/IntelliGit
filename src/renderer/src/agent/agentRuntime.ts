import type { LlmConfig, AgentTask, AgentResult } from './types'
import type { AgentRunResponse } from '../../../shared/types'
import { getFallbackResult } from './fallback'

// ─── Agent Runtime（Renderer 侧薄封装） ────────────────────────────────────────
// 实际 LLM 调用和 Tool 执行已迁移到 Main 进程（Vercel AI SDK）。
// 此模块仅负责将任务序列化后通过 IPC 发送，并在 Main 返回结果后进行解析。

export async function runAgent<T = unknown>(
  config: LlmConfig,
  task: AgentTask,
  parseResult?: (rawOutput: string) => T | null
): Promise<AgentResult<T>> {
  try {
    const response: AgentRunResponse = await window.electronAPI.runAgentTask({
      config,
      systemPrompt: task.systemPrompt,
      userMessage: task.userMessage,
      messages: task.messages,
      tools: task.tools,
      maxIterations: task.maxIterations
    })

    if (!response.success) {
      console.error('[Agent] IPC runAgentTask 失败:', response.error)
      return { success: false, error: response.error }
    }

    const rawOutput = response.rawOutput ?? ''

    if (!parseResult) {
      return { success: true, rawOutput, data: rawOutput as unknown as T }
    }

    const parsed = parseResult(rawOutput)
    if (parsed === null) {
      console.error('[Agent] 输出解析失败，rawOutput 前 300 字符:', rawOutput.slice(0, 300))
      return {
        success: false,
        error: `LLM 输出解析失败，原始内容：${rawOutput.slice(0, 200)}`,
        rawOutput
      }
    }

    return { success: true, data: parsed, rawOutput }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[Agent] runAgentTask IPC 调用异常:', error)
    return { success: false, error: `Agent 调用异常: ${error}` }
  }
}

/**
 * 带 Fallback 的 Agent 执行。
 * LLM 不可用或解析失败时自动返回降级结果。
 */
export async function runAgentWithFallback<T = unknown>(
  config: LlmConfig | undefined,
  task: AgentTask,
  parseResult?: (rawOutput: string) => T | null
): Promise<AgentResult<T>> {
  if (!config?.apiKey) {
    return getFallbackResult(task.taskType, task.context) as AgentResult<T>
  }

  const result = await runAgent<T>(config, task, parseResult)

  if (!result.success) {
    console.warn(`[AgentRuntime] 任务 ${task.taskType} 失败，启用降级：`, result.error)
    return getFallbackResult(task.taskType, task.context) as AgentResult<T>
  }

  return result
}
