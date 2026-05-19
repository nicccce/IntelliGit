import type { LlmConfig, AgentTask, AgentResult, AgentMessage } from './types'
import { createLlmClient } from './llmClient'
import { registerDefaultGitTools } from './gitTools'
import { toolRegistry } from './toolRegistry'
import { getFallbackResult } from './fallback'

// ─── Agent Runtime ────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 5

/**
 * 执行一次 Agent 任务。
 *
 * 流程：
 * 1. 组装 system + user 消息
 * 2. 调用 LLM（含 Tool 定义）
 * 3. 若 LLM 返回 tool_calls，执行对应工具并将结果追加为 tool 消息
 * 4. 循环至 finish_reason === 'stop' 或达到 maxIterations
 * 5. 返回最终 assistant 消息内容作为 rawOutput
 */
export async function runAgent<T = unknown>(
  config: LlmConfig,
  task: AgentTask,
  parseResult?: (rawOutput: string) => T | null
): Promise<AgentResult<T>> {
  registerDefaultGitTools()

  const client = createLlmClient(config)
  const maxIterations = task.maxIterations ?? DEFAULT_MAX_ITERATIONS

  const toolDefs = task.tools?.length ? toolRegistry.listByNames(task.tools) : []

  const messages: AgentMessage[] = [
    { role: 'system', content: task.systemPrompt },
    { role: 'user', content: task.userMessage }
  ]

  let iteration = 0
  let lastContent = ''

  while (iteration < maxIterations) {
    iteration++

    let response
    try {
      response = await client.chat(messages, toolDefs.length ? toolDefs : undefined)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { success: false, error: `LLM 调用失败: ${error}` }
    }

    lastContent = response.content

    if (response.finishReason === 'tool_calls' && response.toolCalls?.length) {
      // 将 assistant 的 tool_calls 消息追加到对话历史
      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls
      })

      // 逐个执行工具调用，将结果追加为 tool 消息
      for (const toolCall of response.toolCalls) {
        let toolResult: string
        try {
          const result = await toolRegistry.execute(toolCall.name, toolCall.arguments)
          toolResult = typeof result === 'string' ? result : JSON.stringify(result)
        } catch (err) {
          toolResult = `工具执行失败: ${err instanceof Error ? err.message : String(err)}`
        }

        messages.push({
          role: 'tool',
          content: toolResult,
          toolCallId: toolCall.id,
          name: toolCall.name
        })
      }

      continue
    }

    // finish_reason === 'stop' 或 'length'，退出循环
    break
  }

  if (!parseResult) {
    return { success: true, rawOutput: lastContent, data: lastContent as unknown as T }
  }

  const parsed = parseResult(lastContent)
  if (parsed === null) {
    return {
      success: false,
      error: `LLM 输出解析失败，原始内容：${lastContent.slice(0, 200)}`,
      rawOutput: lastContent
    }
  }

  return { success: true, data: parsed, rawOutput: lastContent }
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
  if (!config || !config.apiKey) {
    return getFallbackResult(task.taskType, task.context) as AgentResult<T>
  }

  const result = await runAgent<T>(config, task, parseResult)

  if (!result.success) {
    console.warn(`[AgentRuntime] 任务 ${task.taskType} 失败，启用降级：`, result.error)
    return getFallbackResult(task.taskType, task.context) as AgentResult<T>
  }

  return result
}
